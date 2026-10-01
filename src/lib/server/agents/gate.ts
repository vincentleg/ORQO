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
import { AGENT_ORDER, AGENT_REGISTRY, requiredPlan, type AgentDefinition } from "@/lib/agents/registry";
import type { AutonomyLevel, CapabilityId, MissionType } from "@/lib/agents/types";
import { planAtLeast, type Plan } from "@/lib/entitlements/plans";
import { AppError } from "@/lib/server/errors";
import { getEntitledPlan } from "@/lib/server/entitlements";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { Db } from "@/lib/server/supabase/types";
import { roleAtLeast, type OrgRole } from "@/lib/server/tenancy/roles";
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

export type AgentAccess =
  | { state: "executable"; via: "plan" | "preview" }
  | { state: "locked"; requiredPlan: Plan }
  | { state: "coming_soon" }
  | { state: "disabled" }
  | { state: "role" };

/** What the Agents UI may show for each agent. Presentation only — authorizeMission decides. */
export async function agentCatalogAccess(organizationId: string, role: OrgRole): Promise<Record<string, AgentAccess>> {
  const plan = await getEntitledPlan(organizationId);
  const preview = isAgentPreview(organizationId);
  const out: Record<string, AgentAccess> = {};
  for (const id of AGENT_ORDER) {
    const a = AGENT_REGISTRY[id];
    const entitled = planAtLeast(plan, requiredPlan(a));
    if (a.status === "coming_soon") out[id] = entitled ? { state: "coming_soon" } : { state: "locked", requiredPlan: requiredPlan(a) };
    else if (a.status === "disabled") out[id] = { state: "disabled" };
    else if (!entitled && !preview) out[id] = { state: "locked", requiredPlan: requiredPlan(a) };
    else if (!roleAtLeast(role, "member")) out[id] = { state: "role" };
    else out[id] = { state: "executable", via: entitled ? "plan" : "preview" };
  }
  return out;
}
