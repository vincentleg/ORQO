/**
 * Agent catalog view for entitlement code. Phase 4: derived from the single
 * Agent Registry (src/lib/agents/registry.ts) so agent definitions are never
 * duplicated.
 */
import { AGENT_ORDER, AGENT_REGISTRY } from "@/lib/agents/registry";
import { AGENT_IDS, type AgentId, type AgentTier } from "@/lib/agents/types";
import type { FeatureKey } from "./plans";

export type { AgentTier };
export type AgentKey = AgentId;
export const AGENT_KEYS = AGENT_IDS;

export interface AgentDefinition {
  key: AgentKey;
  tier: AgentTier;
  feature: FeatureKey;
}

export const AGENTS: readonly AgentDefinition[] = AGENT_ORDER.map((id) => ({ key: id, tier: AGENT_REGISTRY[id].tier, feature: AGENT_REGISTRY[id].feature }));
