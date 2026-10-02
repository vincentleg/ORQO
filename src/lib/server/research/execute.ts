import "server-only";
/**
 * The governed research entry point, shared by the research route (Search)
 * and the Research Agent's tools so there is exactly one path to research:
 *
 *   prepareResearch: parse → authorize (member+, entitlement, providers)
 *     → cache reuse / refresh window → atomic quota + concurrency guard.
 *   runPreparedResearch: bounded run (RunBudget) → persist → finish run.
 *
 * Basic mode receives NO paid provider, by construction.
 */
import { findKnownCompany, parseSearchQuery, websiteDomain } from "@/lib/search/query";
import { AppError } from "@/lib/server/errors";
import { getOwnCompanyProfile, listCompanies } from "@/lib/server/repositories/companies";
import type { Db } from "@/lib/server/supabase/types";
import type { Locale } from "@/lib/i18n/config";
import { cacheStatus, RESEARCH_LIMITS } from "./config";
import { createPageFetcher } from "./fetcher";
import { authorizeResearch } from "./policy";
import { configuredProviders } from "./providers";
import { recordResearchSignals } from "@/lib/server/signals/research";
import { findIntelligence, finishRun, recordUsage, saveIntelligence, setRunStage, startResearchRun } from "./repository";
import { runCompanyResearch, type ResearchDeps, type ResearchInput, type ResearchOutput } from "./service";
import { ResearchError, type ProviderUsage, type ResearchErrorCode, type ResearchMode, type ResearchStage } from "./types";
import { errorSummary } from "@/lib/server/observability";
import { loadOwnContext } from "@/lib/server/repositories/understanding";

export interface ResearchRequest {
  query: string;
  mode: ResearchMode;
  refresh: boolean;
  locale: Locale;
  /** Set when an agent run invoked the research (usage is attributed to it too). */
  agentRunId?: string | null;
}

export type PreparedResearch =
  | { kind: "cached"; domain: string }
  | { kind: "run"; db: Db; organizationId: string; runId: string; input: ResearchInput; agentRunId: string | null };

/** Everything that must pass before a provider is reached. Throws ResearchDeniedError, RunRefusedError or AppError. */
export async function prepareResearch(db: Db, userId: string, requestedOrganizationId: string, req: ResearchRequest): Promise<PreparedResearch> {
  const target = parseSearchQuery(req.query);
  if (!target) throw new AppError("invalid_input", "Enter a company name or website.");
  const { organizationId } = await authorizeResearch(db, userId, requestedOrganizationId, req.mode);

  const companies = await listCompanies(db, organizationId);
  const known = findKnownCompany(target, companies.filter((c) => !c.is_own_company));
  const knownWebsite = known?.website ?? null;
  const domainKey = target.kind === "website" ? target.domain : knownWebsite ? websiteDomain(knownWebsite) : null;

  const cached = await findIntelligence(db, organizationId, domainKey ? { domain: domainKey } : { name: target.kind === "name" ? target.name : null });
  if (cached) {
    const cache = cacheStatus(cached.researchedAt);
    const sufficient = cached.mode === "deep" || req.mode === "basic";
    if (!req.refresh && sufficient && !cache.stale) return { kind: "cached", domain: cached.profile.domain };
    if (req.refresh && sufficient && !cache.canRefresh) throw new AppError("conflict", "This analysis was refreshed recently.");
  }

  const ownRow = await getOwnCompanyProfile(db, organizationId);
  const runId = await startResearchRun(db, organizationId, req.mode, req.query, domainKey);
  return {
    kind: "run",
    db,
    organizationId,
    runId,
    agentRunId: req.agentRunId ?? null,
    input: { target, knownWebsite, mode: req.mode, own: ownRow ? await loadOwnContext(db, organizationId, ownRow) : null, locale: req.locale },
  };
}

export interface ResearchCompletion {
  runId: string;
  domain: string;
  summary: ResearchOutput["summary"];
  /** Provider-reported usage of this run (empty for Basic). */
  usage: ProviderUsage[];
}

/** Executes a prepared run within its hard limits, persists the result and finishes the run. On failure the run is marked failed and a ResearchError is thrown. */
export async function runPreparedResearch(p: Extract<PreparedResearch, { kind: "run" }>, onStage?: (stage: ResearchStage) => void): Promise<ResearchCompletion> {
  const { db, organizationId, runId, input, agentRunId } = p;
  const mode = input.mode;
  const usage: ProviderUsage[] = [];
  // Basic research gets NO paid providers, by construction.
  const providers = mode === "deep" ? configuredProviders() : { search: null, model: null };
  const deps: ResearchDeps = {
    fetcher: createPageFetcher({ limits: RESEARCH_LIMITS[mode] }),
    ...providers,
    onUsage: (u) => {
      usage.push(u);
      return recordUsage(db, organizationId, runId, u, agentRunId).catch((e) => console.error("[orqo] usage record failed", errorSummary(e)));
    },
  };
  try {
    const out = await runCompanyResearch(deps, input, async (stage) => {
      onStage?.(stage);
      await setRunStage(db, organizationId, runId, stage).catch(() => undefined);
    });
    // Phase 7: keep what ORQO knew before, so the new analysis can be compared with it (no extra provider call).
    const previous = await findIntelligence(db, organizationId, { domain: out.profile.domain }).catch(() => null);
    await saveIntelligence(db, organizationId, runId, mode, out.profile, out.hypotheses);
    await recordResearchSignals(db, organizationId, previous ? { profile: previous.profile, researchedAt: previous.researchedAt, mode: previous.mode } : null, out.profile).catch((e) =>
      // Signals never fail the research run they come from.
      console.error("[orqo] signal detection failed", runId, errorSummary(e)),
    );
    await finishRun(db, organizationId, runId, { ok: true, domain: out.profile.domain, counters: { ...out.counters, warnings: out.warnings } });
    onStage?.("complete");
    return { runId, domain: out.profile.domain, summary: out.summary, usage };
  } catch (e) {
    const code: ResearchErrorCode | "internal" = e instanceof ResearchError ? e.code : "internal";
    if (code === "internal") console.error("[orqo] research run failed", runId, errorSummary(e));
    await finishRun(db, organizationId, runId, { ok: false, errorCode: code }).catch(() => undefined);
    throw e instanceof ResearchError ? e : new ResearchError("analysis_failed", "Analysis failed.");
  }
}
