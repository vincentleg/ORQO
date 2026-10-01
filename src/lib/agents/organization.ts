/**
 * Agent Organization (Phase 9) — pure, deterministic views over the Agent
 * Registry: who reports to whom, what each agent can actually do for a
 * workspace, what it may read, and how a mission decomposes into capability
 * steps.
 *
 * Nothing here executes anything, calls a provider or a model, or persists.
 * Inputs are the registry (trusted code) and the server's own plan, preview
 * and role lookups. Mission planning is routing over capability metadata: it
 * never runs a step, never chains agents and never loops.
 */
import { planAtLeast, type Plan } from "@/lib/entitlements/plans";
import { PRIVATE_FIELDS, TOOL_PERMISSIONS, DATA_DOMAINS, type DataDomain, type PrivateField, type ToolAccess } from "./permissions";
import { roleAtLeastPure, type Role } from "./roles";
import { AGENT_ORDER, AGENT_REGISTRY, CAPABILITIES, MISSION_ROUTES, requiredPlan, type AgentDefinition } from "./registry";
import { TOOLS, type CostClass } from "./tools";
import { MISSION_TYPES, type AgentId, type AutonomyLevel, type CapabilityId, type MissionType, type ToolId } from "./types";

// ---------------------------------------------------------------------------
// Truthful execution state
// ---------------------------------------------------------------------------

/**
 * executable: the server will run this agent's missions for this workspace (plan or operator preview).
 * locked: built, but not included in the workspace's plan.
 * coming_soon: not built — never executable, whatever the plan or preview. requiredPlan is the plan it is designed for.
 * disabled: switched off by the operator.
 * role: executable for the workspace, but the member's role cannot start missions.
 */
export type AgentAccess =
  | { state: "executable"; via: "plan" | "preview" }
  | { state: "locked"; requiredPlan: Plan }
  | { state: "coming_soon"; requiredPlan: Plan }
  | { state: "disabled" }
  | { state: "role" };

export interface AccessContext {
  /** Authoritative plan from the server, never from the browser. */
  entitledPlan: Plan;
  /** Server-side operator preview allow-list. */
  preview: boolean;
  role: Role;
}

/** Mirrors decideMission (tested): an agent shows as executable only if the server would accept its missions. */
export function agentAccess(agent: AgentDefinition, ctx: AccessContext): AgentAccess {
  const plan = requiredPlan(agent);
  if (agent.status === "coming_soon") return { state: "coming_soon", requiredPlan: plan };
  if (agent.status === "disabled") return { state: "disabled" };
  const entitled = planAtLeast(ctx.entitledPlan, plan);
  if (!entitled && !ctx.preview) return { state: "locked", requiredPlan: plan };
  if (!roleAtLeastPure(ctx.role, "member")) return { state: "role" };
  return { state: "executable", via: entitled ? "plan" : "preview" };
}

export function organizationAccess(ctx: AccessContext): Record<AgentId, AgentAccess> {
  return Object.fromEntries(AGENT_ORDER.map((id) => [id, agentAccess(AGENT_REGISTRY[id], ctx)])) as Record<AgentId, AgentAccess>;
}

/** User-facing status. "available"/"preview" only when the server would actually run it. */
export type DisplayStatus = "available" | "preview" | "locked" | "coming_soon" | "disabled" | "role";

export function displayStatus(access: AgentAccess): DisplayStatus {
  return access.state === "executable" ? (access.via === "preview" ? "preview" : "available") : access.state;
}

// ---------------------------------------------------------------------------
// Autonomy ceiling
// ---------------------------------------------------------------------------

/**
 * The highest autonomy this workspace may request for the agent: the
 * registry's maximum when executable, otherwise none. Execute (3) is granted
 * to no agent; the registry test enforces that, and decideMission refuses it.
 */
export function autonomyCeiling(agent: AgentDefinition, access: AgentAccess): AutonomyLevel | null {
  return access.state === "executable" ? agent.autonomy.max : null;
}

export function allowedAutonomy(agent: AgentDefinition, access: AgentAccess): AutonomyLevel[] {
  const ceiling = autonomyCeiling(agent, access);
  if (ceiling === null) return [];
  return ([0, 1, 2, 3] as const).filter((l) => l >= agent.autonomy.min && l <= ceiling);
}

// ---------------------------------------------------------------------------
// Organization layers (derived from parent links)
// ---------------------------------------------------------------------------

export interface OrganizationView {
  orchestration: AgentDefinition[];
  management: { manager: AgentDefinition; coordinates: AgentDefinition[] }[];
  specialists: AgentDefinition[];
  custom: AgentDefinition[];
}

export function organizationView(): OrganizationView {
  const all = AGENT_ORDER.map((id) => AGENT_REGISTRY[id]);
  const core = all.filter((a) => a.slot === "core");
  return {
    orchestration: core.filter((a) => a.tier === "orchestrator"),
    management: core.filter((a) => a.tier === "manager").map((m) => ({ manager: m, coordinates: core.filter((a) => a.parent === m.id) })),
    specialists: core.filter((a) => a.tier === "specialist"),
    custom: all.filter((a) => a.slot === "custom"),
  };
}

/** Reporting chain from the agent up to the top (self first). Bounded by the registry size. */
export function reportingChain(id: AgentId): AgentId[] {
  const chain: AgentId[] = [];
  let cur: AgentId | null = id;
  while (cur && !chain.includes(cur) && chain.length <= AGENT_ORDER.length) {
    chain.push(cur);
    cur = AGENT_REGISTRY[cur].parent;
  }
  return chain;
}

export function directReports(id: AgentId): AgentDefinition[] {
  return AGENT_ORDER.map((a) => AGENT_REGISTRY[a]).filter((a) => a.parent === id && a.slot === "core");
}

// ---------------------------------------------------------------------------
// Permissions (what an agent can read, use and never do)
// ---------------------------------------------------------------------------

export type Boundary = "act_externally" | "modify_relationships" | "execute_without_you" | "read_private_fields" | "spend_without_approval" | "use_paid_providers";

export interface AgentToolView {
  id: ToolId;
  access: ToolAccess;
  costClass: CostClass;
  /** True when a human must approve before the call (below Execute, or always). */
  needsApproval: boolean;
}

export interface AgentPermissions {
  /** Tools actually granted (the agent's allow-list). Empty for agents that are not built. */
  tools: AgentToolView[];
  reads: DataDomain[];
  /** Domains where the agent stores derived data in this workspace (e.g. a saved analysis). */
  stores: DataDomain[];
  /** Private fields no granted tool returns. */
  withholds: PrivateField[];
  cannot: Boundary[];
  /** Read seams built for this agent's capabilities but not granted to it (planned agents). */
  plannedTools: ToolId[];
}

const RELATIONSHIP_DOMAINS: readonly DataDomain[] = ["relationship_context", "follow_ups", "events"];

function inDomainOrder(set: Set<DataDomain>): DataDomain[] {
  return DATA_DOMAINS.filter((d) => set.has(d));
}

export function agentPermissions(agent: AgentDefinition): AgentPermissions {
  const tools: AgentToolView[] = agent.tools.map((id) => ({ id, access: TOOL_PERMISSIONS[id].access, costClass: TOOLS[id].costClass, needsApproval: TOOLS[id].approval === "always" || (TOOLS[id].approval === "below_execute" && agent.autonomy.max < 3) }));
  const reads = new Set<DataDomain>();
  const stores = new Set<DataDomain>();
  for (const t of agent.tools) {
    const p = TOOL_PERMISSIONS[t];
    for (const d of p.domains) reads.add(d);
    if (p.access === "write_internal") for (const d of p.domains.filter((x) => x !== "public_web" && x !== "web_search")) stores.add(d);
  }
  const cannot: Boundary[] = [];
  if (!tools.some((t) => t.access === "write_external")) cannot.push("act_externally");
  if (![...stores].some((d) => RELATIONSHIP_DOMAINS.includes(d))) cannot.push("modify_relationships");
  if (agent.autonomy.max < 3) cannot.push("execute_without_you");
  // No registered tool returns a private field (TOOL_PERMISSIONS has no "exposes"; the tool output schemas exclude them).
  cannot.push("read_private_fields");
  const paid = tools.filter((t) => t.costClass === "variable");
  if (paid.length === 0) cannot.push("use_paid_providers");
  else if (paid.every((t) => t.needsApproval)) cannot.push("spend_without_approval");
  const granted = new Set(agent.tools);
  const plannedTools = [...new Set(agent.capabilities.flatMap((c) => CAPABILITIES[c].tools))].filter((t) => !granted.has(t));
  return { tools, reads: inDomainOrder(reads), stores: inDomainOrder(stores), withholds: [...PRIVATE_FIELDS], cannot, plannedTools };
}

// ---------------------------------------------------------------------------
// Product spaces — agents coordinate capabilities; the spaces stay task UIs
// ---------------------------------------------------------------------------

export type ProductSpace = "search" | "discover" | "network" | "intelligence" | "events";

export const PRODUCT_SPACES: Record<ProductSpace, string> = {
  search: "/workspace",
  discover: "/workspace/discover",
  network: "/workspace/network",
  intelligence: "/workspace/intelligence",
  events: "/workspace/events",
};

export const AGENT_SPACE: Partial<Record<AgentId, ProductSpace>> = {
  research: "search",
  prospecting: "discover",
  relationship: "network",
  followUp: "network",
  signal: "intelligence",
  event: "events",
};

// ---------------------------------------------------------------------------
// Deterministic mission planning (routing, not execution)
// ---------------------------------------------------------------------------

/** Hard cap on plan length. Plans are never extended at run time. */
export const MAX_PLAN_STEPS = 6;

/** Structured missions the planner understands: an ordered list of required capabilities. No free-form text is parsed. */
export const MISSION_TEMPLATES = {
  research_company: ["company_research", "opportunity_qualification"],
  find_companies: ["prospect_discovery", "company_research", "opportunity_qualification"],
  review_network_changes: ["signal_analysis", "relationship_context", "followup_preparation"],
  review_followups: ["followup_preparation", "relationship_context"],
  prepare_event: ["event_analysis", "prospect_discovery", "company_research", "relationship_context", "followup_preparation"],
  map_market: ["market_research", "prospect_discovery"],
  assess_technical_fit: ["company_research", "technical_fit"],
} as const satisfies Record<string, readonly CapabilityId[]>;
export type MissionTemplateId = keyof typeof MISSION_TEMPLATES;
export const MISSION_TEMPLATE_IDS = Object.keys(MISSION_TEMPLATES) as MissionTemplateId[];

export function isMissionTemplate(id: unknown): id is MissionTemplateId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(MISSION_TEMPLATES, id);
}

/** Why an agent was selected for a capability. */
export type RoutingRule = "mission_route" | "capability_holder";

/**
 * The single agent that owns a capability: the agent of a mission route for
 * it, else the first core specialist (catalog order) granted it, else the
 * first core agent granted it.
 */
export function capabilityOwner(capability: CapabilityId): { agent: AgentDefinition; rule: RoutingRule } | null {
  const route = Object.values(MISSION_ROUTES).find((r) => r.capability === capability);
  if (route) return { agent: AGENT_REGISTRY[route.agent], rule: "mission_route" };
  const holders = AGENT_ORDER.map((id) => AGENT_REGISTRY[id]).filter((a) => a.slot === "core" && a.capabilities.includes(capability));
  const pick = holders.find((a) => a.tier === "specialist") ?? holders[0];
  return pick ? { agent: pick, rule: "capability_holder" } : null;
}

/** Mission type through which the agent runs this capability today, if any. */
export function missionTypeFor(agent: AgentDefinition, capability: CapabilityId): MissionType | null {
  return MISSION_TYPES.find((m) => MISSION_ROUTES[m].capability === capability && MISSION_ROUTES[m].agent === agent.id && agent.missionTypes.includes(m)) ?? null;
}

export type PlanBlocker = "coming_soon" | "disabled" | "plan" | "role" | "no_mission";

function stepBlocker(access: AgentAccess, missionType: MissionType | null): PlanBlocker | null {
  if (access.state === "coming_soon") return "coming_soon";
  if (access.state === "disabled") return "disabled";
  if (access.state === "locked") return "plan";
  if (access.state === "role") return "role";
  return missionType === null ? "no_mission" : null;
}

export interface PlanStep {
  n: number;
  capability: CapabilityId;
  agent: AgentId;
  rule: RoutingRule;
  status: DisplayStatus;
  requiredPlan: Plan;
  /** The step can be launched by the user now (executable agent with a mission for this capability). Nothing runs automatically. */
  runnable: boolean;
  missionType: MissionType | null;
  /**
   * The primary reason the step cannot run, in priority order: not built (coming_soon) → disabled → plan
   * entitlement → role → no direct mission. null when the step can run.
   */
  blocker: PlanBlocker | null;
  /**
   * Some tools of this step need an admin's approval before they run (paid providers). Only reported when the
   * step can otherwise run: approval is never the remaining blocker of a step that is unbuilt or not on the plan.
   * The approval requirement itself is enforced by decideTool, whatever this flag says.
   */
  approvalBoundary: boolean;
  /** Suggested handoff to the next step's agent. Not a run, not a provider call, not a record. */
  handoff: { to: AgentId; capability: CapabilityId } | null;
}

export interface MissionPlan {
  template: MissionTemplateId;
  /** The lowest agent in the hierarchy that coordinates every step's agent. */
  lead: AgentId;
  leadStatus: DisplayStatus;
  steps: PlanStep[];
  runnable: number;
}

function lowestCommonLead(agents: readonly AgentId[]): AgentId {
  const chains = agents.map(reportingChain);
  const first = chains[0] ?? ["orchestrator"];
  // A single-agent plan is coordinated by its manager when it has one.
  const candidates = agents.length === 1 && AGENT_REGISTRY[first[0]].parent ? first.slice(1) : first;
  return candidates.find((a) => chains.every((c) => c.includes(a)) && AGENT_REGISTRY[a].tier !== "specialist") ?? "orchestrator";
}

/**
 * Turns a structured mission into ordered capability steps routed to agents,
 * each marked with its real status for this workspace. Pure: it never runs a
 * step. Returns null for an unknown mission.
 */
export function planMission(template: string, access: Record<AgentId, AgentAccess>): MissionPlan | null {
  if (!isMissionTemplate(template)) return null;
  const caps: readonly CapabilityId[] = MISSION_TEMPLATES[template].slice(0, MAX_PLAN_STEPS);
  const routed: { capability: CapabilityId; owner: { agent: AgentDefinition; rule: RoutingRule } }[] = [];
  for (const capability of caps) {
    const owner = capabilityOwner(capability);
    if (owner) routed.push({ capability, owner });
  }
  const steps: PlanStep[] = routed.map(({ capability, owner }, i) => {
    const agent = owner.agent;
    const a = access[agent.id];
    const missionType = missionTypeFor(agent, capability);
    const next = routed[i + 1];
    const blocker = stepBlocker(a, missionType);
    return {
      n: i + 1,
      capability,
      agent: agent.id,
      rule: owner.rule,
      status: displayStatus(a),
      requiredPlan: requiredPlan(agent),
      blocker,
      runnable: blocker === null,
      missionType,
      approvalBoundary: blocker === null && CAPABILITIES[capability].tools.some((t) => agent.tools.includes(t) && TOOLS[t].approval !== "never"),
      handoff: next && next.owner.agent.id !== agent.id ? { to: next.owner.agent.id, capability: next.capability } : null,
    };
  });
  const lead = lowestCommonLead([...new Set(steps.map((s) => s.agent))]);
  return { template, lead, leadStatus: displayStatus(access[lead]), steps, runnable: steps.filter((s) => s.runnable).length };
}

/** Agents that share at least one structured mission with this agent (catalog order). */
export function collaboratorsOf(id: AgentId): AgentId[] {
  const peers = new Set<AgentId>();
  for (const caps of Object.values(MISSION_TEMPLATES)) {
    const owners = caps.map((c) => capabilityOwner(c)?.agent.id).filter((x): x is AgentId => Boolean(x));
    if (owners.includes(id)) for (const o of owners) if (o !== id) peers.add(o);
  }
  return AGENT_ORDER.filter((a) => peers.has(a));
}

/** Structured missions in which the agent owns a step. */
export function missionsInvolving(id: AgentId): MissionTemplateId[] {
  return MISSION_TEMPLATE_IDS.filter((m) => MISSION_TEMPLATES[m].some((c) => capabilityOwner(c)?.agent.id === id));
}
