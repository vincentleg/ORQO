/**
 * Discover & Prospecting (Phase 5) — shared vocabulary.
 *
 * Pure and framework-free. Discovery answers "which companies should my
 * company investigate, and why?": a deterministic Discovery Plan derived from
 * the workspace profile, a bounded candidate funnel, verification against
 * retrieved company sources, and qualification by the Phase 3 mechanism rules
 * and critic. Candidate-source snippets are discovery hints, never evidence.
 */

/** What the user is looking for. "profile" derives the mission from the workspace's own partnership goals. */
export const DISCOVERY_INTENTS = ["profile", "customers", "suppliers", "technology_partners", "channels", "market_entry"] as const;
export type DiscoveryIntent = (typeof DISCOVERY_INTENTS)[number];

/**
 * Where candidates come from.
 * workspace_knowledge: companies this workspace already analyzed or recorded (internal, no cost — NOT live web discovery).
 * web_search: a configured web-search provider (paid, approval-gated).
 */
export const CANDIDATE_SOURCES = ["workspace_knowledge", "web_search"] as const;
export type CandidateSourceId = (typeof CANDIDATE_SOURCES)[number];

/** Target-company characteristics a mechanism needs (generic business relationships, never a named company). */
export const CHARACTERISTICS = [
  "sells_physical_products",
  "physical_products_without_regional_presence",
  "offers_sought_capability",
  "distributes_in_your_segments",
  "software_for_your_hardware",
  "hardware_for_your_software",
] as const;
export type Characteristic = (typeof CHARACTERISTICS)[number];

export const EXCLUSIONS = ["own_company", "directories_and_media", "category_overlap_only", "previously_rejected"] as const;
export type Exclusion = (typeof EXCLUSIONS)[number];

/** Evidence a candidate must show on its retrieved sources before it can qualify. */
export const EVIDENCE_REQUIREMENTS = ["physical_product", "regional_presence", "sought_capability", "distribution_activity", "complementary_offer", "shared_segment"] as const;
export type EvidenceRequirement = (typeof EVIDENCE_REQUIREMENTS)[number];

/**
 * Why a candidate did not become a recommendation. Rejection is a feature:
 * every surfaced company must have a reason to exist in the result.
 */
export const REJECTION_REASONS = [
  // Stage 1 — sourcing (cheap)
  "duplicate",
  "own_company",
  "not_a_company_site",
  "previously_rejected",
  // Stage 2 — verification
  "identity_unverified",
  // Stage 2 — qualification and critic
  "no_concrete_mechanism",
  "insufficient_evidence",
  "category_overlap_only",
  "relationship_not_aligned",
  "outside_geography",
  "outside_market",
  "region_already_covered",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** Why a candidate was considered but not verified (not a rejection: ORQO simply did not check it). */
export const UNVERIFIED_REASONS = ["observe_only", "verification_limit", "verification_refused", "budget"] as const;
export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number];

/** Explainable priority tiers. Never a score or a probability. */
export const PRIORITIES = ["high", "worth_investigating", "weak"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Hard V1 limits. Quality over quantity: a mission never expands itself,
 * never recurses and never researches every raw search result.
 */
export const DISCOVERY_LIMITS = {
  /** Candidate-source queries per mission. */
  maxQueries: 2,
  /** Results requested per query. */
  resultsPerQuery: 8,
  /** Candidates kept after deduplication (stage 1 output). */
  maxCandidates: 12,
  /** Candidates verified (stored research reused or new official-site research). */
  maxVerified: 6,
  /** New official-website analyses per mission (each is a governed Phase 3 Basic run). */
  maxNewResearch: 3,
  /** Companies presented. */
  maxResults: 5,
  /** Rejections listed (counts stay exact). */
  maxListedRejections: 20,
  /** A new official-site analysis starts only if this much run time remains. */
  minTimeForResearchMs: 45_000,
  /** A previous rejection is remembered this long, then the company may be re-evaluated. */
  rejectionMemoryDays: 30,
} as const;
