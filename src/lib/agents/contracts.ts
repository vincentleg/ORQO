/**
 * Input and output contracts for missions and tools. Everything crossing the
 * agent boundary — caller input, tool output, stored results — is parsed with
 * these schemas. Unknown fields are rejected (strict), so a caller or a tool
 * can never smuggle in a plan, a budget, a tool name, an autonomy level or an
 * organization id.
 */
import { z } from "zod";
import { CONFIDENCE_LEVELS, RELATIONSHIP_TYPES, UNDERSTANDING_FIELDS, OWN_PROFILE_FIELDS } from "@/lib/intelligence/types";
import { RULES, VALIDATION_KEYS } from "@/lib/intelligence/relevance";
import { DISCOVERY_MECHANISMS } from "@/lib/discovery/plan";
import { UNKNOWN_GROUPS } from "@/lib/discovery/unknowns";
import { CANDIDATE_SOURCES, CHARACTERISTICS, DISCOVERY_INTENTS, DISCOVERY_LIMITS, EVIDENCE_REQUIREMENTS, EXCLUSIONS, PRIORITIES, REJECTION_REASONS, UNVERIFIED_REASONS } from "@/lib/discovery/types";
import { MISSION_TYPES, type MissionType } from "./types";

/** A target is either free text (name, domain or URL) or a company of this workspace's Network. */
export const TargetRefSchema = z.union([z.strictObject({ query: z.string().trim().min(1).max(200) }), z.strictObject({ companyId: z.uuid() })]);
export type TargetRef = z.infer<typeof TargetRefSchema>;

export const AnalyzeCompanyInput = z.strictObject({
  target: TargetRefSchema,
  /** basic: official website only (no paid provider). deep: paid providers — plan, approval and configuration gated. */
  depth: z.enum(["basic", "deep"]).default("basic"),
  refresh: z.boolean().default(false),
});

export const ExplainOpportunitiesInput = z.strictObject({ target: TargetRefSchema });

/** Free text a person typed: single line, no control characters. It is a business objective, never an instruction. */
const PlainText = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f<>{}]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min).max(max));

/**
 * discover_companies (Phase 5). Only the business objective and a few simple
 * filters: the plan, sources, limits and tools are decided by the server.
 */
export const DiscoverCompaniesInput = z.strictObject({
  intent: z.enum(DISCOVERY_INTENTS).default("profile"),
  objective: PlainText(3, 200).optional(),
  geography: PlainText(2, 60).optional(),
  market: PlainText(2, 60).optional(),
  /** workspace_knowledge: no cost. web_search: paid provider — entitlement, configuration, Prepare autonomy and approval gated. */
  source: z.enum(CANDIDATE_SOURCES).default("workspace_knowledge"),
  maxResults: z.number().int().min(1).max(DISCOVERY_LIMITS.maxResults).default(DISCOVERY_LIMITS.maxResults),
  /** Re-evaluate companies an earlier mission rejected (memory is not permanent truth). */
  reevaluate: z.boolean().default(false),
});

export const MISSION_INPUTS = {
  analyze_company: AnalyzeCompanyInput,
  explain_opportunities: ExplainOpportunitiesInput,
  discover_companies: DiscoverCompaniesInput,
} as const satisfies Record<MissionType, z.ZodType>;

export type MissionInput<T extends MissionType> = z.infer<(typeof MISSION_INPUTS)[T]>;

export function parseMissionInput<T extends MissionType>(type: T, raw: unknown): MissionInput<T> | null {
  const r = MISSION_INPUTS[type].safeParse(raw);
  return r.success ? (r.data as MissionInput<T>) : null;
}

export const MissionTypeSchema = z.enum(MISSION_TYPES);

// ---------------------------------------------------------------------------
// Result contracts (validated before they are persisted)
// ---------------------------------------------------------------------------

const OpportunitySummary = z.strictObject({
  relationship: z.enum(RELATIONSHIP_TYPES),
  rule: z.enum(RULES).nullable(),
  verdict: z.enum(["pass", "weak"]),
  confidence: z.enum(["strong", "moderate", "limited"]),
  /** Evidence ids (claim keys) supporting the target side. */
  claimIds: z.array(z.string().max(8)).max(12),
  validation: z.array(z.enum(VALIDATION_KEYS)).max(6),
});

export const NextActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("validate"), relationship: z.enum(RELATIONSHIP_TYPES), validationKey: z.enum(VALIDATION_KEYS).nullable(), text: z.string().max(400).nullable() }),
  z.strictObject({ kind: z.literal("complete_profile") }),
]);

export const CompanyAnalysisResult = z.strictObject({
  kind: z.literal("company_analysis"),
  target: z.strictObject({ name: z.string().max(200), domain: z.string().max(253) }),
  intelligenceId: z.uuid(),
  researchRunId: z.uuid().nullable(),
  reusedResearch: z.boolean(),
  researchedAt: z.string(),
  researchMode: z.enum(["basic", "deep"]),
  analysisStatus: z.enum(["opportunities", "hypotheses_only", "none", "own_profile_missing"]),
  opportunities: z.array(OpportunitySummary).max(3),
  hypotheses: z.array(OpportunitySummary).max(3),
  rejectedCount: z.number().int().min(0),
  unknowns: z.array(z.enum(UNDERSTANDING_FIELDS)),
  ownGaps: z.array(z.enum(OWN_PROFILE_FIELDS)),
  evidence: z.strictObject({ sources: z.number().int().min(0), facts: z.number().int().min(0), inferences: z.number().int().min(0) }),
  /** null at autonomy 0 (Observe never proposes execution). */
  nextAction: NextActionSchema.nullable(),
});
export type CompanyAnalysisResult = z.infer<typeof CompanyAnalysisResult>;

// ---------------------------------------------------------------------------
// Discovery (Phase 5)
// ---------------------------------------------------------------------------

const DomainSchema = z.string().regex(/^[a-z0-9.-]{3,253}$/);
const ConceptRef = z.string().max(120);
const PlanFilterSchema = z.strictObject({ concepts: z.array(ConceptRef).max(8), phrase: z.string().max(60).nullable(), label: z.string().max(60) });

export const DiscoveryPlanSchema = z.strictObject({
  intent: z.enum(DISCOVERY_INTENTS),
  mechanisms: z.array(z.enum(DISCOVERY_MECHANISMS)).max(5),
  relationships: z.array(z.enum(RELATIONSHIP_TYPES)).max(5),
  characteristics: z.array(z.enum(CHARACTERISTICS)).max(6),
  concepts: z.array(ConceptRef).max(12),
  geography: PlanFilterSchema.nullable(),
  market: PlanFilterSchema.nullable(),
  queries: z.array(z.string().max(120)).max(DISCOVERY_LIMITS.maxQueries),
  exclusions: z.array(z.enum(EXCLUSIONS)).max(EXCLUSIONS.length),
  evidenceRequired: z.array(z.enum(EVIDENCE_REQUIREMENTS)).max(EVIDENCE_REQUIREMENTS.length),
  unknowns: z.array(z.enum(VALIDATION_KEYS)).max(6),
  unsupported: z.array(z.strictObject({ mechanism: z.enum(DISCOVERY_MECHANISMS), field: z.enum(OWN_PROFILE_FIELDS) })).max(5),
  gaps: z.array(z.enum(OWN_PROFILE_FIELDS)).max(OWN_PROFILE_FIELDS.length),
});

export const EvidenceRefSchema = z.strictObject({
  text: z.string().max(300),
  source: z.string().max(200).nullable(),
  url: z.url({ protocol: /^https?$/ }).max(2000).nullable(),
  epistemic: z.enum(["fact", "inference"]),
  selfDescribed: z.boolean(),
});

export const PriorityDimensionsSchema = z.strictObject({
  mechanism: z.enum(["accepted", "gaps"]),
  evidence: z.enum(["corroborated", "single"]),
  alignment: z.enum(["aligned", "outside_goals", "goals_unset"]),
  timing: z.enum(["dated", "not_established"]),
  openQuestions: z.number().int().min(0).max(20),
  competitorRisk: z.boolean(),
});

export const TargetOfferSchema = z.strictObject({
  kind: z.enum(["named_products", "statement", "category"]),
  text: z.string().max(200).nullable(),
  categories: z.array(ConceptRef).max(4),
  epistemic: z.enum(["fact", "inference"]),
  source: z.string().max(200).nullable(),
  url: z.url({ protocol: /^https?$/ }).max(2000).nullable(),
});

export const QualifiedMechanismSchema = z.strictObject({
  rule: z.enum(DISCOVERY_MECHANISMS),
  relationship: z.enum(RELATIONSHIP_TYPES),
  drivers: z.array(ConceptRef).max(8),
  /** Optional: results stored before the review pass do not carry it (null = UNKNOWN). */
  targetOffer: TargetOfferSchema.nullable().optional(),
  ownServices: z.array(ConceptRef).max(8),
  geographies: z.array(z.string().max(120)).max(6),
  ownBrings: z.array(z.string().max(160)).max(4),
  validation: z.array(z.enum(VALIDATION_KEYS)).max(5),
  confidence: z.enum(CONFIDENCE_LEVELS),
  aligned: z.boolean(),
  goalsSet: z.boolean(),
  corroborated: z.boolean(),
});

const DiscoveredCompany = z.strictObject({
  name: z.string().max(200),
  domain: DomainSchema,
  website: z.url({ protocol: /^https?$/ }).max(300),
  source: z.enum(CANDIDATE_SOURCES),
  /** Source snippets: why it was discovered. Hints, never evidence. */
  hints: z.array(z.string().max(240)).max(2),
  network: z.strictObject({ companyId: z.uuid(), addedAt: z.string() }).nullable(),
  research: z.strictObject({ intelligenceId: z.uuid(), researchedAt: z.string(), mode: z.enum(["basic", "deep"]), reused: z.boolean(), researchRunId: z.uuid().nullable() }),
  priority: z.enum(PRIORITIES),
  dimensions: PriorityDimensionsSchema,
  mechanism: QualifiedMechanismSchema,
  evidence: z.array(EvidenceRefSchema).max(3),
  whyNow: z.array(EvidenceRefSchema).max(2),
  unknowns: z.array(z.enum(UNDERSTANDING_FIELDS)).max(UNDERSTANDING_FIELDS.length),
  nextQuestion: z.string().max(400).nullable(),
});
export type DiscoveredCompany = z.infer<typeof DiscoveredCompany>;

const PastDecisionSchema = z.strictObject({ reason: z.enum(REJECTION_REASONS), at: z.string() });

export const DiscoveryResult = z.strictObject({
  kind: z.literal("company_discovery"),
  objective: z.strictObject({ intent: z.enum(DISCOVERY_INTENTS), text: z.string().max(200).nullable(), geography: z.string().max(60).nullable(), market: z.string().max(60).nullable() }),
  source: z.strictObject({ id: z.enum(CANDIDATE_SOURCES), provider: z.string().max(40).nullable(), live: z.boolean() }),
  status: z.enum(["completed", "partial", "plan_infeasible", "no_candidates"]),
  partialReason: z.enum(["budget", "verification_refused", "verification_limit"]).nullable(),
  plan: DiscoveryPlanSchema,
  funnel: z.strictObject({
    sourced: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    excluded: z.number().int().min(0),
    considered: z.number().int().min(0),
    verified: z.number().int().min(0),
    unverified: z.number().int().min(0),
    qualified: z.number().int().min(0),
    weak: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
  companies: z.array(DiscoveredCompany).max(DISCOVERY_LIMITS.maxResults),
  rejected: z
    .array(z.strictObject({ name: z.string().max(200), domain: DomainSchema, stage: z.enum(["sourcing", "verification", "qualification"]), reason: z.enum(REJECTION_REASONS), inNetwork: z.boolean(), previous: PastDecisionSchema.nullable() }))
    .max(DISCOVERY_LIMITS.maxListedRejections),
  unverified: z.array(z.strictObject({ name: z.string().max(200), domain: DomainSchema, reason: z.enum(UNVERIFIED_REASONS), inNetwork: z.boolean() })).max(DISCOVERY_LIMITS.maxCandidates),
  ownGaps: z.array(z.enum(OWN_PROFILE_FIELDS)).max(OWN_PROFILE_FIELDS.length),
  /** null at autonomy 0 (Observe never proposes execution). */
  nextAction: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("investigate"), domain: DomainSchema, name: z.string().max(200), question: z.string().max(400).nullable() }),
      z.strictObject({ kind: z.literal("complete_profile"), fields: z.array(z.enum(OWN_PROFILE_FIELDS)).max(OWN_PROFILE_FIELDS.length) }),
      z.strictObject({ kind: z.literal("verify_more") }),
      // Plausible but weak candidates share one decisive unknown: resolve it before qualifying them.
      z.strictObject({ kind: z.literal("validate_blocker"), blocker: z.enum([...UNKNOWN_GROUPS, ...VALIDATION_KEYS]), companies: z.array(z.strictObject({ domain: DomainSchema, name: z.string().max(200) })).min(1).max(DISCOVERY_LIMITS.maxResults) }),
      z.strictObject({ kind: z.literal("broaden") }),
    ])
    .nullable(),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;

export const AgentResultSchema = z.discriminatedUnion("kind", [CompanyAnalysisResult, DiscoveryResult]);
export type AgentResult = z.infer<typeof AgentResultSchema>;
