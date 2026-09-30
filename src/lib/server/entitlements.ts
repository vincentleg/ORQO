import "server-only";
import type { Plan } from "@/lib/entitlements/plans";

/**
 * Plan the workspace is PRESENTED as having (Phase 2).
 *
 * No billing exists yet, so every workspace is presented as Free. This value
 * only drives what the UI shows; it grants nothing. When billing lands, this
 * function becomes an authoritative server-side lookup (subscription →
 * entitlements) with the same signature, and every paid server route must
 * check entitlement, quota, rate limit and cost budget itself — never trust
 * the browser's view of the plan.
 */
export async function getPresentedPlan(organizationId: string): Promise<Plan> {
  void organizationId;
  return "free";
}

/**
 * Plan used for AUTHORIZATION of variable-cost work (Phase 3).
 *
 * There is no billing yet, so no workspace is entitled beyond Free. This is
 * deliberately separate from getPresentedPlan: when billing lands, this
 * becomes the subscription lookup and every research/agent route keeps
 * calling it before any provider is reached.
 */
export async function getEntitledPlan(organizationId: string): Promise<Plan> {
  void organizationId;
  return "free";
}
