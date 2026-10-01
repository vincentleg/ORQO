import { z } from "zod";
import { RELATIONSHIP_TYPES, type OwnCompanyContext } from "@/lib/intelligence/types";
import { AppError, fromDbError, parseInput } from "@/lib/server/errors";
import {
  CompanyRow,
  ConstraintSchema,
  EvidenceRefSchema,
  NEED_INTENSITIES,
  ObjectiveSchema,
  SOURCE_KINDS,
  TagSchema,
  VisibilitySchema,
} from "@/lib/server/orqo/schemas";
import type { Db } from "@/lib/server/supabase/types";

const COMPANY_COLUMNS = "id, organization_id, name, website, tagline, summary, headquarters, size, markets, geographies, objectives, constraints, is_own_company, created_at";
const HttpUrl = z.url({ protocol: /^https?$/ }).max(500);
const Text = (max: number) => z.string().trim().max(max);
const ExternalRef = z.string().trim().min(1).max(200).optional();

export const NewCompanyInput = z.object({
  name: z.string().trim().min(1).max(200),
  website: HttpUrl.optional(),
  tagline: Text(300).default(""),
  summary: Text(4000).default(""),
  headquarters: Text(200).default(""),
  size: Text(100).default(""),
  markets: z.array(Text(100)).max(50).default([]),
  geographies: z.array(Text(100)).max(50).default([]),
  objectives: z.array(ObjectiveSchema).max(50).default([]),
  constraints: z.array(ConstraintSchema).max(50).default([]),
  isOwnCompany: z.boolean().default(false),
  externalRef: ExternalRef,
});

export async function createCompany(db: Db, organizationId: string, input: z.input<typeof NewCompanyInput>): Promise<CompanyRow> {
  const c = parseInput(NewCompanyInput, input);
  const { data, error } = await db
    .from("companies")
    .insert({
      organization_id: organizationId,
      name: c.name,
      website: c.website ?? null,
      tagline: c.tagline,
      summary: c.summary,
      headquarters: c.headquarters,
      size: c.size,
      markets: c.markets,
      geographies: c.geographies,
      objectives: c.objectives,
      constraints: c.constraints,
      is_own_company: c.isOwnCompany,
      external_ref: c.externalRef ?? null,
    })
    .select(COMPANY_COLUMNS)
    .single();
  if (error) throw fromDbError(error);
  return CompanyRow.parse(data);
}

export async function listCompanies(db: Db, organizationId: string): Promise<CompanyRow[]> {
  const { data, error } = await db.from("companies").select(COMPANY_COLUMNS).eq("organization_id", organizationId).order("created_at", { ascending: true });
  if (error) throw fromDbError(error);
  return z.array(CompanyRow).parse(data);
}

/** One company of the organization, or null (other organizations' rows are invisible under RLS and filtered here too). */
export async function getCompany(db: Db, organizationId: string, companyId: string): Promise<CompanyRow | null> {
  if (!z.uuid().safeParse(companyId).success) return null;
  const { data, error } = await db.from("companies").select(COMPANY_COLUMNS).eq("organization_id", organizationId).eq("id", companyId).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? CompanyRow.parse(data) : null;
}

export const NewSourceInput = z.object({
  kind: z.enum(SOURCE_KINDS),
  label: z.string().trim().min(1).max(500),
  url: HttpUrl.optional(),
  retrievedAt: z.iso.datetime({ offset: true }),
  simulated: z.boolean().default(false),
  externalRef: ExternalRef,
});

export async function createSource(db: Db, organizationId: string, input: z.input<typeof NewSourceInput>): Promise<string> {
  const s = parseInput(NewSourceInput, input);
  const { data, error } = await db
    .from("sources")
    .insert({ organization_id: organizationId, kind: s.kind, label: s.label, url: s.url ?? null, retrieved_at: s.retrievedAt, simulated: s.simulated, external_ref: s.externalRef ?? null })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.uuid() }).parse(data).id;
}

const FacetBase = {
  companyId: z.uuid(),
  label: z.string().trim().min(1).max(300),
  detail: Text(2000).default(""),
  tags: z.array(TagSchema).max(20).default([]),
  evidence: z.array(EvidenceRefSchema).max(50).default([]),
  visibility: VisibilitySchema.default("public"),
  observedAt: z.iso.datetime({ offset: true }).optional(),
  externalRef: ExternalRef,
};

export const NewCapabilityInput = z.object(FacetBase);
export const NewNeedInput = z.object({ ...FacetBase, intensity: z.enum(NEED_INTENSITIES).default("exploring"), disclosure: Text(1000).optional() });

export async function createCapability(db: Db, organizationId: string, input: z.input<typeof NewCapabilityInput>): Promise<string> {
  const c = parseInput(NewCapabilityInput, input);
  const { data, error } = await db
    .from("company_capabilities")
    .insert({
      organization_id: organizationId,
      company_id: c.companyId,
      label: c.label,
      detail: c.detail,
      tags: c.tags,
      evidence: c.evidence,
      visibility: c.visibility,
      ...(c.observedAt && { observed_at: c.observedAt }),
      external_ref: c.externalRef ?? null,
    })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.uuid() }).parse(data).id;
}

export async function createNeed(db: Db, organizationId: string, input: z.input<typeof NewNeedInput>): Promise<string> {
  const n = parseInput(NewNeedInput, input);
  const { data, error } = await db
    .from("company_needs")
    .insert({
      organization_id: organizationId,
      company_id: n.companyId,
      label: n.label,
      detail: n.detail,
      tags: n.tags,
      intensity: n.intensity,
      evidence: n.evidence,
      visibility: n.visibility,
      disclosure: n.disclosure ?? null,
      ...(n.observedAt && { observed_at: n.observedAt }),
      external_ref: n.externalRef ?? null,
    })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.uuid() }).parse(data).id;
}

// ---------------------------------------------------------------------------
// Own-company profile (Company Context used by Search comparisons)
// ---------------------------------------------------------------------------

const OWN_PROFILE_COLUMNS = "id, name, website, summary, markets, geographies, offerings, customer_segments, sought_capabilities, partnership_goals, updated_at";

export const OwnProfileRow = z.object({
  id: z.uuid(),
  name: z.string(),
  website: z.string().nullable(),
  summary: z.string(),
  markets: z.array(z.string()),
  geographies: z.array(z.string()),
  offerings: z.array(z.string()),
  customer_segments: z.array(z.string()),
  sought_capabilities: z.array(z.string()),
  partnership_goals: z.array(z.enum(RELATIONSHIP_TYPES)),
  updated_at: z.string(),
});
export type OwnProfileRow = z.infer<typeof OwnProfileRow>;

export async function getOwnCompanyProfile(db: Db, organizationId: string): Promise<OwnProfileRow | null> {
  const { data, error } = await db.from("companies").select(OWN_PROFILE_COLUMNS).eq("organization_id", organizationId).eq("is_own_company", true).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? OwnProfileRow.parse(data) : null;
}

export function toOwnContext(row: OwnProfileRow): OwnCompanyContext {
  return {
    name: row.name,
    website: row.website,
    summary: row.summary,
    offerings: row.offerings,
    customerSegments: row.customer_segments,
    markets: row.markets,
    geographies: row.geographies,
    soughtCapabilities: row.sought_capabilities,
    partnershipGoals: row.partnership_goals,
  };
}

const ProfileList = z.array(Text(120).min(1)).max(30);

export const OwnProfileUpdate = z.object({
  name: z.string().trim().min(1).max(200),
  website: HttpUrl.nullable(),
  summary: Text(4000),
  offerings: ProfileList,
  customerSegments: ProfileList,
  markets: ProfileList,
  geographies: ProfileList,
  soughtCapabilities: ProfileList,
  partnershipGoals: z.array(z.enum(RELATIONSHIP_TYPES)).max(RELATIONSHIP_TYPES.length),
});

/** Splits a free-text list ("a, b\nc") into trimmed, de-duplicated items. */
export function splitProfileList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.split(/[\n,;]+/)) {
    const v = item.trim().replace(/\s+/g, " ").slice(0, 120);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.slice(0, 30);
}

export async function updateOwnCompanyProfile(db: Db, organizationId: string, input: z.input<typeof OwnProfileUpdate>): Promise<void> {
  const p = parseInput(OwnProfileUpdate, input);
  const { data, error } = await db
    .from("companies")
    .update({
      name: p.name,
      website: p.website,
      summary: p.summary,
      offerings: p.offerings,
      customer_segments: p.customerSegments,
      markets: p.markets,
      geographies: p.geographies,
      sought_capabilities: p.soughtCapabilities,
      partnership_goals: p.partnershipGoals,
    })
    .eq("organization_id", organizationId)
    .eq("is_own_company", true)
    .select("id");
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) throw new AppError("not_found", "Company profile not found.");
}
