/** Shared server-side research types. */

export const RESEARCH_MODES = ["basic", "deep"] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

/** Coarse, real stages of a run (streamed to the UI as they happen). */
export const RESEARCH_STAGES = ["resolving", "sources", "reading", "structuring", "comparing", "evaluating", "complete"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

/** User-facing failure codes (bilingual messages live in the i18n catalogs). */
export const RESEARCH_ERRORS = [
  "invalid_target",
  "not_resolved",
  "ambiguous",
  "site_unreachable",
  "site_blocked",
  "robots_disallowed",
  "timeout",
  "no_evidence",
  "provider_unavailable",
  "provider_failed",
  "analysis_failed",
  "budget_exceeded",
] as const;
export type ResearchErrorCode = (typeof RESEARCH_ERRORS)[number];

export class ResearchError extends Error {
  constructor(
    readonly code: ResearchErrorCode,
    message: string,
    readonly candidates: string[] = [],
  ) {
    super(message);
  }
}

/** What one provider call consumed, as reported by the provider. */
export interface ProviderUsage {
  provider: string;
  service: string;
  operation: "web_search" | "extraction" | "reasoning";
  succeeded: boolean;
  units: Record<string, number>;
  /** Only when the provider reports it. */
  costUsd: number | null;
}
