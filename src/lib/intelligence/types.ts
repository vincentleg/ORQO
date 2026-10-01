/**
 * Company intelligence — the structured, evidence-backed understanding of a
 * target company that Search produces (Phase 3). Pure types and zod schemas:
 * no framework, network or persistence code, so the same model is used by the
 * research service, the database decoders, the UI and the tests.
 */
import { z } from "zod";

/** ORQO's epistemic model. */
export const EPISTEMICS = ["fact", "inference", "assumption", "unknown"] as const;
export type Epistemic = (typeof EPISTEMICS)[number];

/** Qualitative confidence. ORQO never shows invented percentages. */
export const CONFIDENCE_LEVELS = ["strong", "moderate", "limited"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/**
 * How authoritative a source is about the target company.
 * official: the company's own website (authoritative about what it says, not proof its claims are true).
 * third_party: an independent page that was actually retrieved.
 * search_result: a search-engine snippet whose page was not retrieved (discovery only, never primary evidence).
 */
export const SOURCE_AUTHORITIES = ["official", "third_party", "search_result"] as const;
export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

export const PAGE_TYPES = ["home", "about", "products", "customers", "industries", "news", "other"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const ResearchSourceSchema = z.object({
  /** Stable key within one research result ("s0", "s1"…); persisted rows map it to a sources.id. */
  key: z.string().min(1).max(20),
  url: z.url({ protocol: /^https?$/ }).max(2000),
  title: z.string().max(500),
  authority: z.enum(SOURCE_AUTHORITIES),
  pageType: z.enum(PAGE_TYPES),
  retrievedAt: z.iso.datetime({ offset: true }),
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

/** What a claim is about. Drives grouping in the UI and "unknown" detection. */
export const CLAIM_FIELDS = ["identity", "summary", "offering", "product", "customer", "industry", "geography", "technology", "business_model", "strategy", "need"] as const;
export type ClaimField = (typeof CLAIM_FIELDS)[number];

export const ClaimSchema = z.object({
  id: z.string().min(1).max(40),
  field: z.enum(CLAIM_FIELDS),
  /** Short statement, in the source's language for facts. */
  statement: z.string().min(1).max(400),
  /** Verbatim excerpt from the source (short, for provenance; never a page copy). */
  excerpt: z.string().max(320).optional(),
  sourceKey: z.string().max(20).optional(),
  epistemic: z.enum(EPISTEMICS),
  /** Concept keys (see concepts.ts) this claim supports. */
  concepts: z.array(z.string().max(60)).max(12).default([]),
  /** The company describing itself: authoritative about its positioning, not independent proof. */
  selfDescribed: z.boolean().default(false),
  /** How the claim was produced. */
  method: z.enum(["structured_data", "page_metadata", "page_text", "navigation", "model_extraction"]),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const RESOLUTION_METHODS = ["url", "network", "inferred_domain", "search"] as const;
export type ResolutionMethod = (typeof RESOLUTION_METHODS)[number];

/** Fields ORQO tries to establish; any without evidence is reported as UNKNOWN. */
export const UNDERSTANDING_FIELDS = ["summary", "offering", "product", "customer", "industry", "geography", "business_model", "strategy", "need"] as const;
export type UnderstandingField = (typeof UNDERSTANDING_FIELDS)[number];

export const TargetProfileSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().min(3).max(253),
  website: z.url({ protocol: /^https?$/ }).max(500),
  resolution: z.object({ method: z.enum(RESOLUTION_METHODS), confidence: z.enum(CONFIDENCE_LEVELS) }),
  /** Primary language of the official site, when declared. */
  language: z.string().max(20).nullable().default(null),
  sources: z.array(ResearchSourceSchema).max(20),
  claims: z.array(ClaimSchema).max(120),
  unknowns: z.array(z.enum(UNDERSTANDING_FIELDS)).max(UNDERSTANDING_FIELDS.length),
});
export type TargetProfile = z.infer<typeof TargetProfileSchema>;

/** Relationship structures ORQO can propose. */
export const RELATIONSHIP_TYPES = ["customer", "supplier", "technology_partner", "oem", "integration", "channel", "strategic", "co_development", "market_entry"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** Own-company context used for comparison (the persisted Company Profile). */
export interface OwnCompanyContext {
  name: string;
  website: string | null;
  summary: string;
  offerings: string[];
  customerSegments: string[];
  markets: string[];
  geographies: string[];
  soughtCapabilities: string[];
  partnershipGoals: RelationshipType[];
}

export const OWN_PROFILE_FIELDS = ["summary", "offerings", "customerSegments", "markets", "geographies", "soughtCapabilities", "partnershipGoals"] as const;
export type OwnProfileField = (typeof OWN_PROFILE_FIELDS)[number];

/**
 * A candidate relationship proposed by a model (deep research only). It is a
 * hypothesis: the critic validates it deterministically before it is shown.
 */
export const ModelHypothesisSchema = z.object({
  relationship: z.enum(RELATIONSHIP_TYPES),
  title: z.string().min(3).max(160),
  mechanism: z.string().min(10).max(600),
  ownBrings: z.string().min(3).max(300),
  targetBrings: z.string().min(3).max(300),
  targetClaimIds: z.array(z.string().max(40)).max(8),
  ownFields: z.array(z.enum(OWN_PROFILE_FIELDS)).max(7),
  whyNowClaimIds: z.array(z.string().max(40)).max(4),
  assumptions: z.array(z.string().min(3).max(300)).max(5),
  questions: z.array(z.string().min(3).max(300)).max(5),
  nextStep: z.string().min(3).max(300),
});
export type ModelHypothesis = z.infer<typeof ModelHypothesisSchema>;
