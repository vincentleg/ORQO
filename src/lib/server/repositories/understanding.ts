/**
 * Adaptive Commercial Understanding — persistence (Phase 14).
 *
 * Business DNA and the Market Model are recomputed from stored evidence on
 * read; the only state is the append-only log of a person's validations
 * (company_validations). Every call is organization-scoped and runs under the
 * caller's session (RLS); membership is checked by the caller.
 */
import { z } from "zod";
import { websiteDomain } from "@/lib/search/query";
import { AppError, fromDbError, parseInput } from "@/lib/server/errors";
import { findIntelligence } from "@/lib/server/research/repository";
import type { Db } from "@/lib/server/supabase/types";
import type { OwnCompanyContext } from "@/lib/intelligence/types";
import { understandCompany } from "@/lib/understanding";
import { DIMENSIONS, type Dimension } from "@/lib/understanding/ontology";
import { NOT_SURE, ValidationInput, type BusinessDna, type CommercialUnderstanding, type Validation } from "@/lib/understanding/types";
import { getOwnCompanyProfile, toOwnContext, type OwnProfileRow } from "./companies";

const Row = z.object({ kind: z.enum(["confirm", "reject", "answer"]), facet: z.string(), item_key: z.string().nullable(), value: z.string(), created_at: z.string() });

export async function listValidations(db: Db, organizationId: string, companyId: string): Promise<Validation[]> {
  const { data, error } = await db.from("company_validations").select("kind, facet, item_key, value, created_at").eq("organization_id", organizationId).eq("company_id", companyId).order("created_at", { ascending: true }).limit(500);
  if (error) throw fromDbError(error);
  return z
    .array(Row)
    .parse(data ?? [])
    .map((r) => ({ kind: r.kind, facet: r.facet, itemKey: r.item_key, value: r.value, createdAt: new Date(r.created_at).toISOString() }));
}

/**
 * Records one validation. Answers must be values of the ontology (or "not sure"); a confirm/reject must name an
 * item that exists in the company's current understanding — nothing else can be written.
 */
export async function addValidation(db: Db, organizationId: string, companyId: string, raw: unknown, current: BusinessDna): Promise<void> {
  const input = parseInput(ValidationInput, raw);
  let row: { kind: string; facet: string; item_key: string | null; value: string };
  if (input.kind === "answer") {
    const allowed = DIMENSIONS[input.dimension as Dimension] as readonly string[];
    const values = [...new Set(input.values)];
    const ok = (values.length === 1 && values[0] === NOT_SURE) || values.every((v) => allowed.includes(v));
    if (!ok) throw new AppError("invalid_input", "Unknown answer.");
    row = { kind: "answer", facet: input.dimension, item_key: null, value: values.join(",") };
  } else {
    const item = current.items.find((i) => i.key === input.itemKey) ?? current.rejected.find((i) => i.key === input.itemKey);
    if (!item) throw new AppError("not_found", "This item is no longer part of the company's understanding.");
    row = { kind: input.kind, facet: item.facet, item_key: item.key, value: "" };
  }
  const { error } = await db.from("company_validations").insert({ organization_id: organizationId, company_id: companyId, ...row });
  if (error) throw fromDbError(error);
}

export interface OwnUnderstanding {
  own: OwnProfileRow;
  understanding: CommercialUnderstanding;
}

/** The workspace's own company, understood from its stored research and the team's validations. Null without an own company. */
export async function getOwnUnderstanding(db: Db, organizationId: string): Promise<OwnUnderstanding | null> {
  const own = await getOwnCompanyProfile(db, organizationId);
  if (!own) return null;
  const domain = own.website ? websiteDomain(own.website) : null;
  const [intel, validations] = await Promise.all([domain ? findIntelligence(db, organizationId, { domain }) : Promise.resolve(null), listValidations(db, organizationId, own.id)]);
  const understanding = understandCompany({ companyName: own.name, website: own.website, intelligence: intel ? { id: intel.id, researchedAt: intel.researchedAt, profile: intel.profile } : null, validations, profile: { summary: own.summary, offerings: own.offerings, customerSegments: own.customer_segments, markets: own.markets, geographies: own.geographies } });
  return { own, understanding };
}

/**
 * Discover, don't ask: profile fields the team left empty are proposed from the Business DNA (facts and
 * inferences only). Fields a person filled are never overridden.
 */
export function withUnderstanding(ctx: OwnCompanyContext, dna: BusinessDna | null): OwnCompanyContext {
  if (!dna || dna.status !== "analyzed") return ctx;
  const known = (facet: string, n = 6) => dna.items.filter((i) => i.facet === facet && i.state !== "hypothesis").map((i) => i.value.slice(0, 120)).slice(0, n);
  return {
    ...ctx,
    summary: ctx.summary || known("description", 1)[0] || "",
    offerings: ctx.offerings.length ? ctx.offerings : known("offerings"),
    customerSegments: ctx.customerSegments.length ? ctx.customerSegments : [...known("customers", 3), ...known("industries", 3)],
    geographies: ctx.geographies.length ? ctx.geographies : known("geographies"),
  };
}

/** Own-company comparison context, completed from the Business DNA when the team left fields empty (no extra query otherwise). */
export async function loadOwnContext(db: Db, organizationId: string, row: OwnProfileRow): Promise<OwnCompanyContext> {
  const ctx = toOwnContext(row);
  if (ctx.summary && ctx.offerings.length && ctx.customerSegments.length && ctx.geographies.length) return ctx;
  const u = await getOwnUnderstanding(db, organizationId);
  return withUnderstanding(ctx, u?.understanding.dna ?? null);
}
