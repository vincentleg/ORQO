/**
 * Adaptive Commercial Understanding — contracts (Phase 14).
 *
 * Business DNA answers "what is this company?". The Domain & Market Model
 * answers "how does the commercial world around it work?". Both are derived
 * deterministically from stored evidence plus the user's validations; neither
 * calls a provider. Phase 15 consumes them through CommercialUnderstanding.
 */
import { z } from "zod";
import { DIMENSION_KEYS, type Dimension, type MarketSection, type Relation, type Trait, type ValueChainRole } from "./ontology";

/** FACT / EVIDENCE-BACKED INFERENCE / HYPOTHESIS / UNKNOWN. */
export const KNOWLEDGE_STATES = ["fact", "inference", "hypothesis", "unknown"] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export const TEXT_FACETS = ["description", "identity", "offerings", "customers", "industries", "geographies", "technologies", "business_model", "problems_solved", "public_partners", "integrations", "certifications", "case_studies", "strategic_signals"] as const;
export type TextFacet = (typeof TEXT_FACETS)[number];

export const DNA_FACETS = [...TEXT_FACETS, ...DIMENSION_KEYS, "value_chain_role"] as const;
export type DnaFacet = TextFacet | Dimension | "value_chain_role";

export interface EvidenceRef {
  claimId: string;
  /** Source page, when the claim has one (null: derived from the page structure only). */
  sourceUrl: string | null;
  retrievedAt: string | null;
  excerpt: string | null;
}

export type DnaOrigin = "research" | "derived" | "user";

export interface DnaItem {
  /** Stable across re-research: facet + normalized value. Used by confirm/reject. */
  key: string;
  facet: DnaFacet;
  /** Ontology value key (dimensions, roles) or a statement (text facets). */
  value: string;
  state: Exclude<KnowledgeState, "unknown">;
  origin: DnaOrigin;
  /** The user confirmed this item (it is then a fact stated by the user). */
  confirmed: boolean;
  /** The company describing itself: authoritative about its positioning, not independent proof. */
  selfDescribed: boolean;
  evidence: EvidenceRef[];
  /** Keys of DNA items this one was derived from (derived roles). */
  derivedFrom: string[];
}

export type UnderstandingStatus = "not_analyzed" | "analyzed";

export interface BusinessDna {
  companyName: string;
  ontologyVersion: string;
  status: UnderstandingStatus;
  basis: { intelligenceId: string | null; researchedAt: string | null; website: string | null };
  items: DnaItem[];
  /** Facets with no item: ORQO does not know. */
  unknowns: DnaFacet[];
  /** Items the user rejected (kept visible, never used). */
  rejected: { key: string; facet: DnaFacet; value: string }[];
  /** Traits known as fact or inference (the only input the market model may use). */
  traits: Trait[];
}

export type MarketCoverage = "insufficient" | "partial" | "sufficient";

export interface MarketItem {
  key: string;
  section: MarketSection;
  relation: Relation | null;
  /** Evidence-backed inference (a cue in this company's evidence) or hypothesis (typical for this kind of business). */
  state: "inference" | "hypothesis";
  /** Traits that made the entry applicable. */
  because: Trait[];
  /** Traits that evidence it for this company (empty for hypotheses). */
  evidencedBy: Trait[];
  /** DNA item keys behind those traits (provenance into Business DNA). */
  basis: string[];
}

export interface ArchetypeDimension {
  values: string[];
  /** fact if the user stated it, inference if read from evidence, unknown otherwise. */
  state: "fact" | "inference" | "unknown";
  basis: string[];
}

export interface MarketModel {
  ontologyVersion: string;
  coverage: MarketCoverage;
  archetype: Record<Dimension, ArchetypeDimension>;
  roles: { value: ValueChainRole; state: "fact" | "inference"; basis: string[] }[];
  /** Industry and technology labels found in the evidence (vocabulary, not logic). */
  terminology: string[];
  items: MarketItem[];
  /** Dimensions ORQO could not establish. */
  unknowns: Dimension[];
}

export interface NextQuestion {
  dimension: Dimension;
  options: string[];
  /** How many market entries the answer can settle (for ordering and transparency). */
  unlocks: number;
}

export interface CommercialUnderstanding {
  dna: BusinessDna;
  market: MarketModel;
  nextQuestion: NextQuestion | null;
}

/** A user validation as stored (company_validations). */
export interface Validation {
  kind: "confirm" | "reject" | "answer";
  facet: string;
  itemKey: string | null;
  value: string;
  createdAt: string;
}

export const NOT_SURE = "not_sure";

const Key = z.string().trim().min(3).max(160).regex(/^[a-z_]+:[a-z0-9_]+$/);

/** Input of a validation from the UI: strictly shaped, enum-valued answers. Never free instructions. */
export const ValidationInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("confirm"), itemKey: Key }),
  z.strictObject({ kind: z.literal("reject"), itemKey: Key }),
  z.strictObject({ kind: z.literal("answer"), dimension: z.enum(DIMENSION_KEYS as [Dimension, ...Dimension[]]), values: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1).max(3) }),
]);
export type ValidationInput = z.infer<typeof ValidationInput>;
