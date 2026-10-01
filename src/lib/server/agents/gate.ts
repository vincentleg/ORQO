import "server-only";
/**
 * Server-side authority chain for agent execution:
 *
 *   user → auth → organization membership → role → authoritative plan
 *   (or operator preview) → agent entitlement → mission contract → autonomy
 *   → [create_agent_mission: idempotency, concurrency, quota]
 *   → [orchestrator: tool permission, approval, budget per call]
 *
 * The browser's view of plan, lock state, tools or budget is never used.
 */
import { decideMission, type MissionDenial } from "@/lib/agents/policy";
import { organizationAccess, type AgentAccess } from "@/lib/agents/organization";
import type { AgentDefinition } from "@/lib/agents/registry";
import type { AgentId, AutonomyLevel, CapabilityId, MissionType } from "@/lib/agents/types";
import type { Plan } from "@/lib/entitlements/plans";
import { AppError } from "@/lib/server/errors";
import { getEntitledPlan } from "@/lib/server/entitlements";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { Db } from "@/lib/server/supabase/types";
import type { OrgRole } from "@/lib/server/tenancy/roles";
import { agentPreviewOrgs } from "./config";

export class AgentDeniedError extends AppError {
  constructor(
    readonly reason: MissionDenial,
    readonly requiredPlan: Plan | null = null,
  ) {
    super(reason === "plan_required" || reason === "role" ? "forbidden" : "invalid_input", MESSAGES[reason]);
  }
}

const MESSAGES: Record<MissionDenial, string> = {
  unknown_agent: "This agent does not exist.",
  agent_unavailable: "This agent is not available yet.",
  mission_not_supported: "This agent does not accept this mission.",
  role: "Your role does not allow running agents.",
  plan_required: "This agent is not included in your plan.",
  autonomy_not_allowed: "This autonomy level is not allowed for this agent.",
};

export function isAgentPreview(organizationId: string): boolean {
  return agentPreviewOrgs().has(organizationId.toLowerCase());
}

export interface AuthorizedMission {
  organizationId: string;
  agent: AgentDefinition;
  capability: CapabilityId;
  autonomy: AutonomyLevel;
  role: OrgRole;
}

export async function authorizeMission(db: Db, userId: string, requestedOrganizationId: string, req: { agentId: string | null; missionType: MissionType; autonomy: AutonomyLevel | null }): Promise<AuthorizedMission> {
  const membership = await requireMembership(db, userId, requestedOrganizationId, "viewer");
  const plan = await getEntitledPlan(membership.organizationId);
  const d = decideMission({ agentId: req.agentId, missionType: req.missionType, role: membership.role, entitledPlan: plan, preview: isAgentPreview(membership.organizationId), requestedAutonomy: req.autonomy });
  if (!d.ok) throw new AgentDeniedError(d.reason, d.requiredPlan);
  return { organizationId: membership.organizationId, agent: d.agent, capability: d.capability, autonomy: d.autonomy, role: membership.role };
}

/** Membership for reads and decisions (viewer+), as the only proof of access. */
export async function requireAgentReader(db: Db, userId: string, organizationId: string) {
  return requireMembership(db, userId, organizationId, "viewer");
}

export type { AgentAccess };

/**
 * What the Agents UI may show for each agent. Presentation only — authorizeMission decides.
 * Phase 9: computed by the pure agentAccess, which mirrors decideMission (tested). A coming-soon agent is
 * shown as coming soon on every plan: upgrading would not make it run.
 */
export async function agentCatalogAccess(organizationId: string, role: OrgRole): Promise<Record<AgentId, AgentAccess>> {
  return organizationAccess({ entitledPlan: await getEntitledPlan(organizationId), preview: isAgentPreview(organizationId), role });
}
