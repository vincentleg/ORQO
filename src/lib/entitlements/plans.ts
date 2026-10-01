/**
 * ORQO plans and features — PRESENTATION model (Phase 2).
 *
 * This module answers UI questions ("is this feature available on this plan?",
 * "which plan does it need?") so components never compare plan strings
 * themselves. It is NOT a security boundary: no billing exists yet and the
 * browser can never be trusted to enforce a plan.
 *
 * Future paid work (agent runs, deep research, prospecting…) must be gated on
 * the server, per request, by the chain:
 *   user → auth → organization → plan → entitlement → usage quota → rate limit
 *   → cost budget → agent authorization → model policy/router → provider.
 * That server layer will reuse these types (Plan, FeatureKey) so the UI and the
 * authoritative check describe features identically.
 */

export const PLANS = ["free", "pro", "business"] as const;
export type Plan = (typeof PLANS)[number];

const RANK: Record<Plan, number> = { free: 0, pro: 1, business: 2 };

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

export function planAtLeast(plan: Plan, required: Plan): boolean {
  return RANK[plan] >= RANK[required];
}

/** "available": usable today. "coming_soon": designed but not built yet, whatever the plan. */
export type Availability = "available" | "coming_soon";

export interface FeatureDefinition {
  /** Lowest plan that includes the feature. */
  minPlan: Plan;
  availability: Availability;
}

/**
 * Feature registry. Free keeps ORQO genuinely useful and is designed to run on
 * deterministic logic and persisted data, not open-ended paid model calls.
 * Pro and Business unlock specialized agents and larger allowances.
 */
export const FEATURES = {
  "search.entry": { minPlan: "free", availability: "available" },
  "search.companyAnalysis": { minPlan: "free", availability: "available" },
  "search.deepResearch": { minPlan: "pro", availability: "available" },
  "network.companies": { minPlan: "free", availability: "available" },
  "network.relationshipMemory": { minPlan: "free", availability: "coming_soon" },
  "discover.suggestions": { minPlan: "free", availability: "coming_soon" },
  "discover.prospectingMissions": { minPlan: "pro", availability: "available" },
  "intelligence.feed": { minPlan: "free", availability: "available" },
  "intelligence.monitoring": { minPlan: "pro", availability: "coming_soon" },
  "dashboard.overview": { minPlan: "free", availability: "available" },
  "agents.relationship": { minPlan: "free", availability: "coming_soon" },
  "agents.research": { minPlan: "pro", availability: "available" },
  "agents.prospecting": { minPlan: "pro", availability: "available" },
  "agents.followUp": { minPlan: "pro", availability: "coming_soon" },
  "agents.signal": { minPlan: "pro", availability: "coming_soon" },
  "agents.event": { minPlan: "pro", availability: "coming_soon" },
  "agents.sales": { minPlan: "pro", availability: "coming_soon" },
  "agents.custom": { minPlan: "pro", availability: "coming_soon" },
  "agents.orchestrator": { minPlan: "business", availability: "coming_soon" },
  "agents.partnership": { minPlan: "business", availability: "available" },
  "agents.technical": { minPlan: "business", availability: "coming_soon" },
  "agents.market": { minPlan: "business", availability: "coming_soon" },
  "workspace.teamControls": { minPlan: "business", availability: "coming_soon" },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureKey = keyof typeof FEATURES;

export type FeatureAccess =
  | { state: "available"; feature: FeatureKey; requiredPlan: Plan }
  | { state: "coming_soon"; feature: FeatureKey; requiredPlan: Plan }
  | { state: "locked"; feature: FeatureKey; requiredPlan: Plan };

/**
 * How a feature presents for a plan. A plan gap wins over "coming soon": the
 * user first needs to know the feature is not part of their plan.
 */
export function featureAccess(plan: Plan, feature: FeatureKey): FeatureAccess {
  const def: FeatureDefinition = FEATURES[feature];
  if (!planAtLeast(plan, def.minPlan)) return { state: "locked", feature, requiredPlan: def.minPlan };
  return { state: def.availability, feature, requiredPlan: def.minPlan };
}

/** The plan to suggest when a feature is locked (the feature's own minimum). */
export function upgradeTarget(plan: Plan, feature: FeatureKey): Plan | null {
  const access = featureAccess(plan, feature);
  return access.state === "locked" ? access.requiredPlan : null;
}

/**
 * Customer-facing usage units. Plans will be expressed in these business
 * units, never in raw model tokens; the server translates units into
 * provider/model costs so models can change without changing plans.
 * No allowances are defined yet.
 */
export const USAGE_UNITS = ["agentRuns", "deepResearchRuns", "prospectingMissions", "monitoredCompanies", "activeAgents", "automatedWorkflows"] as const;
export type UsageUnit = (typeof USAGE_UNITS)[number];

/** Qualitative level shown on the plan comparison. Deliberately not a number. */
export type CapabilityLevel = "none" | "essentials" | "limited" | "included" | "expanded" | "advanced";

export const PLAN_COMPARISON_ROWS = [
  "search",
  "network",
  "opportunities",
  "intelligence",
  "specialistAgents",
  "agentRuns",
  "deepResearchRuns",
  "prospectingMissions",
  "monitoredCompanies",
  "customAgents",
  "teamControls",
] as const;
export type PlanComparisonRow = (typeof PLAN_COMPARISON_ROWS)[number];

export const PLAN_COMPARISON: Record<PlanComparisonRow, Record<Plan, CapabilityLevel>> = {
  search: { free: "essentials", pro: "expanded", business: "expanded" },
  network: { free: "included", pro: "included", business: "included" },
  opportunities: { free: "essentials", pro: "included", business: "included" },
  intelligence: { free: "essentials", pro: "expanded", business: "advanced" },
  specialistAgents: { free: "none", pro: "included", business: "advanced" },
  agentRuns: { free: "none", pro: "included", business: "expanded" },
  deepResearchRuns: { free: "none", pro: "included", business: "expanded" },
  prospectingMissions: { free: "none", pro: "included", business: "expanded" },
  monitoredCompanies: { free: "limited", pro: "expanded", business: "advanced" },
  customAgents: { free: "none", pro: "limited", business: "advanced" },
  teamControls: { free: "none", pro: "none", business: "included" },
};
