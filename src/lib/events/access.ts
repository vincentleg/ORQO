/**
 * Who may use which part of Events (Phase 8). Product capability and
 * commercial entitlement stay separate:
 *  - the Events workspace (events, targets, deterministic preparation, fast
 *    capture into canonical Network records, review) is a Free capability with
 *    no variable cost;
 *  - autonomous event work (research, attendee/exhibitor discovery, briefs)
 *    belongs to the Event Agent: it needs the agent to be built (registry
 *    status) AND the plan, or operator preview. While the agent is "coming
 *    soon", nobody reaches a provider or a model — preview included.
 */
import { AGENT_REGISTRY, requiredPlan } from "@/lib/agents/registry";
import { planAtLeast, type Plan } from "@/lib/entitlements/plans";

export type EventAgentDecision = { ok: true; via: "plan" | "preview" } | { ok: false; reason: "agent_unavailable" | "plan_required" };

export function eventAgentDecision(input: { entitledPlan: Plan; preview: boolean }): EventAgentDecision {
  const agent = AGENT_REGISTRY.event;
  if (agent.status !== "available") return { ok: false, reason: "agent_unavailable" };
  if (planAtLeast(input.entitledPlan, requiredPlan(agent))) return { ok: true, via: "plan" };
  if (input.preview) return { ok: true, via: "preview" };
  return { ok: false, reason: "plan_required" };
}
