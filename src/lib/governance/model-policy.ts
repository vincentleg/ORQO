/**
 * Model Policy Engine (Phase 17A): which model a task may use, at what price cap, and the worst-case cost
 * reserved before the call. Pure, deterministic, code-reviewed.
 *
 * - Agents request a TASK, never a model. The policy picks the model from server configuration.
 * - The default is the economy model; a stronger tier is used only when the task needs it AND the
 *   authority allows it (Pro: economy only).
 * - Every call carries a price cap (sent to OpenRouter as max_price), so the reservation is a true worst case.
 * - At most ONE fallback candidate, covered by its own reservation in the same budget. No retry chains.
 * - Free and missing authority get no model at all (decided upstream by the provider gate).
 */
import type { ModelTask } from "@/lib/agents/types";
import { tierAllows, type ModelTier } from "./authority";
import type { GovernanceEnv } from "./entitlement";

export const DEFAULT_MODEL = "google/gemini-3.8-flash";

/** USD per million tokens. The provider must not charge above these (max_price). */
export const TIER_PRICE_CAPS: Record<ModelTier, { prompt: number; completion: number }> = {
  economy: { prompt: 0.5, completion: 3 },
  standard: { prompt: 3, completion: 15 },
};

export interface TaskPolicy {
  tier: ModelTier;
  maxInputTokens: number;
  maxOutputTokens: number;
  structuredOutput: true;
  latency: "interactive" | "background";
  env: string;
}

export const TASK_POLICY: Record<ModelTask, TaskPolicy> = {
  // Mechanical, high-volume: cheapest adequate model.
  extraction: { tier: "economy", maxInputTokens: 16_000, maxOutputTokens: 4_000, structuredOutput: true, latency: "background", env: "ORQO_MODEL_EXTRACTION" },
  synthesis: { tier: "economy", maxInputTokens: 8_000, maxOutputTokens: 2_000, structuredOutput: true, latency: "interactive", env: "ORQO_MODEL_SYNTHESIS" },
  // Business reasoning and critique may use the standard tier when the authority allows it.
  business_reasoning: { tier: "standard", maxInputTokens: 16_000, maxOutputTokens: 4_000, structuredOutput: true, latency: "background", env: "ORQO_MODEL_REASONING" },
  critique: { tier: "standard", maxInputTokens: 8_000, maxOutputTokens: 2_000, structuredOutput: true, latency: "background", env: "ORQO_MODEL_CRITIQUE" },
};

const MODEL_ID = /^[A-Za-z0-9._:/-]{1,120}$/;

export interface ModelAttempt {
  model: string;
  tier: ModelTier;
  /** Sent to the provider: it must refuse to charge more. */
  maxPrice: { prompt: number; completion: number };
  maxOutputTokens: number;
  maxInputTokens: number;
  /** Worst-case cost of this attempt, reserved before it is sent. */
  reservationUsd: number;
}

export interface ModelSelection {
  task: ModelTask;
  primary: ModelAttempt;
  /** One bounded fallback (a different configured model), or none. */
  fallback: ModelAttempt | null;
}

export function reservationFor(tier: ModelTier, maxInputTokens: number, maxOutputTokens: number): number {
  const cap = TIER_PRICE_CAPS[tier];
  const usd = (maxInputTokens * cap.prompt + maxOutputTokens * cap.completion) / 1_000_000;
  return Math.ceil(usd * 1e6) / 1e6;
}

/**
 * The model for a task under an authority's tier ceiling. Null when the authority grants no tier
 * (no paid model). Input size is bounded by the task policy; a caller may only ask for less.
 */
export function selectModel(task: ModelTask, opts: { maxTier: ModelTier | null; env: GovernanceEnv; inputTokens?: number }): ModelSelection | null {
  if (!opts.maxTier) return null;
  const p = TASK_POLICY[task];
  const tier: ModelTier = tierAllows(opts.maxTier, p.tier) ? p.tier : opts.maxTier;
  const inputTokens = Math.min(opts.inputTokens ?? p.maxInputTokens, p.maxInputTokens);
  const configured = [opts.env[p.env], opts.env.ORQO_DISCOVERY_MODEL, opts.env.OPENROUTER_MODEL, DEFAULT_MODEL].filter((m): m is string => Boolean(m && MODEL_ID.test(m)));
  const candidates = [...new Set(configured)];
  const attempt = (model: string): ModelAttempt => ({ model, tier, maxPrice: TIER_PRICE_CAPS[tier], maxOutputTokens: p.maxOutputTokens, maxInputTokens: inputTokens, reservationUsd: reservationFor(tier, inputTokens, p.maxOutputTokens) });
  return { task, primary: attempt(candidates[0]), fallback: candidates[1] ? attempt(candidates[1]) : null };
}

/** Brave does not report cost: each query reserves (and, unknown, settles) this conservative amount. */
export const BRAVE_QUERY_RESERVATION_USD = 0.01;
