/**
 * Tool Registry — metadata only. Implementations live on the server
 * (src/lib/server/agents/tools.ts) and are keyed by the same ids, so a tool
 * without metadata cannot be executed and metadata without an implementation
 * is caught by tests.
 *
 * Only real operations are registered. The shape (id, schemas, cost/risk,
 * network, approval) is deliberately compatible with future MCP-backed tools.
 */
import type { AutonomyLevel, ToolId } from "./types";

/** none: pure computation · internal: database reads/writes · external_free: public web, no paid provider · variable: paid provider. */
export type CostClass = "none" | "internal" | "external_free" | "variable";
/** read: workspace data · external_read: reads the public web · external_write / high_impact: reserved for future tools. */
export type RiskClass = "read" | "external_read" | "external_write" | "high_impact";
/** never: no approval · below_execute: required unless the run has Execute autonomy · always: always required. */
export type ApprovalRule = "never" | "below_execute" | "always";

export interface ToolLimits {
  /** Upper bound on outbound HTTP requests one call may make (reserved before the call). */
  maxExternalRequests: number;
  /** Upper bound on model calls one call may make (reserved before the call). */
  maxModelCalls: number;
  timeoutMs: number;
}

export interface ToolDefinition {
  id: ToolId;
  purpose: string;
  costClass: CostClass;
  risk: RiskClass;
  externalNetwork: boolean;
  variableCost: boolean;
  approval: ApprovalRule;
  /** Lowest autonomy level at which an agent may call the tool. */
  minAutonomy: AutonomyLevel;
  limits: ToolLimits;
}

// Phase 5 — Discover & Prospecting. Internal or deterministic, except web search (paid, approval-gated).
const pure = (id: ToolId, purpose: string): ToolDefinition => ({ id, purpose, costClass: "none", risk: "read", externalNetwork: false, variableCost: false, approval: "never", minAutonomy: 0, limits: { maxExternalRequests: 0, maxModelCalls: 0, timeoutMs: 5_000 } });
const internal = (id: ToolId, purpose: string): ToolDefinition => ({ ...pure(id, purpose), costClass: "internal" });

export const TOOLS: Record<ToolId, ToolDefinition> = {
  read_workspace_company: {
    id: "read_workspace_company",
    purpose: "Read this workspace's own company profile.",
    costClass: "internal",
    risk: "read",
    externalNetwork: false,
    variableCost: false,
    approval: "never",
    minAutonomy: 0,
    limits: { maxExternalRequests: 0, maxModelCalls: 0, timeoutMs: 5_000 },
  },
  read_network_company: {
    id: "read_network_company",
    purpose: "Read one company of this workspace's Network.",
    costClass: "internal",
    risk: "read",
    externalNetwork: false,
    variableCost: false,
    approval: "never",
    minAutonomy: 0,
    limits: { maxExternalRequests: 0, maxModelCalls: 0, timeoutMs: 5_000 },
  },
  read_stored_research: {
    id: "read_stored_research",
    purpose: "Read this workspace's stored company analysis and evidence.",
    costClass: "internal",
    risk: "read",
    externalNetwork: false,
    variableCost: false,
    approval: "never",
    minAutonomy: 0,
    limits: { maxExternalRequests: 0, maxModelCalls: 0, timeoutMs: 5_000 },
  },
  official_site_research: {
    id: "official_site_research",
    purpose: "Run the governed official-website company analysis (Phase 3 Basic). No paid provider.",
    costClass: "external_free",
    risk: "external_read",
    externalNetwork: true,
    variableCost: false,
    approval: "never",
    minAutonomy: 1,
    // robots.txt + 4 official pages (RESEARCH_LIMITS.basic).
    limits: { maxExternalRequests: 5, maxModelCalls: 0, timeoutMs: 45_000 },
  },
  deep_company_research: {
    id: "deep_company_research",
    purpose: "Run the governed deep research (Phase 3 Deep): search API, third-party pages and model extraction.",
    costClass: "variable",
    risk: "external_read",
    externalNetwork: true,
    variableCost: true,
    approval: "below_execute",
    minAutonomy: 2,
    // 2 search queries + robots.txt + 5 official + 2 third-party pages; 2 model calls (RESEARCH_LIMITS.deep).
    limits: { maxExternalRequests: 10, maxModelCalls: 2, timeoutMs: 115_000 },
  },
  evaluate_business_relevance: {
    id: "evaluate_business_relevance",
    purpose: "Compare the target with the own profile: mechanism rules, critic and quality gate (deterministic).",
    costClass: "none",
    risk: "read",
    externalNetwork: false,
    variableCost: false,
    approval: "never",
    minAutonomy: 0,
    limits: { maxExternalRequests: 0, maxModelCalls: 0, timeoutMs: 5_000 },
  },
  // Phase 5 — Discover & Prospecting.
  build_discovery_plan: pure("build_discovery_plan", "Translate the workspace profile and the objective into mechanisms, target characteristics, queries, exclusions, required evidence and key unknowns (deterministic)."),
  read_relationship_context: internal("read_relationship_context", "Read the private relationship memory of one Network company: stage, origin, contact names and roles, recent interactions and open follow-ups. No contact channels or free-text notes."),
  read_company_signals: internal("read_company_signals", "Read the stored public signals of one Network company: kind, what changed, evidence quality, source and dates. Public information only; no private relationship memory."),
  read_existing_company_knowledge: internal("read_existing_company_knowledge", "Read what this workspace already knows: Network companies, stored analyses and recent discovery rejections."),
  source_known_candidates: internal("source_known_candidates", "Candidate source over this workspace's own knowledge (stored analyses and Network). Not live web discovery."),
  search_web_candidates: {
    id: "search_web_candidates",
    purpose: "Candidate source over a configured web-search provider. Results are discovery hints only, never evidence.",
    costClass: "variable",
    risk: "external_read",
    externalNetwork: true,
    variableCost: true,
    approval: "below_execute",
    minAutonomy: 2,
    // DISCOVERY_LIMITS.maxQueries search queries.
    limits: { maxExternalRequests: 2, maxModelCalls: 0, timeoutMs: 20_000 },
  },
  deduplicate_candidates: pure("deduplicate_candidates", "Normalize identities, remove duplicates and non-company sites, attach Network and stored-research knowledge, apply rejection memory."),
  qualify_candidate: pure("qualify_candidate", "Qualify one verified company: Phase 3 mechanism rules and critic, restricted to the discovery plan."),
  apply_discovery_critic: pure("apply_discovery_critic", "Discovery critic: requested geography and market, evidence floor, competitor risk, explainable priority."),
};

export function isRegisteredTool(id: string): id is ToolId {
  return Object.prototype.hasOwnProperty.call(TOOLS, id);
}
