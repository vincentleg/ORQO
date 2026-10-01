/**
 * Agent Registry — the single, version-controlled definition of ORQO's core
 * agents (Phase 4). The UI, the policy gate and the orchestrator all read
 * from here; nothing else defines what an agent may do.
 *
 * An agent is a governed business capability: identity, role, capabilities,
 * allowed tools, entitlement, autonomy range, model tasks, limits and
 * contracts. Only agents with status "available" can execute, and only for
 * workspaces the server entitles.
 */
import type { FeatureKey } from "@/lib/entitlements/plans";
import { FEATURES, type Plan } from "@/lib/entitlements/plans";
import type { AgentId, AgentStatus, AgentTier, AutonomyLevel, CapabilityId, MissionType, ModelTask, ToolId } from "./types";

export interface CapabilityDefinition {
  id: CapabilityId;
  /** Tools the capability is implemented with. Empty: not implemented yet. */
  tools: readonly ToolId[];
}

export const CAPABILITIES: Record<CapabilityId, CapabilityDefinition> = {
  company_research: { id: "company_research", tools: ["read_workspace_company", "read_network_company", "read_stored_research", "official_site_research", "deep_company_research", "evaluate_business_relevance"] },
  company_understanding: { id: "company_understanding", tools: ["read_stored_research"] },
  evidence_synthesis: { id: "evidence_synthesis", tools: ["read_stored_research"] },
  business_relevance: { id: "business_relevance", tools: ["read_workspace_company", "evaluate_business_relevance"] },
  opportunity_qualification: { id: "opportunity_qualification", tools: ["read_workspace_company", "read_network_company", "read_stored_research", "evaluate_business_relevance"] },
  market_research: { id: "market_research", tools: [] },
  relationship_context: { id: "relationship_context", tools: [] },
  // Phase 5: plan → source → deduplicate → verify (stored research, then governed official-site research) → qualify → critic.
  prospect_discovery: {
    id: "prospect_discovery",
    tools: [
      "read_workspace_company",
      "build_discovery_plan",
      "read_existing_company_knowledge",
      "source_known_candidates",
      "search_web_candidates",
      "deduplicate_candidates",
      "read_stored_research",
      "official_site_research",
      "qualify_candidate",
      "apply_discovery_critic",
    ],
  },
  followup_preparation: { id: "followup_preparation", tools: [] },
  signal_analysis: { id: "signal_analysis", tools: [] },
  event_analysis: { id: "event_analysis", tools: [] },
};

export interface ExecutionLimits {
  maxToolCalls: number;
  maxModelCalls: number;
  maxExternalRequests: number;
  /** No automatic retries in Phase 4. */
  maxRetries: number;
  maxDurationMs: number;
  /** Provider-reported spend ceiling, where measurable. null: no variable spend allowed beyond tool limits. */
  maxVariableCostUsd: number | null;
}

export interface AgentDefinition {
  id: AgentId;
  tier: AgentTier;
  /** Manager (or the orchestrator) this agent reports to. */
  parent: AgentId | null;
  /** Entitlement feature; its minPlan is the agent's plan requirement. */
  feature: FeatureKey;
  status: AgentStatus;
  capabilities: readonly CapabilityId[];
  /** Explicit allow-list. A tool must be here AND in one of the agent's capabilities. */
  tools: readonly ToolId[];
  /** Mission types the agent accepts directly. Empty: cannot receive direct missions. */
  missionTypes: readonly MissionType[];
  autonomy: { default: AutonomyLevel; min: AutonomyLevel; max: AutonomyLevel };
  /** Model task classes the agent's tools may request (resolved by the server model policy). */
  modelTasks: readonly ModelTask[];
  limits: ExecutionLimits;
  /** Contract ids (see contracts.ts). */
  inputContract: MissionType | null;
  outputContract: "company_analysis" | "company_discovery" | null;
}

/** Conservative default for agents that cannot execute yet. */
const NO_EXECUTION: ExecutionLimits = { maxToolCalls: 0, maxModelCalls: 0, maxExternalRequests: 0, maxRetries: 0, maxDurationMs: 0, maxVariableCostUsd: null };

function planned(id: AgentId, tier: AgentTier, parent: AgentId | null, capabilities: readonly CapabilityId[]): AgentDefinition {
  return {
    id,
    tier,
    parent,
    feature: `agents.${id}` as FeatureKey,
    status: "coming_soon",
    capabilities,
    tools: [],
    missionTypes: [],
    autonomy: { default: 0, min: 0, max: 0 },
    modelTasks: [],
    limits: NO_EXECUTION,
    inputContract: null,
    outputContract: null,
  };
}

export const AGENT_REGISTRY: Record<AgentId, AgentDefinition> = {
  orchestrator: planned("orchestrator", "orchestrator", null, []),
  partnership: {
    id: "partnership",
    tier: "manager",
    parent: "orchestrator",
    feature: "agents.partnership",
    status: "available",
    capabilities: ["opportunity_qualification", "business_relevance", "evidence_synthesis"],
    // Explains EXISTING analysis only: no web access, no paid provider.
    tools: ["read_workspace_company", "read_network_company", "read_stored_research", "evaluate_business_relevance"],
    missionTypes: ["explain_opportunities"],
    autonomy: { default: 1, min: 0, max: 2 },
    modelTasks: [],
    limits: { maxToolCalls: 6, maxModelCalls: 0, maxExternalRequests: 0, maxRetries: 0, maxDurationMs: 15_000, maxVariableCostUsd: null },
    inputContract: "explain_opportunities",
    outputContract: "company_analysis",
  },
  sales: planned("sales", "manager", "orchestrator", ["opportunity_qualification"]),
  relationship: planned("relationship", "specialist", "partnership", ["relationship_context"]),
  research: {
    id: "research",
    tier: "specialist",
    parent: "partnership",
    feature: "agents.research",
    status: "available",
    capabilities: ["company_research", "company_understanding", "evidence_synthesis", "business_relevance"],
    tools: ["read_workspace_company", "read_network_company", "read_stored_research", "official_site_research", "deep_company_research", "evaluate_business_relevance"],
    missionTypes: ["analyze_company"],
    // Execute (3) is not granted to any agent in Phase 4.
    autonomy: { default: 1, min: 0, max: 2 },
    modelTasks: ["extraction", "business_reasoning"],
    limits: { maxToolCalls: 8, maxModelCalls: 2, maxExternalRequests: 12, maxRetries: 0, maxDurationMs: 130_000, maxVariableCostUsd: null },
    inputContract: "analyze_company",
    outputContract: "company_analysis",
  },
  prospecting: {
    id: "prospecting",
    tier: "specialist",
    parent: "sales",
    feature: "agents.prospecting",
    status: "available",
    capabilities: ["prospect_discovery", "company_research", "business_relevance", "opportunity_qualification"],
    // No deep research, no model: discovery is deterministic. Web search is the only paid tool and needs approval.
    tools: [
      "read_workspace_company",
      "build_discovery_plan",
      "read_existing_company_knowledge",
      "source_known_candidates",
      "search_web_candidates",
      "deduplicate_candidates",
      "read_stored_research",
      "official_site_research",
      "qualify_candidate",
      "apply_discovery_critic",
    ],
    missionTypes: ["discover_companies"],
    autonomy: { default: 1, min: 0, max: 2 },
    modelTasks: [],
    // Stricter than analysis: 1 search call (≤ 2 queries) + ≤ 3 official-site analyses (5 requests each); tool calls cover
    // plan, knowledge, sourcing, dedup, ≤ 6 verifications (read + research + re-read for 3), ≤ 6 qualifications and the critic.
    limits: { maxToolCalls: 28, maxModelCalls: 0, maxExternalRequests: 17, maxRetries: 0, maxDurationMs: 130_000, maxVariableCostUsd: null },
    inputContract: "discover_companies",
    outputContract: "company_discovery",
  },
  followUp: planned("followUp", "specialist", "sales", ["followup_preparation"]),
  signal: planned("signal", "specialist", "partnership", ["signal_analysis"]),
  event: planned("event", "specialist", "sales", ["event_analysis"]),
  technical: planned("technical", "specialist", "partnership", ["company_understanding"]),
  market: planned("market", "specialist", "partnership", ["market_research"]),
  custom: planned("custom", "specialist", "orchestrator", []),
};

/** Catalog order (Phase 2): orchestrator, managers, specialists. */
export const AGENT_ORDER: readonly AgentId[] = ["orchestrator", "partnership", "sales", "relationship", "research", "prospecting", "followUp", "signal", "event", "technical", "market", "custom"];

export function getAgent(id: string): AgentDefinition | null {
  return Object.prototype.hasOwnProperty.call(AGENT_REGISTRY, id) ? AGENT_REGISTRY[id as AgentId] : null;
}

export function requiredPlan(agent: AgentDefinition): Plan {
  return FEATURES[agent.feature].minPlan;
}

export function childrenOf(id: AgentId): AgentDefinition[] {
  return AGENT_ORDER.map((a) => AGENT_REGISTRY[a]).filter((a) => a.parent === id);
}

/**
 * Deterministic mission routing: each mission type has exactly one owning
 * agent and capability. No model is involved in routing.
 */
export const MISSION_ROUTES: Record<MissionType, { agent: AgentId; capability: CapabilityId }> = {
  analyze_company: { agent: "research", capability: "company_research" },
  explain_opportunities: { agent: "partnership", capability: "opportunity_qualification" },
  discover_companies: { agent: "prospecting", capability: "prospect_discovery" },
};
