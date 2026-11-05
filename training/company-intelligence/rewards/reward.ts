/**
 * Provider-neutral reward for RL (GRPO/PPO/…) or for rejection sampling / best-of-n selection.
 *
 *   reward = clamp( Σ weight_d · score_d  −  min(Σ penalties, maxTotalPenalty), −1, 1 )
 *   invalid output (not JSON / not schema-valid)  →  invalidOutputReward (−1)
 *
 * Weights and penalty sizes live in configs/reward.json; the per-dimension scores and the violations come
 * from the same deterministic scorer the evaluator uses (eval/scorer.ts). Every reward is returned with its
 * full breakdown, so a surprising reward can always be explained.
 */
import { DIMENSIONS, loadRewardConfig, type Dimension, type PenaltyKind, type RewardConfig } from "../configs/config";
import type { Example } from "../dataset/schema/example";
import { scoreExample, type ExampleScore } from "../eval/scorer";

export interface RewardBreakdown {
  reward: number;
  weighted: number;
  penalty: number;
  contributions: Record<Dimension, number>;
  penalties: { kind: PenaltyKind; path: string; detail: string; amount: number }[];
  valid: boolean;
}

export function rewardFromScore(score: ExampleScore, cfg: RewardConfig = loadRewardConfig()): RewardBreakdown {
  const contributions = Object.fromEntries(DIMENSIONS.map((d) => [d, cfg.weights[d] * score.dims[d]])) as Record<Dimension, number>;
  if (!score.valid) return { reward: cfg.invalidOutputReward, weighted: 0, penalty: 0, contributions, penalties: [], valid: false };
  const weighted = Object.values(contributions).reduce((a, b) => a + b, 0);
  const penalties = score.violations.map((v) => ({ kind: v.kind, path: v.path, detail: v.detail, amount: cfg.penalties[v.kind] }));
  const penalty = Math.min(cfg.maxTotalPenalty, penalties.reduce((a, p) => a + p.amount, 0));
  const reward = Math.max(-1, Math.min(1, weighted - penalty));
  return { reward, weighted, penalty, contributions, penalties, valid: true };
}

/** One-call reward: completion text for one example. */
export function reward(example: Example, completion: string, cfg?: RewardConfig): RewardBreakdown {
  return rewardFromScore(scoreExample(example, completion), cfg);
}
