/**
 * Server-side entitlement resolution (Phase 17A). The billing plan comes from billing (not built yet: every
 * organization is Free); Internal and the money ceiling come from server configuration only
 * (see src/lib/governance/entitlement.ts). Nothing from a browser, a model or a tool is read.
 */
import type { Plan } from "@/lib/entitlements/plans";
import { resolveEntitlementFrom, type Entitlement } from "@/lib/governance/entitlement";

/** The billing plan. Billing does not exist yet: Free for every organization. */
export async function billingPlan(organizationId: string): Promise<Plan> {
  void organizationId;
  return "free";
}

export async function resolveEntitlement(organizationId: string, env: Record<string, string | undefined> = process.env): Promise<Entitlement> {
  return resolveEntitlementFrom(organizationId, await billingPlan(organizationId), env);
}
