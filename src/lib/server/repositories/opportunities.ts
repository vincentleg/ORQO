/**
 * Canonical opportunities as input to Opportunity Intelligence (Phase 11).
 * READ ONLY: nothing here creates, qualifies or changes an opportunity.
 *
 * Every query runs as the signed-in user (RLS is the backstop) and also
 * filters on the organization. Columns are minimized: evidence items keep only
 * the disclosable claim, never `privateDetail`, and engine bookkeeping
 * (trigger, delta, stage history) is not read.
 */
import { z } from "zod";
import type { CanonicalOpportunityRecord } from "@/lib/opportunity/intelligence";
import { fromDbError } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";

export const OPPORTUNITY_RECORD_LIMIT = 10;

const EvidenceItem = z.object({
  id: z.string().min(1).max(100),
  claim: z.string().max(1000),
  visibility: z.string().max(40),
  epistemic: z.enum(["fact", "inference", "assumption"]),
  companyId: z.string().max(100),
  marketingLanguage: z.boolean().optional(),
});

const Row = z.object({
  id: z.uuid(),
  title: z.string(),
  stage: z.string(),
  kind: z.enum(["reciprocal", "customer", "multi"]),
  why_exists: z.string(),
  why_now: z.string(),
  structure: z.string(),
  evidence: z.array(z.unknown()),
  assumptions: z.array(z.string()),
  unknowns: z.array(z.string()),
  questions: z.array(z.string()),
  missing_capabilities: z.array(z.string()),
  critic: z.record(z.string(), z.unknown()),
  opportunity_participants: z.array(z.object({ company_id: z.uuid(), role: z.string(), contributions: z.array(z.string()), position: z.number() })),
});

export const OPPORTUNITY_RECORD_COLUMNS =
  "id, title, stage, kind, why_exists, why_now, structure, evidence, assumptions, unknowns, questions, missing_capabilities, critic, opportunity_participants(company_id, role, contributions, position)";

/** The canonical opportunities one company takes part in, with every participant (A + B + C), bounded. */
export async function listOpportunityRecords(db: Db, organizationId: string, companyId: string): Promise<CanonicalOpportunityRecord[]> {
  if (!z.uuid().safeParse(companyId).success) return [];
  const links = await db.from("opportunity_participants").select("opportunity_id").eq("organization_id", organizationId).eq("company_id", companyId).limit(OPPORTUNITY_RECORD_LIMIT);
  if (links.error) throw fromDbError(links.error);
  const ids = z.array(z.object({ opportunity_id: z.uuid() })).parse(links.data).map((r) => r.opportunity_id);
  if (ids.length === 0) return [];

  const rows = await db.from("opportunities").select(OPPORTUNITY_RECORD_COLUMNS).eq("organization_id", organizationId).in("id", ids).order("discovered_at", { ascending: false }).limit(OPPORTUNITY_RECORD_LIMIT);
  if (rows.error) throw fromDbError(rows.error);
  const opportunities = z.array(Row).parse(rows.data);

  const companyIds = [...new Set(opportunities.flatMap((o) => o.opportunity_participants.map((p) => p.company_id)))];
  const companies = companyIds.length ? await db.from("companies").select("id, name, is_own_company").eq("organization_id", organizationId).in("id", companyIds) : { data: [], error: null };
  if (companies.error) throw fromDbError(companies.error);
  const byId = new Map(z.array(z.object({ id: z.uuid(), name: z.string(), is_own_company: z.boolean() })).parse(companies.data).map((c) => [c.id, c]));

  return opportunities.map((o) => ({
    id: o.id,
    title: o.title,
    stage: o.stage,
    kind: o.kind,
    whyExists: o.why_exists,
    whyNow: o.why_now,
    structure: o.structure,
    // Item by item: one malformed item is dropped, not the whole list. zod strips privateDetail and any other key.
    evidence: o.evidence.flatMap((e) => {
      const r = EvidenceItem.safeParse(e);
      return r.success ? [{ ...r.data, marketingLanguage: r.data.marketingLanguage ?? false }] : [];
    }),
    assumptions: o.assumptions,
    unknowns: o.unknowns,
    questions: o.questions,
    missingCapabilities: o.missing_capabilities,
    criticVerdict: typeof o.critic.verdict === "string" ? o.critic.verdict : null,
    participants: [...o.opportunity_participants]
      .sort((a, b) => a.position - b.position)
      .flatMap((p) => {
        const c = byId.get(p.company_id);
        return c ? [{ companyId: c.id, name: c.name, isOwn: c.is_own_company, role: p.role, contributions: p.contributions }] : [];
      }),
  }));
}
