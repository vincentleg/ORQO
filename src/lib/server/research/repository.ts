/**
 * Persistence for research runs, company intelligence, the evidence store and
 * the usage ledger. Every call runs as the signed-in user (RLS applies) and
 * also filters by organization as a second layer.
 */
import { z } from "zod";
import { foldText } from "@/lib/intelligence/concepts";
import { ClaimSchema, ModelHypothesisSchema, TargetProfileSchema, type ModelHypothesis, type PageType, type TargetProfile } from "@/lib/intelligence/types";
import { AppError, fromDbError } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";
import { RESEARCH_QUOTAS, RUN_STALE_AFTER_SECONDS } from "./config";
import type { ProviderUsage, ResearchErrorCode, ResearchMode, ResearchStage } from "./types";

export function nameKey(name: string): string {
  return foldText(name).replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 200);
}

/** Why a run could not start (quota or concurrency); maps to a user-facing reason. */
export class RunRefusedError extends AppError {
  constructor(readonly reason: "quota_exhausted" | "busy") {
    super(reason === "quota_exhausted" ? "rate_limited" : "conflict", reason === "quota_exhausted" ? "Research limit reached." : "A research run is already in progress.");
  }
}

/** Atomic quota + concurrency guard (start_research_run RPC). Limits come from server config only. */
export async function startResearchRun(db: Db, organizationId: string, mode: ResearchMode, query: string, domain: string | null): Promise<string> {
  const q = RESEARCH_QUOTAS[mode];
  const { data, error } = await db.rpc("start_research_run", {
    p_organization_id: organizationId,
    p_mode: mode,
    p_query: query.slice(0, 200),
    p_domain: domain,
    p_max_runs: q.maxRunsPerOrg,
    p_window_hours: q.windowHours,
    p_stale_after_seconds: RUN_STALE_AFTER_SECONDS,
  });
  if (error) {
    if (error.code === "54000") throw new RunRefusedError("quota_exhausted");
    if (error.code === "55P03") throw new RunRefusedError("busy");
    throw fromDbError(error);
  }
  return z.uuid().parse(data);
}

export async function setRunStage(db: Db, organizationId: string, runId: string, stage: ResearchStage): Promise<void> {
  const { error } = await db.from("research_runs").update({ stage }).eq("organization_id", organizationId).eq("id", runId);
  if (error) throw fromDbError(error);
}

export async function finishRun(
  db: Db,
  organizationId: string,
  runId: string,
  outcome: { ok: true; domain: string; counters: Record<string, unknown> } | { ok: false; errorCode: ResearchErrorCode | "internal"; counters?: Record<string, unknown> },
): Promise<void> {
  const patch = outcome.ok
    ? { status: "succeeded", stage: "complete", domain: outcome.domain, counters: outcome.counters, finished_at: new Date().toISOString() }
    : { status: "failed", error_code: outcome.errorCode, counters: outcome.counters ?? {}, finished_at: new Date().toISOString() };
  const { error } = await db.from("research_runs").update(patch).eq("organization_id", organizationId).eq("id", runId);
  if (error) throw fromDbError(error);
}

export async function countRecentRuns(db: Db, organizationId: string, mode: ResearchMode): Promise<number> {
  const since = new Date(Date.now() - RESEARCH_QUOTAS[mode].windowHours * 3_600_000).toISOString();
  const { count, error } = await db.from("research_runs").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("mode", mode).gt("started_at", since);
  if (error) throw fromDbError(error);
  return count ?? 0;
}

export async function recordUsage(db: Db, organizationId: string, runId: string, u: ProviderUsage): Promise<void> {
  const { error } = await db.from("usage_events").insert({
    organization_id: organizationId,
    research_run_id: runId,
    provider: u.provider,
    service: u.service,
    operation: u.operation,
    succeeded: u.succeeded,
    units: u.units,
    cost_usd: u.costUsd,
  });
  if (error) throw fromDbError(error);
}

const SOURCE_KIND = { official: "company-website", third_party: "news", search_result: "web-search" } as const;

/** Stores (or replaces) the organization's intelligence for a domain, its sources and its evidence items. */
export async function saveIntelligence(db: Db, organizationId: string, runId: string, mode: ResearchMode, profile: TargetProfile, hypotheses: readonly ModelHypothesis[]): Promise<string> {
  const sourceRows = profile.sources.map((s) => ({
    organization_id: organizationId,
    kind: SOURCE_KIND[s.authority],
    label: (s.title || s.url).slice(0, 500),
    url: s.url,
    retrieved_at: s.retrievedAt,
    simulated: false,
    authority: s.authority,
    external_ref: `web:${s.url}`.slice(0, 2100),
  }));
  const { data: sources, error: sErr } = await db.from("sources").upsert(sourceRows, { onConflict: "organization_id,external_ref" }).select("id, external_ref");
  if (sErr) throw fromDbError(sErr);
  const idByRef = new Map((sources ?? []).map((r: { id: string; external_ref: string }) => [r.external_ref, r.id]));
  const sourceMap = profile.sources.map((s) => ({ key: s.key, sourceId: idByRef.get(`web:${s.url}`.slice(0, 2100)) ?? null, pageType: s.pageType }));

  const { data: intel, error: iErr } = await db
    .from("company_intelligence")
    .upsert(
      {
        organization_id: organizationId,
        domain: profile.domain,
        name: profile.name,
        name_key: nameKey(profile.name),
        mode,
        research_run_id: runId,
        profile: { name: profile.name, domain: profile.domain, website: profile.website, resolution: profile.resolution, language: profile.language, unknowns: profile.unknowns, sources: sourceMap },
        hypotheses,
        researched_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,domain" },
    )
    .select("id")
    .single();
  if (iErr) throw fromDbError(iErr);
  const intelligenceId = z.object({ id: z.uuid() }).parse(intel).id;

  const { error: dErr } = await db.from("evidence_items").delete().eq("organization_id", organizationId).eq("intelligence_id", intelligenceId);
  if (dErr) throw fromDbError(dErr);
  const keyToId = new Map(sourceMap.map((s) => [s.key, s.sourceId]));
  const rows = profile.claims
    .map((c) => ({
      organization_id: organizationId,
      intelligence_id: intelligenceId,
      source_id: (c.sourceKey && keyToId.get(c.sourceKey)) || null,
      claim_key: c.id,
      field: c.field,
      statement: c.statement,
      excerpt: c.excerpt ?? null,
      epistemic: c.epistemic,
      method: c.method,
      concepts: c.concepts,
      self_described: c.selfDescribed,
    }))
    .filter((r) => r.epistemic !== "fact" || r.source_id);
  if (rows.length > 0) {
    const { error: eErr } = await db.from("evidence_items").insert(rows);
    if (eErr) throw fromDbError(eErr);
  }
  return intelligenceId;
}

export interface StoredIntelligence {
  id: string;
  mode: ResearchMode;
  researchedAt: string;
  profile: TargetProfile;
  hypotheses: ModelHypothesis[];
}

const StoredProfile = z.object({
  name: z.string(),
  domain: z.string(),
  website: z.string(),
  resolution: TargetProfileSchema.shape.resolution,
  language: z.string().nullable().default(null),
  unknowns: TargetProfileSchema.shape.unknowns,
  sources: z.array(z.object({ key: z.string(), sourceId: z.uuid().nullable(), pageType: z.string() })),
});

const IntelRow = z.object({ id: z.uuid(), mode: z.enum(["basic", "deep"]), researched_at: z.string(), profile: z.unknown(), hypotheses: z.unknown() });
const EvidenceRow = z.object({
  claim_key: z.string(),
  field: z.string(),
  statement: z.string(),
  excerpt: z.string().nullable(),
  epistemic: z.string(),
  method: z.string(),
  concepts: z.array(z.string()),
  self_described: z.boolean(),
  source_id: z.uuid().nullable(),
});
const SourceRow = z.object({ id: z.uuid(), url: z.string().nullable(), label: z.string(), authority: z.string().nullable(), retrieved_at: z.string() });

/** Latest stored intelligence for a domain or a company name, or null. */
export async function findIntelligence(db: Db, organizationId: string, key: { domain?: string | null; name?: string | null }): Promise<StoredIntelligence | null> {
  let q = db.from("company_intelligence").select("id, mode, researched_at, profile, hypotheses").eq("organization_id", organizationId);
  if (key.domain) q = q.eq("domain", key.domain);
  else if (key.name) q = q.eq("name_key", nameKey(key.name));
  else return null;
  const { data, error } = await q.order("researched_at", { ascending: false }).limit(1);
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) return null;
  const row = IntelRow.parse(data[0]);
  const stored = StoredProfile.parse(row.profile);

  const { data: ev, error: evErr } = await db
    .from("evidence_items")
    .select("claim_key, field, statement, excerpt, epistemic, method, concepts, self_described, source_id")
    .eq("organization_id", organizationId)
    .eq("intelligence_id", row.id);
  if (evErr) throw fromDbError(evErr);
  const sourceIds = stored.sources.map((s) => s.sourceId).filter((x): x is string => Boolean(x));
  const { data: srcs, error: srcErr } = sourceIds.length ? await db.from("sources").select("id, url, label, authority, retrieved_at").eq("organization_id", organizationId).in("id", sourceIds) : { data: [], error: null };
  if (srcErr) throw fromDbError(srcErr);
  const srcById = new Map(z.array(SourceRow).parse(srcs ?? []).map((s) => [s.id, s]));
  const keyBySourceId = new Map(stored.sources.filter((s) => s.sourceId).map((s) => [s.sourceId as string, s.key]));

  const sources = stored.sources.flatMap((s) => {
    const r = s.sourceId ? srcById.get(s.sourceId) : undefined;
    if (!r?.url) return [];
    return [{ key: s.key, url: r.url, title: r.label, authority: (r.authority ?? "official") as "official", pageType: s.pageType as PageType, retrievedAt: new Date(r.retrieved_at).toISOString() }];
  });
  const claims = z
    .array(EvidenceRow)
    .parse(ev ?? [])
    .map((e) =>
      ClaimSchema.parse({
        id: e.claim_key,
        field: e.field,
        statement: e.statement,
        excerpt: e.excerpt ?? undefined,
        sourceKey: e.source_id ? keyBySourceId.get(e.source_id) : undefined,
        epistemic: e.epistemic,
        concepts: e.concepts,
        selfDescribed: e.self_described,
        method: e.method,
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

  const profile = TargetProfileSchema.parse({ name: stored.name, domain: stored.domain, website: stored.website, resolution: stored.resolution, language: stored.language, sources, claims, unknowns: stored.unknowns });
  const hypotheses = z.array(ModelHypothesisSchema).catch([]).parse(row.hypotheses);
  return { id: row.id, mode: row.mode, researchedAt: new Date(row.researched_at).toISOString(), profile, hypotheses };
}
