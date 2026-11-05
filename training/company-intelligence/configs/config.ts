/**
 * Harness configuration: loads and validates configs/*.json. The safety config is enforced by every CLI
 * (assertSafety) — a non-zero paid spend without a recorded approval stops the harness before it does anything.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const HARNESS_ROOT = join(import.meta.dir, "..");
export const REPO_ROOT = join(HARNESS_ROOT, "..", "..");
export const paths = {
  root: HARNESS_ROOT,
  configs: join(HARNESS_ROOT, "configs"),
  seedDir: join(HARNESS_ROOT, "dataset", "seed"),
  seedJsonl: join(HARNESS_ROOT, "dataset", "seed.jsonl"),
  splitsDir: join(HARNESS_ROOT, "dataset", "splits"),
  schemaDir: join(HARNESS_ROOT, "dataset", "schema"),
  results: join(HARNESS_ROOT, "results"),
  systemPrompt: join(HARNESS_ROOT, "prompts", "system.md"),
};

export const DIMENSIONS = ["factual_grounding", "opportunity_reasoning", "company_understanding", "fit_classification", "decision_maker_reasoning", "uncertainty_calibration", "schema_compliance"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
/** Dimensions that an external judge may refine (the rest are fully deterministic). */
export const SUBJECTIVE_DIMENSIONS = ["company_understanding", "opportunity_reasoning", "decision_maker_reasoning"] as const satisfies readonly Dimension[];

export const PENALTIES = ["fabricated_contact", "fabricated_fact", "unsupported_technical_claim", "unsupported_technical_inference", "unsupported_geography", "contradiction", "unjustified_confidence"] as const;
export type PenaltyKind = (typeof PENALTIES)[number];

const NoDoc = { _doc: z.string().optional() };

export const SafetySchema = z.strictObject({
  ...NoDoc,
  external_paid_spend_usd: z.number().min(0),
  paid_api: z.boolean(),
  paid_gpu: z.boolean(),
  paid_storage: z.boolean(),
  paid_provider: z.boolean(),
  event_credits_activated: z.boolean(),
  approved_inference_hosts: z.array(z.string().min(1)),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvalNote: z.string().nullable(),
});
export type Safety = z.infer<typeof SafetySchema>;

export const RewardConfigSchema = z
  .strictObject({
    ...NoDoc,
    version: z.string(),
    weights: z.strictObject(Object.fromEntries(DIMENSIONS.map((d) => [d, z.number().min(0).max(1)])) as Record<Dimension, z.ZodNumber>),
    invalidOutputReward: z.number().min(-1).max(0),
    penalties: z.strictObject(Object.fromEntries(PENALTIES.map((p) => [p, z.number().min(0).max(2)])) as Record<PenaltyKind, z.ZodNumber>),
    maxTotalPenalty: z.number().min(0),
  })
  .refine((c) => Math.abs(Object.values(c.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9, { message: "reward weights must sum to 1" });
export type RewardConfig = z.infer<typeof RewardConfigSchema>;

export const GateConfigSchema = z.strictObject({
  ...NoDoc,
  version: z.string(),
  minOverallImprovement: z.number().min(0),
  maxGroundingRegression: z.number().min(0),
  maxHallucinationRateIncrease: z.number().min(0),
  minSchemaValidRate: z.number().min(0).max(1),
  dimensionRegressionWarning: z.number().min(0),
  requireTrainingManifest: z.boolean(),
});
export type GateConfig = z.infer<typeof GateConfigSchema>;

export const SplitConfigSchema = z
  .strictObject({ ...NoDoc, salt: z.string().min(1), ratios: z.strictObject({ train: z.number().min(0), validation: z.number().min(0), holdout: z.number().gt(0) }) })
  .refine((c) => Math.abs(c.ratios.train + c.ratios.validation + c.ratios.holdout - 1) < 1e-9, { message: "split ratios must sum to 1" });
export type SplitConfig = z.infer<typeof SplitConfigSchema>;

function load<T>(name: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(join(paths.configs, name), "utf8")));
}

export const loadSafety = () => load("safety.json", SafetySchema);
export const loadRewardConfig = () => load("reward.json", RewardConfigSchema);
export const loadGateConfig = () => load("gate.json", GateConfigSchema);
export const loadSplitConfig = () => load("split.json", SplitConfigSchema);

/**
 * Throws unless the harness is in its $0 posture, or a paid posture has a recorded approval.
 * Called first by every CLI.
 */
export function assertSafety(s: Safety = loadSafety()): Safety {
  const paid = s.external_paid_spend_usd > 0 || s.paid_api || s.paid_gpu || s.paid_storage || s.paid_provider || s.event_credits_activated;
  if (paid && !(s.approvedBy && s.approvedAt && s.approvalNote)) {
    throw new Error("safety.json enables paid spend or event credits without a recorded approval (approvedBy/approvedAt/approvalNote). Refusing to run.");
  }
  return s;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Inference endpoints: loopback only, unless the host is explicitly approved in safety.json. */
export function assertInferenceHost(url: string, s: Safety = loadSafety()): void {
  const host = new URL(url).hostname;
  if (LOOPBACK.has(host) || s.approved_inference_hosts.includes(host)) return;
  throw new Error(`Inference host "${host}" is not loopback and not in safety.json approved_inference_hosts. Refusing to call it.`);
}
