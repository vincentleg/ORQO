/**
 * Research policy, hard limits and model policy — the single place where
 * Phase 3 cost and safety numbers live. Server-only; nothing here is sent to
 * the browser except derived booleans and counts.
 */
import type { ResearchMode } from "./types";

export interface ResearchLimits {
  /** Web-search API queries (paid). */
  maxSearchQueries: number;
  /** Pages fetched from the official site (robots.txt excluded). */
  maxOfficialPages: number;
  /** Retrieved third-party pages (deep only). */
  maxThirdPartyPages: number;
  /** Model calls (paid). */
  maxModelCalls: number;
  maxRedirects: number;
  maxBytesPerPage: number;
  maxTextCharsPerPage: number;
  /** Characters of each source given to a model. */
  maxModelCharsPerSource: number;
  maxModelOutputTokens: number;
  fetchTimeoutMs: number;
  modelTimeoutMs: number;
  /** Wall-clock budget for the whole run. */
  runTimeoutMs: number;
}

export const RESEARCH_LIMITS: Record<ResearchMode, ResearchLimits> = {
  // Free: official website only. No paid provider can be reached from this mode.
  basic: {
    maxSearchQueries: 0,
    maxOfficialPages: 4,
    maxThirdPartyPages: 0,
    maxModelCalls: 0,
    maxRedirects: 3,
    maxBytesPerPage: 1_500_000,
    maxTextCharsPerPage: 40_000,
    maxModelCharsPerSource: 0,
    maxModelOutputTokens: 0,
    fetchTimeoutMs: 8_000,
    modelTimeoutMs: 0,
    runTimeoutMs: 40_000,
  },
  deep: {
    maxSearchQueries: 2,
    maxOfficialPages: 5,
    maxThirdPartyPages: 2,
    maxModelCalls: 2,
    maxRedirects: 3,
    maxBytesPerPage: 1_500_000,
    maxTextCharsPerPage: 40_000,
    maxModelCharsPerSource: 6_000,
    maxModelOutputTokens: 4_000,
    fetchTimeoutMs: 8_000,
    modelTimeoutMs: 45_000,
    runTimeoutMs: 110_000,
  },
};

/**
 * Per-organization run allowance in a rolling window, enforced atomically by
 * the start_research_run RPC. Basic runs cost no provider money but still
 * consume server resources; deep runs are paid and exist only for entitled
 * organizations (none until billing ships, except the operator preview list).
 */
export const RESEARCH_QUOTAS: Record<ResearchMode, { maxRunsPerOrg: number; windowHours: number }> = {
  basic: { maxRunsPerOrg: 20, windowHours: 24 },
  deep: { maxRunsPerOrg: 3, windowHours: 24 },
};

/** A "running" run older than this no longer blocks new runs (crashed or timed out). */
export const RUN_STALE_AFTER_SECONDS = 150;

export const CACHE_POLICY = {
  /** Results younger than this are reused without asking. */
  freshForHours: 24 * 7,
  /** A refresh is refused until the result is at least this old. */
  minRefreshIntervalHours: 24,
};

export const USER_AGENT = "ORQO-Research/0.3 (company analysis; respects robots.txt)";

export type ModelTask = "extraction" | "reasoning";

/**
 * Task-based model choice (a seam for the Phase 4 Model Router, not the router
 * itself). Mechanical extraction uses a low-cost model; business reasoning may
 * be configured to a stronger one. Identifiers are configuration only.
 */
export function modelFor(task: ModelTask): string {
  const env = process.env;
  const fallback = env.ORQO_DISCOVERY_MODEL || env.OPENROUTER_MODEL || "google/gemini-3.8-flash";
  return task === "extraction" ? env.ORQO_MODEL_EXTRACTION || fallback : env.ORQO_MODEL_REASONING || fallback;
}

/**
 * Operator-controlled preview allowance for deep research (comma-separated
 * organization ids in ORQO_RESEARCH_PREVIEW_ORGS). This is NOT billing and
 * grants no plan; it lets the operator evaluate paid research on named
 * workspaces under the same quota and limits.
 */
export function deepResearchPreviewOrgs(): Set<string> {
  return new Set(
    (process.env.ORQO_RESEARCH_PREVIEW_ORGS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[0-9a-f-]{36}$/.test(s)),
  );
}

export interface CacheStatus {
  ageHours: number;
  /** Older than freshForHours: shown as possibly outdated, and not reused silently by a new run. */
  stale: boolean;
  canRefresh: boolean;
  refreshFrom: string;
}

export function cacheStatus(researchedAt: string, now: number = Date.now()): CacheStatus {
  const at = Date.parse(researchedAt);
  const ageHours = (now - at) / 3_600_000;
  return {
    ageHours,
    stale: ageHours > CACHE_POLICY.freshForHours,
    canRefresh: ageHours >= CACHE_POLICY.minRefreshIntervalHours,
    refreshFrom: new Date(at + CACHE_POLICY.minRefreshIntervalHours * 3_600_000).toISOString(),
  };
}
