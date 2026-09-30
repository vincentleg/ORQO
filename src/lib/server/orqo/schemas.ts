/**
 * Boundary decoders between Postgres rows and the ORQO engine's domain types.
 * Each schema is typed against the domain type it produces, so the database
 * shape and src/lib/domain/types.ts cannot drift apart silently.
 */
import { z } from "zod";
import type {
  ConfidenceAssessment,
  Constraint,
  CriticReport,
  EngineId,
  EvaluationTrigger,
  EvidenceRef,
  LifecycleStage,
  NeedIntensity,
  Objective,
  OpportunityDelta,
  OpportunityEvidence,
  OpportunityType,
  ParticipantRole,
  RejectedHypothesis,
  RelationshipStatus,
  SourceKind,
  StageChange,
  Visibility,
  WatchCondition,
} from "@/lib/domain/types";
import { TAGS, type Tag } from "@/lib/domain/taxonomy";

const TAG_KEYS = Object.keys(TAGS) as [Tag, ...Tag[]];

export const VISIBILITIES = ["public", "network", "connection", "agent-only", "private"] as const satisfies readonly Visibility[];
export const NEED_INTENSITIES = ["exploring", "active", "critical"] as const satisfies readonly NeedIntensity[];
export const RELATIONSHIP_STATUSES = ["unevaluated", "evaluating", "dormant", "watching", "active", "matched"] as const satisfies readonly RelationshipStatus[];
export const LIFECYCLE_STAGES = ["discovered", "interested", "mutual-interest", "meeting", "qualified", "pilot", "partnership", "revenue", "rejected", "dormant"] as const satisfies readonly LifecycleStage[];
export const PARTICIPANT_ROLES = ["software-vendor", "hardware-partner", "vendor", "distributor", "seller", "buyer", "partner"] as const satisfies readonly ParticipantRole[];
export const SOURCE_KINDS = ["company-website", "press-release", "news", "public-filing", "self-reported", "conversation", "agent-inferred", "simulated-signal", "web-search"] as const satisfies readonly SourceKind[];
const OPPORTUNITY_TYPES = [
  "customer",
  "supplier",
  "oem",
  "technology-integration",
  "distribution",
  "channel-partnership",
  "co-selling",
  "joint-product",
  "market-entry",
  "licensing",
  "data-partnership",
  "strategic-alliance",
] as const satisfies readonly OpportunityType[];

// Exhaustiveness: a union member missing from its array above is a compile error.
type Missing<U, A extends readonly unknown[]> = Exclude<U, A[number]>;
const exhaustive: [
  Missing<Visibility, typeof VISIBILITIES>,
  Missing<NeedIntensity, typeof NEED_INTENSITIES>,
  Missing<RelationshipStatus, typeof RELATIONSHIP_STATUSES>,
  Missing<LifecycleStage, typeof LIFECYCLE_STAGES>,
  Missing<ParticipantRole, typeof PARTICIPANT_ROLES>,
  Missing<SourceKind, typeof SOURCE_KINDS>,
  Missing<OpportunityType, typeof OPPORTUNITY_TYPES>,
] extends [never, never, never, never, never, never, never]
  ? true
  : false = true;
void exhaustive;

export const TagSchema = z.enum(TAG_KEYS);
export const VisibilitySchema = z.enum(VISIBILITIES);
const EpistemicSchema = z.enum(["fact", "inference", "assumption"]);
const Timestamp = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid timestamp");
/** Postgres renders timestamptz with an offset; the engine compares ISO strings, so normalise to UTC Z form. */
export const IsoTimestamp = Timestamp.transform((s) => new Date(s).toISOString());

export const EvidenceRefSchema: z.ZodType<EvidenceRef> = z.object({
  sourceId: z.string().min(1),
  excerpt: z.string().max(2000),
  epistemic: EpistemicSchema,
  marketingLanguage: z.boolean().optional(),
});

export const ObjectiveSchema: z.ZodType<Objective> = z.object({
  id: z.string().min(1),
  statement: z.string(),
  horizon: z.string(),
  visibility: VisibilitySchema,
  evidence: z.array(EvidenceRefSchema),
});

export const ConstraintSchema: z.ZodType<Constraint> = z.object({
  id: z.string().min(1),
  label: z.string(),
  requiresTags: z.array(TagSchema),
  appliesTo: z.array(z.enum(PARTICIPANT_ROLES)),
  visibility: VisibilitySchema,
  evidence: z.array(EvidenceRefSchema),
});

const EngineIdSchema = z.custom<EngineId>((v) => v === "deterministic" || (typeof v === "string" && /^openrouter:.+/.test(v)));

export const EvaluationTriggerSchema: z.ZodType<EvaluationTrigger> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connection") }),
  z.object({ kind: z.literal("signal"), signalId: z.string() }),
  z.object({ kind: z.literal("network-search"), opportunityIds: z.array(z.string()) }),
]);

const RejectedHypothesisSchema: z.ZodType<RejectedHypothesis> = z.object({
  title: z.string(),
  patternId: z.string(),
  verdict: z.enum(["pass", "weak", "reject"]),
  reasons: z.array(z.string()),
});

const WatchConditionSchema: z.ZodType<WatchCondition> = z.object({
  id: z.string(),
  companyId: z.string(),
  description: z.string(),
  kind: z.enum(["capability", "need-escalation"]),
  tags: z.array(TagSchema),
});

const OpportunityEvidenceSchema: z.ZodType<OpportunityEvidence> = z.object({
  id: z.string(),
  claim: z.string(),
  privateDetail: z.string().optional(),
  visibility: VisibilitySchema,
  epistemic: EpistemicSchema,
  sourceId: z.string(),
  companyId: z.string(),
  marketingLanguage: z.boolean().optional(),
  groundedIn: z.string().optional(),
});

const ConfidenceSchema: z.ZodType<ConfidenceAssessment> = z.object({
  level: z.enum(["strong", "moderate", "limited"]),
  rationale: z.string(),
  facts: z.number().int(),
  inferences: z.number().int(),
  assumptions: z.number().int(),
});

const CriticSchema: z.ZodType<CriticReport> = z.object({
  verdict: z.enum(["pass", "weak", "reject"]),
  checks: z.array(z.object({ id: z.string(), question: z.string(), result: z.enum(["pass", "warn", "fail"]), note: z.string() })),
  summary: z.string(),
});

const StageChangeSchema: z.ZodType<StageChange> = z.object({ stage: z.enum(LIFECYCLE_STAGES), at: IsoTimestamp, reason: z.string() });
const DeltaSchema: z.ZodType<OpportunityDelta> = z.object({ whatChanged: z.string(), whyNowRelevant: z.string(), whyNotBefore: z.string() });

// ---------------------------------------------------------------------------
// Row decoders (column names as returned by PostgREST)
// ---------------------------------------------------------------------------
export const CompanyRow = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  name: z.string(),
  website: z.string().nullable(),
  tagline: z.string(),
  summary: z.string(),
  headquarters: z.string(),
  size: z.string(),
  markets: z.array(z.string()),
  geographies: z.array(z.string()),
  objectives: z.array(ObjectiveSchema),
  constraints: z.array(ConstraintSchema),
  is_own_company: z.boolean(),
  created_at: IsoTimestamp,
});
export type CompanyRow = z.infer<typeof CompanyRow>;

export const CapabilityRow = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  label: z.string(),
  detail: z.string(),
  tags: z.array(TagSchema),
  evidence: z.array(EvidenceRefSchema),
  visibility: VisibilitySchema,
  observed_at: IsoTimestamp,
});

export const NeedRow = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  label: z.string(),
  detail: z.string(),
  tags: z.array(TagSchema),
  intensity: z.enum(NEED_INTENSITIES),
  evidence: z.array(EvidenceRefSchema),
  visibility: VisibilitySchema,
  disclosure: z.string().nullable(),
  observed_at: IsoTimestamp,
});

export const SourceRow = z.object({
  id: z.uuid(),
  kind: z.enum(SOURCE_KINDS),
  label: z.string(),
  url: z.string().nullable(),
  retrieved_at: IsoTimestamp,
  simulated: z.boolean(),
});

export const ContactRow = z.object({
  id: z.uuid(),
  company_id: z.uuid().nullable(),
  name: z.string(),
  role: z.string(),
  location: z.string(),
  bio: z.string(),
});

export const RelationshipRow = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  contact_a_id: z.uuid(),
  contact_b_id: z.uuid(),
  encounter_event: z.string(),
  encounter_location: z.string(),
  encountered_at: IsoTimestamp.nullable(),
  encounter_note: z.string(),
  status: z.enum(RELATIONSHIP_STATUSES),
  agents_connected_at: IsoTimestamp.nullable(),
  visibility: VisibilitySchema,
});

export const AnalysisRunRow = z.object({
  id: z.uuid(),
  engine: EngineIdSchema,
  trigger: EvaluationTriggerSchema,
  outcome: z.enum(["opportunity", "no-strong-opportunity"]),
  summary: z.string(),
  rejected_hypotheses: z.array(RejectedHypothesisSchema),
  watch_conditions: z.array(WatchConditionSchema),
  opportunity_ids: z.array(z.uuid()),
  ran_at: IsoTimestamp,
});

export const ParticipantRow = z.object({
  company_id: z.uuid(),
  role: z.enum(PARTICIPANT_ROLES),
  contributions: z.array(z.string()),
  position: z.number().int(),
});

export const OpportunityRow = z.object({
  id: z.uuid(),
  engine_key: z.string(),
  source_relationship_id: z.uuid().nullable(),
  pattern_id: z.string(),
  kind: z.enum(["reciprocal", "customer", "multi"]),
  title: z.string(),
  types: z.array(z.enum(OPPORTUNITY_TYPES)),
  summary: z.string(),
  why_exists: z.string(),
  why_now: z.string(),
  structure: z.string(),
  evidence: z.array(OpportunityEvidenceSchema),
  assumptions: z.array(z.string()),
  unknowns: z.array(z.string()),
  questions: z.array(z.string()),
  risks: z.array(z.string()),
  next_step: z.string(),
  missing_capabilities: z.array(TagSchema),
  driving_need_ids: z.array(z.string()),
  confidence: ConfidenceSchema,
  critic: CriticSchema,
  stage: z.enum(LIFECYCLE_STAGES),
  stage_history: z.array(StageChangeSchema),
  trigger: EvaluationTriggerSchema,
  engine: EngineIdSchema,
  delta: DeltaSchema.nullable(),
  discovered_at: IsoTimestamp,
  opportunity_participants: z.array(ParticipantRow),
});
export type OpportunityRow = z.infer<typeof OpportunityRow>;
