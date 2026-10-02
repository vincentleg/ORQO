/**
 * Compatibility view of the Model Policy Engine (Phase 17A: src/lib/governance/model-policy.ts).
 * Agents request a task; the policy picks the model. Actual calls go through the provider gate only.
 */
import type { ModelTask } from "@/lib/agents/types";
import { DEFAULT_MODEL, selectModel as select, TASK_POLICY } from "@/lib/governance/model-policy";
import type { ModelTier } from "@/lib/governance/authority";

export { DEFAULT_MODEL };
export type { ModelTier };

export interface ModelChoice {
  task: ModelTask;
  provider: "openrouter";
  model: string;
  tier: ModelTier;
  maxOutputTokens: number;
}

export function selectModel(task: ModelTask, env: Record<string, string | undefined> = process.env): ModelChoice {
  const s = select(task, { maxTier: "standard", env })!;
  return { task, provider: "openrouter", model: s.primary.model, tier: TASK_POLICY[task].tier, maxOutputTokens: s.primary.maxOutputTokens };
}
