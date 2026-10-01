/**
 * Input and output contracts for missions and tools. Everything crossing the
 * agent boundary — caller input, tool output, stored results — is parsed with
 * these schemas. Unknown fields are rejected (strict), so a caller or a tool
 * can never smuggle in a plan, a budget, a tool name, an autonomy level or an
 * organization id.
 */
import { z } from "zod";
import { RELATIONSHIP_TYPES, UNDERSTANDING_FIELDS, OWN_PROFILE_FIELDS } from "@/lib/intelligence/types";
import { RULES, VALIDATION_KEYS } from "@/lib/intelligence/relevance";
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

export const MISSION_INPUTS = {
  analyze_company: AnalyzeCompanyInput,
  explain_opportunities: ExplainOpportunitiesInput,
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

export const AgentResultSchema = z.discriminatedUnion("kind", [CompanyAnalysisResult]);
export type AgentResult = z.infer<typeof AgentResultSchema>;
