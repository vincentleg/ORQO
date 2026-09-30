import type { FeatureKey } from "./plans";

/** Agent tiers of the future organization: Orchestrator → Managers → Specialists. */
export type AgentTier = "orchestrator" | "manager" | "specialist";

export interface AgentDefinition {
  key: AgentKey;
  tier: AgentTier;
  feature: FeatureKey;
}

export const AGENT_KEYS = ["orchestrator", "relationship", "research", "prospecting", "followUp", "signal", "event", "sales", "partnership", "technical", "market", "custom"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

/** Catalog shown in Agents. Presentation only: no agent executes in Phase 2. */
export const AGENTS: readonly AgentDefinition[] = [
  { key: "orchestrator", tier: "orchestrator", feature: "agents.orchestrator" },
  { key: "partnership", tier: "manager", feature: "agents.partnership" },
  { key: "sales", tier: "manager", feature: "agents.sales" },
  { key: "relationship", tier: "specialist", feature: "agents.relationship" },
  { key: "research", tier: "specialist", feature: "agents.research" },
  { key: "prospecting", tier: "specialist", feature: "agents.prospecting" },
  { key: "followUp", tier: "specialist", feature: "agents.followUp" },
  { key: "signal", tier: "specialist", feature: "agents.signal" },
  { key: "event", tier: "specialist", feature: "agents.event" },
  { key: "technical", tier: "specialist", feature: "agents.technical" },
  { key: "market", tier: "specialist", feature: "agents.market" },
  { key: "custom", tier: "specialist", feature: "agents.custom" },
];
