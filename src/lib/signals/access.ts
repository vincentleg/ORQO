/**
 * Who may use which part of Intelligence (Phase 7). Product capability and
 * commercial entitlement stay separate:
 *  - the Intelligence workspace (stored signals, deterministic relevance,
 *    recording a public change) is a Free capability with no variable cost;
 *  - AI reasoning over signals belongs to the Signals Agent: it needs the
 *    agent to be built (registry status) AND the plan, or operator preview.
 *    While the agent is "coming soon", nobody reaches a model — preview included.
 */
import { AGENT_REGISTRY, requiredPlan } from "@/lib/agents/registry";
import { planAtLeast, type Plan } from "@/lib/entitlements/plans";

export type SignalReasoningDecision = { ok: true; via: "plan" | "preview" } | { ok: false; reason: "agent_unavailable" | "plan_required" };

export function signalReasoningDecision(input: { entitledPlan: Plan; preview: boolean }): SignalReasoningDecision {
  const agent = AGENT_REGISTRY.signal;
  if (agent.status !== "available") return { ok: false, reason: "agent_unavailable" };
  if (planAtLeast(input.entitledPlan, requiredPlan(agent))) return { ok: true, via: "plan" };
  if (input.preview) return { ok: true, via: "preview" };
  return { ok: false, reason: "plan_required" };
}
