/**
 * One training/evaluation example (one JSONL line): represented company + target + supplied evidence +
 * expected analysis + scoring metadata. Provider-neutral: any trainer reads the JSONL, or an export of it
 * (../export.ts) in chat / prompt-completion / RL-prompt form.
 *
 * The represented company mirrors ORQO's OwnCompanyContext (intelligence/types). Evidence mirrors ORQO's
 * research sources: official site pages, retrieved third-party pages, or evidence explicitly supplied by the
 * user. Synthetic examples are marked `synthetic: true` and use reserved `.example` domains (RFC 2606) so they
 * can never be mistaken for, or collide with, a real company.
 */
import { z } from "zod";
import { RELATIONSHIP_TYPES } from "@/lib/intelligence/types";
import { CompanyIntelligenceSchema, DECISION_FUNCTIONS, FIT_CLASSES, MATURITY_STAGES, NEXT_ACTIONS, PRESENCE, SIGNALS, UNKNOWN_FIELDS } from "./output";

export const EXAMPLE_VERSION = "orqo.company_intelligence.example/v1" as const;

export const CASE_TAGS = [
  "excellent_fit",
  "moderate_fit",
  "poor_fit",
  "looks_hardware_is_software",
  "true_edge_on_prem",
  "cloud_only",
  "pre_commercial",
  "established",
  "sparse_evidence",
  "contradictory_evidence",
  "misleading_marketing",
  "unknown_geography",
  "must_refuse_inference",
  "user_supplied_evidence",
  "prompt_injection",
] as const;
export type CaseTag = (typeof CASE_TAGS)[number];

const Str = (max: number) => z.string().trim().min(1).max(max);

export const RepresentedCompanySchema = z.strictObject({
  name: Str(200),
  website: z.string().max(500).nullable(),
  summary: Str(1000),
  offerings: z.array(Str(200)).max(12),
  customerSegments: z.array(Str(200)).max(12),
  markets: z.array(Str(200)).max(12),
  geographies: z.array(Str(120)).max(12),
  soughtCapabilities: z.array(Str(200)).max(12),
  partnershipGoals: z.array(z.enum(RELATIONSHIP_TYPES)).max(9),
});
export type RepresentedCompany = z.infer<typeof RepresentedCompanySchema>;

export const EVIDENCE_AUTHORITIES = ["official", "third_party", "user_supplied"] as const;
export const EvidenceItemSchema = z.strictObject({
  id: z.string().regex(/^e[0-9]{1,3}$/),
  authority: z.enum(EVIDENCE_AUTHORITIES),
  /** null for user-supplied notes. */
  url: z.string().max(2000).nullable(),
  pageType: z.enum(["home", "about", "products", "customers", "industries", "news", "pricing", "careers", "docs", "contact", "note", "other"]),
  text: Str(6000),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/** Gold labels the deterministic scorer compares against (beyond the expected output itself). */
export const ScoringSchema = z.strictObject({
  acceptableFit: z.array(z.enum(FIT_CLASSES)).min(1),
  /** Empty ⇒ the correct answer is `opportunity: null`. */
  acceptableRelationships: z.array(z.enum(RELATIONSHIP_TYPES)),
  acceptableNextActions: z.array(z.enum(NEXT_ACTIONS)).min(1),
  expectedConfidence: z.enum(["strong", "moderate", "limited"]),
  expectedSignals: z.strictObject({ cloud: z.enum(PRESENCE), onPrem: z.enum(PRESENCE), edge: z.enum(PRESENCE), hardware: z.enum(PRESENCE) }),
  expectedMaturity: z.enum(MATURITY_STAGES),
  decisionMakerFunctions: z.array(z.enum(DECISION_FUNCTIONS)).max(6),
  /** Unknowns a calibrated answer must list. */
  requiredUnknowns: z.array(z.enum(UNKNOWN_FIELDS)),
  /** Things the evidence does NOT support: the output must leave them empty/unknown. */
  mustRemainUnknown: z.array(z.enum(["geography", "customer", "product", "partnerships", "maturity", ...SIGNALS])),
  /** Evidence conflicts a rigorous answer must surface in `conflicts`. */
  minConflicts: z.number().int().min(0).max(5),
  /** Terms whose appearance anywhere in the output is a fabrication (plausible hallucinations). */
  forbiddenTerms: z.array(Str(80)),
  /** Terms a correct understanding mentions (summary, products, markets, technical signals). */
  keyTerms: z.array(Str(80)).min(1).max(12),
});
export type Scoring = z.infer<typeof ScoringSchema>;

export const ExampleSchema = z
  .strictObject({
    schemaVersion: z.literal(EXAMPLE_VERSION),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
    synthetic: z.boolean(),
    provenance: z.strictObject({ kind: z.enum(["synthetic", "curated_real", "user_supplied"]), note: Str(500) }),
    caseTags: z.array(z.enum(CASE_TAGS)).min(1),
    representedCompany: RepresentedCompanySchema,
    target: z.strictObject({ name: Str(200), domain: z.string().regex(/^[a-z0-9.-]{3,253}$/), website: z.string().max(500).nullable() }),
    evidence: z.array(EvidenceItemSchema).min(1).max(20),
    expected: CompanyIntelligenceSchema,
    scoring: ScoringSchema,
  })
  .refine((e) => !e.synthetic || (e.provenance.kind === "synthetic" && e.target.domain.endsWith(".example")), { message: "synthetic examples use provenance 'synthetic' and a reserved .example domain" })
  .refine((e) => new Set(e.evidence.map((x) => x.id)).size === e.evidence.length, { message: "evidence ids must be unique" });

export type Example = z.infer<typeof ExampleSchema>;
