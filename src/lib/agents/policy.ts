/**
 * Agent policy — pure decisions, enforced server-side.
 *
 * Mission authorization:
 *   registered agent → agent status → mission type accepted → role (member+)
 *   → plan entitlement (or server-side operator preview) → autonomy in range.
 * Tool authorization (every call):
 *   registered tool → capability granted to the agent → tool belongs to that
 *   capability → tool on the agent's allow-list → run autonomy ≥ tool minimum
 *   → approval requirement.
 *
 * Inputs come from the registry and the server's own lookups. Nothing here
 * accepts a plan, permission or budget from a caller, a tool result or a model.
 */
import { planAtLeast, type Plan } from "@/lib/entitlements/plans";
import { roleAtLeastPure, type Role } from "./roles";
import { CAPABILITIES, getAgent, MISSION_ROUTES, requiredPlan, type AgentDefinition } from "./registry";
import { isRegisteredTool, TOOLS } from "./tools";
import type { ApprovalState, AutonomyLevel, CapabilityId, MissionType } from "./types";

export type MissionDenial = "unknown_agent" | "agent_unavailable" | "mission_not_supported" | "role" | "plan_required" | "autonomy_not_allowed";

export type MissionDecision =
  | { ok: true; agent: AgentDefinition; capability: CapabilityId; autonomy: AutonomyLevel }
  | { ok: false; reason: MissionDenial; requiredPlan: Plan | null };

export interface MissionPolicyInput {
  /** Optional: the caller may name the agent; it must own the mission type. */
  agentId: string | null;
  missionType: MissionType;
  role: Role;
  /** Authoritative plan from the server (billing), never from the client. */
  entitledPlan: Plan;
  /** Server-side operator preview allow-list for this organization. */
  preview: boolean;
  /** Requested autonomy; null → the agent's default. */
  requestedAutonomy: AutonomyLevel | null;
}

export function decideMission(input: MissionPolicyInput): MissionDecision {
  const route = MISSION_ROUTES[input.missionType];
  const agent = getAgent(input.agentId ?? route.agent);
  if (!agent) return { ok: false, reason: "unknown_agent", requiredPlan: null };
  if (agent.status !== "available") return { ok: false, reason: "agent_unavailable", requiredPlan: null };
  if (agent.id !== route.agent || !agent.missionTypes.includes(input.missionType)) return { ok: false, reason: "mission_not_supported", requiredPlan: null };
  if (!roleAtLeastPure(input.role, "member")) return { ok: false, reason: "role", requiredPlan: null };
  const plan = requiredPlan(agent);
  if (!planAtLeast(input.entitledPlan, plan) && !input.preview) return { ok: false, reason: "plan_required", requiredPlan: plan };
  const autonomy = input.requestedAutonomy ?? agent.autonomy.default;
  if (autonomy < agent.autonomy.min || autonomy > agent.autonomy.max) return { ok: false, reason: "autonomy_not_allowed", requiredPlan: null };
  return { ok: true, agent, capability: route.capability, autonomy };
}

export type ToolDenial = "tool_not_registered" | "capability_not_granted" | "tool_not_in_capability" | "tool_not_allowed" | "autonomy_too_low";

export type ToolDecision = { ok: true; approval: Extract<ApprovalState, "not_required" | "required"> } | { ok: false; reason: ToolDenial };

/** Whether `agent`, working under `capability` at `autonomy`, may call `toolId` — and whether a human must approve it first. */
export function decideTool(agent: AgentDefinition, capability: CapabilityId, toolId: string, autonomy: AutonomyLevel): ToolDecision {
  if (!isRegisteredTool(toolId)) return { ok: false, reason: "tool_not_registered" };
  if (!agent.capabilities.includes(capability)) return { ok: false, reason: "capability_not_granted" };
  if (!CAPABILITIES[capability].tools.includes(toolId)) return { ok: false, reason: "tool_not_in_capability" };
  if (!agent.tools.includes(toolId)) return { ok: false, reason: "tool_not_allowed" };
  const tool = TOOLS[toolId];
  if (autonomy < tool.minAutonomy) return { ok: false, reason: "autonomy_too_low" };
  const approval = tool.approval === "always" || (tool.approval === "below_execute" && autonomy < 3) ? "required" : "not_required";
  return { ok: true, approval };
}

/** Observe (0) analyzes only; Recommend (1) and above may propose a next action. */
export function mayRecommend(autonomy: AutonomyLevel): boolean {
  return autonomy >= 1;
}

/** Roles that may decide an approval. Deciding is never possible through a run payload. */
export function mayDecideApproval(role: Role): boolean {
  return roleAtLeastPure(role, "admin");
}

/** Approvals expire; an expired approval can never be granted. */
export const APPROVAL_TTL_HOURS = 24;
