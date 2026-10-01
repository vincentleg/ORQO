/**
 * Central, task-based Model Policy (Phase 4). Agents and tools request a TASK;
 * this policy chooses provider, model and output ceiling. Model identifiers
 * are configuration, never architecture: every task resolves from environment
 * variables with a single low-cost default, and nothing ever selects "the most
 * expensive model" automatically.
 *
 * Server-side only (reads env); contains no secrets — keys stay in the
 * provider adapters.
 */
import type { ModelTask } from "@/lib/agents/types";

export type ModelTier = "economy" | "standard";

export interface ModelChoice {
  task: ModelTask;
  provider: "openrouter";
  model: string;
  tier: ModelTier;
  maxOutputTokens: number;
}

const POLICY: Record<ModelTask, { env: string; tier: ModelTier; maxOutputTokens: number }> = {
  // Mechanical, high-volume: cheapest adequate model.
  extraction: { env: "ORQO_MODEL_EXTRACTION", tier: "economy", maxOutputTokens: 4_000 },
  synthesis: { env: "ORQO_MODEL_SYNTHESIS", tier: "economy", maxOutputTokens: 2_000 },
  // Business reasoning may be configured to a stronger model; defaults to the same low-cost one.
  business_reasoning: { env: "ORQO_MODEL_REASONING", tier: "standard", maxOutputTokens: 4_000 },
  // Critique is deterministic in Phase 4; a model (ideally another family) can be configured later.
  critique: { env: "ORQO_MODEL_CRITIQUE", tier: "standard", maxOutputTokens: 2_000 },
};

export const DEFAULT_MODEL = "google/gemini-3.8-flash";

export function selectModel(task: ModelTask, env: Record<string, string | undefined> = process.env): ModelChoice {
  const p = POLICY[task];
  const fallback = env.ORQO_DISCOVERY_MODEL || env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return { task, provider: "openrouter", model: env[p.env] || fallback, tier: p.tier, maxOutputTokens: p.maxOutputTokens };
}
