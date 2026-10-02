/**
 * Entitlement (Phase 17A): who may use the paid workforce, and within which money ceiling.
 *
 * Pure. Inputs come from server configuration only, never from a browser, a model or a tool.
 * - Free / Pro / Business: the billing plan (billing does not exist yet, so every organization is Free).
 * - Internal (Founder): an organization the operator lists in ORQO_INTERNAL_ORGS. It unlocks the Business
 *   workforce features. It bypasses nothing: provider gate, usage accounting, budget reservation, hard
 *   ceiling, runtime limits, authority, approvals, tripwires, kill switch and RLS all still apply.
 * - Money ceiling: Internal organizations share the configured rolling 30-day ceiling
 *   ORQO_INTERNAL_BUDGET_USD. Paid plans have no configured ceiling yet. A missing or invalid ceiling means
 *   NO paid spend (fail safe).
 *
 * Deprecated aliases, kept so existing operator configuration keeps its meaning:
 * - ORQO_RESEARCH_PREVIEW_ORGS: Internal;
 * - ORQO_AGENT_PREVIEW_ORGS: agents preview only (never paid spend).
 */
import { planAtLeast, type Plan } from "@/lib/entitlements/plans";

export type EntitlementTier = Plan | "internal";

export interface Entitlement {
  /** Billing plan (always "free" until billing exists). */
  plan: Plan;
  internal: boolean;
  /** Legacy operator preview of agents (agents only, never paid spend). */
  agentPreview: boolean;
  /** The plan used for feature access: Internal unlocks the Business features. */
  featurePlan: Plan;
  tier: EntitlementTier;
  /** Rolling 30-day money ceiling for paid providers, in USD. Null: no paid spend at all. */
  budgetUsd: number | null;
}

export const BUDGET_WINDOW_DAYS = 30;
/** No configuration can set a ceiling above this (a typo must not open the tap). */
export const MAX_CONFIGURABLE_BUDGET_USD = 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function orgList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => UUID.test(s)),
  );
}

/** A positive, finite, bounded number of dollars, or null (invalid or absent → no paid spend). */
export function parseBudget(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "" || !/^\d+(\.\d{1,6})?$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 && n <= MAX_CONFIGURABLE_BUDGET_USD ? n : null;
}

export type GovernanceEnv = Record<string, string | undefined>;

export function resolveEntitlementFrom(organizationId: string, plan: Plan, env: GovernanceEnv): Entitlement {
  const id = organizationId.toLowerCase();
  const internal = orgList(env.ORQO_INTERNAL_ORGS).has(id) || orgList(env.ORQO_RESEARCH_PREVIEW_ORGS).has(id);
  const agentPreview = orgList(env.ORQO_AGENT_PREVIEW_ORGS).has(id);
  const featurePlan: Plan = internal ? "business" : plan;
  return { plan, internal, agentPreview, featurePlan, tier: internal ? "internal" : plan, budgetUsd: internal ? parseBudget(env.ORQO_INTERNAL_BUDGET_USD) : null };
}

/** Paid workforce (variable-cost providers) requires a paid plan or Internal, and a configured ceiling. */
export function mayUsePaidProviders(e: Entitlement): boolean {
  return (e.internal || planAtLeast(e.plan, "pro")) && e.budgetUsd !== null;
}
