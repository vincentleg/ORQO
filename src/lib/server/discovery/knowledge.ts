/**
 * What the workspace already knows, read before any external work so ORQO
 * never pays to rediscover it: Network companies, stored analyses, and the
 * rejections of recent discovery missions (rejection memory). Rejections are
 * read from existing mission results — there is no separate prospecting store.
 * Every read runs as the signed-in user (RLS) and filters by organization.
 */
import { z } from "zod";
import { DiscoveryResult } from "@/lib/agents/contracts";
import type { KnowledgeIndex, PastDecision, RawCandidate } from "@/lib/discovery/candidates";
import { DISCOVERY_LIMITS, type RejectionReason } from "@/lib/discovery/types";
import { websiteDomain } from "@/lib/search/query";
import { fromDbError } from "@/lib/server/errors";
import { listCompanies } from "@/lib/server/repositories/companies";
import type { Db } from "@/lib/server/supabase/types";

/** Reasons worth remembering. Sourcing-stage exclusions and "already remembered" are not re-remembered. */
const MEMORABLE: readonly RejectionReason[] = ["identity_unverified", "no_concrete_mechanism", "insufficient_evidence", "category_overlap_only", "relationship_not_aligned", "outside_geography", "outside_market", "region_already_covered"];

const AnalysisRow = z.object({ domain: z.string(), name: z.string(), mode: z.enum(["basic", "deep"]), researched_at: z.string() });
const DiscoveryRunRow = z.object({ result: z.unknown().nullable(), finished_at: z.string().nullable() });

export async function readCompanyKnowledge(db: Db, organizationId: string): Promise<KnowledgeIndex> {
  const since = new Date(Date.now() - DISCOVERY_LIMITS.rejectionMemoryDays * 86_400_000).toISOString();
  const [companies, analyses, runs] = await Promise.all([
    listCompanies(db, organizationId),
    db.from("company_intelligence").select("domain, name, mode, researched_at").eq("organization_id", organizationId).order("researched_at", { ascending: false }).limit(50),
    db.from("agent_runs").select("result, finished_at").eq("organization_id", organizationId).eq("agent_id", "prospecting").eq("status", "completed").gte("finished_at", since).order("finished_at", { ascending: false }).limit(10),
  ]);
  if (analyses.error) throw fromDbError(analyses.error);
  if (runs.error) throw fromDbError(runs.error);

  const own = companies.find((c) => c.is_own_company);
  const decisions: PastDecision[] = [];
  for (const row of z.array(DiscoveryRunRow).parse(runs.data)) {
    const r = DiscoveryResult.safeParse(row.result);
    if (!r.success || !row.finished_at) continue;
    for (const x of r.data.rejected) if (MEMORABLE.includes(x.reason)) decisions.push({ domain: x.domain, reason: x.reason, at: row.finished_at });
  }
  return {
    ownDomain: own?.website ? websiteDomain(own.website) : null,
    network: companies.filter((c) => !c.is_own_company).map((c) => ({ id: c.id, name: c.name.slice(0, 200), domain: c.website ? websiteDomain(c.website) : null, addedAt: c.created_at })),
    analyses: z
      .array(AnalysisRow)
      .parse(analyses.data)
      .map((a) => ({ domain: a.domain, name: a.name.slice(0, 200), researchedAt: a.researched_at, mode: a.mode })),
    decisions: decisions.slice(0, 100),
  };
}

/**
 * The workspace-knowledge candidate source: stored analyses (newest first),
 * then Network companies with a website. Internal and free — and labeled as
 * such: these companies are known to ORQO, not newly found on the web.
 */
export function knownCandidates(k: KnowledgeIndex, limit: number): RawCandidate[] {
  const seen = new Set<string>();
  const out: RawCandidate[] = [];
  const add = (name: string, domain: string) => {
    if (seen.has(domain) || domain === k.ownDomain) return;
    seen.add(domain);
    out.push({ name, url: `https://${domain}`, hint: null, source: "workspace_knowledge" });
  };
  for (const a of k.analyses) add(a.name, a.domain);
  for (const c of k.network) if (c.domain) add(c.name, c.domain);
  return out.slice(0, limit);
}
