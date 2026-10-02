/**
 * Business Memory, as the Phase 16B experience reads it: what this workspace already knows, assembled from
 * stored records only. Read-only: no research, no fetch, no provider, no model.
 * Every query runs as the signed-in user (RLS) and filters on the organization.
 */
import { z } from "zod";
import { websiteDomain } from "@/lib/search/query";
import { fromDbError } from "@/lib/server/errors";
import { findIntelligence } from "@/lib/server/research/repository";
import type { Db } from "@/lib/server/supabase/types";
import type { Dossier } from "@/lib/understanding/dossier";
import { RELATIONSHIP_FACET } from "@/lib/understanding/relationship";
import { NOT_SURE } from "@/lib/understanding/types";
import { listNetworkCompanies, type NetworkCompany } from "../repositories/network-memory";
import { listTrackedOpportunities, type TrackedOpportunity } from "../repositories/tracked-opportunities";
import { getDossier, getOwnUnderstanding, type OwnUnderstanding } from "../repositories/understanding";

/** How many companies' dossiers the briefing recomputes (most recently researched first). Bounded on purpose. */
export const BRIEFING_DOSSIERS = 8;

export interface ResearchRef {
  domain: string;
  name: string;
  researchedAt: string;
}

export interface RememberedCompany {
  company: NetworkCompany;
  domain: string | null;
  research: ResearchRef | null;
  /** The relationship the team stated (latest answer), or "not_sure"; null when never answered. */
  statedRelationship: string | null;
  tracked: TrackedOpportunity[];
  /** The most recent thing that happened to this company in ORQO's memory. */
  lastActivity: string;
}

export interface WorkspaceMemory {
  companies: RememberedCompany[];
  /** Research stored for companies not remembered yet (searched, never added). */
  unremembered: ResearchRef[];
  tracked: TrackedOpportunity[];
}

const IntelRow = z.object({ domain: z.string(), name: z.string(), researched_at: z.string() });
const AnswerRow = z.object({ company_id: z.uuid(), value: z.string(), created_at: z.string() });

export async function loadWorkspaceMemory(db: Db, organizationId: string): Promise<WorkspaceMemory> {
  const [companies, intel, tracked, answers] = await Promise.all([
    listNetworkCompanies(db, organizationId),
    db.from("company_intelligence").select("domain, name, researched_at").eq("organization_id", organizationId).order("researched_at", { ascending: false }).limit(200),
    listTrackedOpportunities(db, organizationId),
    db.from("company_validations").select("company_id, value, created_at").eq("organization_id", organizationId).eq("kind", "answer").eq("facet", RELATIONSHIP_FACET).order("created_at", { ascending: true }).limit(1000),
  ]);
  if (intel.error) throw fromDbError(intel.error);
  if (answers.error) throw fromDbError(answers.error);
  const research = z.array(IntelRow).parse(intel.data ?? []).map((r) => ({ domain: r.domain, name: r.name, researchedAt: new Date(r.researched_at).toISOString() }));
  const byDomain = new Map(research.map((r) => [r.domain, r]));
  const stated = new Map(z.array(AnswerRow).parse(answers.data ?? []).map((a) => [a.company_id, a.value]));

  const remembered = companies
    .filter((c) => !c.isOwnCompany)
    .map((company): RememberedCompany => {
      const domain = company.website ? websiteDomain(company.website) : null;
      const r = domain ? (byDomain.get(domain) ?? null) : null;
      const mine = tracked.filter((o) => o.targetCompanyId === company.id);
      const lastActivity = [company.addedAt, r?.researchedAt, ...mine.map((o) => o.updatedAt)].filter((x): x is string => Boolean(x)).sort().at(-1)!;
      return { company, domain, research: r, statedRelationship: stated.get(company.id) ?? null, tracked: mine, lastActivity };
    })
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  const rememberedDomains = new Set(remembered.map((c) => c.domain).filter(Boolean));
  const own = companies.find((c) => c.isOwnCompany);
  const ownDomain = own?.website ? websiteDomain(own.website) : null;
  return { companies: remembered, unremembered: research.filter((r) => !rememberedDomains.has(r.domain) && r.domain !== ownDomain), tracked };
}

export interface CompanyAssessment {
  remembered: RememberedCompany;
  dossier: Dossier;
}

/**
 * The current dossier of the most recently researched remembered companies (at most `limit`), with the own
 * company understood once. Stored evidence and validations only.
 */
export async function assessRecentCompanies(db: Db, organizationId: string, memory: WorkspaceMemory, own?: OwnUnderstanding | null, limit = BRIEFING_DOSSIERS): Promise<CompanyAssessment[]> {
  const mine = own === undefined ? await getOwnUnderstanding(db, organizationId) : own;
  if (!mine) return [];
  // Companies with an active tracked opportunity first (their live assessment matters), then the most recently researched.
  const active = new Set(memory.tracked.filter((o) => o.status === "investigating" || o.status === "validated").map((o) => o.targetCompanyId));
  const researched = memory.companies
    .filter((c) => c.research)
    .sort((a, b) => Number(active.has(b.company.id)) - Number(active.has(a.company.id)) || b.research!.researchedAt.localeCompare(a.research!.researchedAt))
    .slice(0, limit);
  const out = await Promise.all(
    researched.map(async (remembered) => {
      const intel = await findIntelligence(db, organizationId, { domain: remembered.research!.domain });
      const dossier = intel ? await getDossier(db, organizationId, intel, mine, { id: remembered.company.id, stage: remembered.company.stage }) : null;
      return dossier ? { remembered, dossier } : null;
    }),
  );
  return out.filter((x): x is CompanyAssessment => x !== null);
}

export const isStatedRelationship = (v: string | null) => v !== null && v !== NOT_SURE;
