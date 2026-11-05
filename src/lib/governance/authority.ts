/**
 * Agent Authority Contract (Phase 17A): exactly what one run may do, frozen when the run starts.
 *
 * Pure and deterministic. Authority is BUILT by server code from:
 *     registry grants (agent ∩ capability) ∩ entitlement ∩ the approved execution envelope.
 * It is never read from a browser, a model, a tool result or web content. A child (delegated) authority is
 * derived from its parent and can only be equal or narrower: every dimension is intersected or lowered,
 * and a request for more is an expansion (refused, and a tripwire for the caller).
 *
 * The persisted snapshot (agent_runs.authority) is immutable in the database once set (Phase 17A migration).
 * Nothing in this layer knows any company, industry or customer: it is governance only.
 */
import { z } from "zod";
import { CAPABILITIES, type AgentDefinition } from "@/lib/agents/registry";
import { DATA_DOMAINS, TOOL_PERMISSIONS, type DataDomain } from "@/lib/agents/permissions";
import { AGENT_IDS, AUTONOMY_LEVELS, CAPABILITY_IDS, MODEL_TASKS, TOOL_IDS, type AgentId, type AutonomyLevel, type CapabilityId, type ModelTask, type ToolId } from "@/lib/agents/types";
import { mayUsePaidProviders, type Entitlement, type EntitlementTier } from "./entitlement";

export const NETWORK_LEVELS = ["none", "official_sites", "public_search"] as const;
export type NetworkLevel = (typeof NETWORK_LEVELS)[number];
const NETWORK_RANK: Record<NetworkLevel, number> = { none: 0, official_sites: 1, public_search: 2 };

export const PROVIDERS = ["openrouter", "brave"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const MODEL_TIERS = ["economy", "standard"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];
const TIER_RANK: Record<ModelTier, number> = { economy: 0, standard: 1 };

/** Internal writes a run may make. External writes do not exist in Phase 17. */
export const WRITE_SCOPES = ["internal_evidence", "mission_result", "tracked_opportunity"] as const;
export type WriteScope = (typeof WRITE_SCOPES)[number];

/** Delegation can never go deeper than this (CEO → agent → nested research). */
export const MAX_DELEGATION_DEPTH = 2;

/**
 * What each tool needs beyond the registry, written by hand from its server implementation (code-reviewed).
 * Tools absent here need no network, no provider and no write.
 */
const TOOL_NEEDS: Partial<Record<ToolId, { network: NetworkLevel; providers?: { openrouter?: ModelTask[]; brave?: true }; paid?: true }>> = {
  official_site_research: { network: "official_sites" },
  deep_company_research: { network: "public_search", providers: { openrouter: ["extraction", "business_reasoning"], brave: true }, paid: true },
  search_web_candidates: { network: "public_search", providers: { brave: true }, paid: true },
};

export interface AuthorityLimits {
  maxToolCalls: number;
  maxModelCalls: number;
  maxExternalRequests: number;
  /** Paid provider invocations (each one reserved in provider_spend), fallbacks included. */
  maxProviderCalls: number;
  maxDurationMs: number;
  /** Money this run may reserve, in USD. 0 means no paid provider at all. */
  maxCostUsd: number;
  maxChildRuns: number;
  maxDepth: number;
}

export interface ProviderGrants {
  openrouter: { tasks: ModelTask[]; maxTier: ModelTier } | null;
  brave: boolean;
}

export interface AuthorityContract {
  version: 1;
  organizationId: string;
  userId: string;
  entitlement: EntitlementTier;
  missionId: string | null;
  runId: string | null;
  parentRunId: string | null;
  depth: number;
  agent: AgentId;
  capability: CapabilityId;
  tools: ToolId[];
  dataDomains: DataDomain[];
  writes: WriteScope[];
  network: NetworkLevel;
  providers: ProviderGrants;
  limits: AuthorityLimits;
  autonomy: AutonomyLevel;
  /** Variable-cost tools need a human approval per call unless the envelope was approved in advance (17B). */
  approval: { variableCost: "per_call" | "pre_approved" };
  killSwitch: "enforced";
}

/** What a caller (server code) asks for: always intersected with the registry and the entitlement. */
export interface ExecutionEnvelope {
  tools?: readonly ToolId[];
  network?: NetworkLevel;
  writes?: readonly WriteScope[];
  maxCostUsd?: number;
  maxProviderCalls?: number;
  maxDurationMs?: number;
  maxChildRuns?: number;
  variableCostPreApproved?: boolean;
}

const uniq = <T,>(xs: readonly T[]) => [...new Set(xs)];
const lowestNetwork = (a: NetworkLevel, b: NetworkLevel): NetworkLevel => (NETWORK_RANK[a] <= NETWORK_RANK[b] ? a : b);
const money = (n: number) => Math.round(Math.max(0, n) * 1e6) / 1e6;

function needsOf(tools: readonly ToolId[]) {
  let network: NetworkLevel = "none";
  const tasks = new Set<ModelTask>();
  let brave = false;
  for (const t of tools) {
    const n = TOOL_NEEDS[t];
    if (!n) continue;
    if (NETWORK_RANK[n.network] > NETWORK_RANK[network]) network = n.network;
    for (const task of n.providers?.openrouter ?? []) tasks.add(task);
    if (n.providers?.brave) brave = true;
  }
  return { network, tasks: [...tasks], brave };
}

/** Builds the authority of a run: registry ∩ entitlement ∩ envelope. Never wider than any of the three. */
export function buildAuthority(input: {
  principal: { organizationId: string; userId: string };
  entitlement: Entitlement;
  agent: AgentDefinition;
  capability: CapabilityId;
  autonomy: AutonomyLevel;
  envelope?: ExecutionEnvelope;
  ids?: { missionId?: string | null; runId?: string | null };
}): AuthorityContract {
  const { agent, capability, entitlement: e } = input;
  const env = input.envelope ?? {};
  const paidAllowed = mayUsePaidProviders(e);
  const granted = agent.capabilities.includes(capability) ? agent.tools.filter((t) => CAPABILITIES[capability].tools.includes(t)) : [];
  const tools = granted.filter((t) => (env.tools ? env.tools.includes(t) : true)).filter((t) => paidAllowed || !TOOL_NEEDS[t]?.paid);
  const needs = needsOf(tools);
  const network = env.network ? lowestNetwork(needs.network, env.network) : needs.network;
  // A tool whose network the envelope does not allow is dropped, never silently widened.
  const usable = tools.filter((t) => NETWORK_RANK[TOOL_NEEDS[t]?.network ?? "none"] <= NETWORK_RANK[network]);
  const final = needsOf(usable);
  const openTasks = final.tasks.filter((t) => agent.modelTasks.includes(t));
  const maxTier: ModelTier = e.tier === "pro" ? "economy" : "standard";
  const paidTools = usable.some((t) => TOOL_NEEDS[t]?.paid);
  const writesFromTools = usable.some((t) => TOOL_PERMISSIONS[t].access === "write_internal") ? (["internal_evidence"] as WriteScope[]) : [];
  const writes = env.writes ? writesFromTools.filter((w) => env.writes!.includes(w)) : writesFromTools;
  const providerCallsCap = agent.limits.maxExternalRequests + 2 * agent.limits.maxModelCalls;
  const costCap = paidTools && e.budgetUsd !== null ? Math.min(env.maxCostUsd ?? 0, e.budgetUsd) : 0;
  return {
    version: 1,
    organizationId: input.principal.organizationId,
    userId: input.principal.userId,
    entitlement: e.tier,
    missionId: input.ids?.missionId ?? null,
    runId: input.ids?.runId ?? null,
    parentRunId: null,
    depth: 0,
    agent: agent.id,
    capability,
    tools: usable,
    dataDomains: uniq(usable.flatMap((t) => TOOL_PERMISSIONS[t].domains)),
    writes,
    network: final.network,
    providers: { openrouter: paidTools && openTasks.length ? { tasks: openTasks, maxTier } : null, brave: paidTools && final.brave },
    limits: {
      maxToolCalls: agent.limits.maxToolCalls,
      maxModelCalls: paidTools ? agent.limits.maxModelCalls : 0,
      maxExternalRequests: agent.limits.maxExternalRequests,
      maxProviderCalls: paidTools ? Math.min(env.maxProviderCalls ?? providerCallsCap, providerCallsCap) : 0,
      maxDurationMs: Math.min(env.maxDurationMs ?? agent.limits.maxDurationMs, agent.limits.maxDurationMs),
      maxCostUsd: money(costCap),
      maxChildRuns: Math.max(0, Math.min(env.maxChildRuns ?? 0, 8)),
      maxDepth: MAX_DELEGATION_DEPTH,
    },
    autonomy: input.autonomy,
    approval: { variableCost: env.variableCostPreApproved ? "pre_approved" : "per_call" },
    killSwitch: "enforced",
  };
}

// ---------------------------------------------------------------------------
// Narrowing

export const AUTHORITY_DIMENSIONS = ["organization", "tools", "data", "writes", "network", "providers", "tool_calls", "model_calls", "external_requests", "provider_calls", "runtime", "cost", "child_runs", "depth", "autonomy", "approval"] as const;
export type AuthorityDimension = (typeof AUTHORITY_DIMENSIONS)[number];

export class AuthorityExpansionError extends Error {
  constructor(readonly dimensions: AuthorityDimension[]) {
    super(`Authority expansion refused: ${dimensions.join(", ")}.`);
  }
}

/** Every dimension in which `child` would exceed `parent`. Empty means the child is within its parent. */
export function expansions(parent: AuthorityContract, child: AuthorityContract): AuthorityDimension[] {
  const out: AuthorityDimension[] = [];
  const subset = <T,>(c: readonly T[], p: readonly T[]) => c.every((x) => p.includes(x));
  if (child.organizationId !== parent.organizationId || child.userId !== parent.userId) out.push("organization");
  if (!subset(child.tools, parent.tools)) out.push("tools");
  if (!subset(child.dataDomains, parent.dataDomains)) out.push("data");
  if (!subset(child.writes, parent.writes)) out.push("writes");
  if (NETWORK_RANK[child.network] > NETWORK_RANK[parent.network]) out.push("network");
  const po = parent.providers.openrouter;
  const co = child.providers.openrouter;
  if ((child.providers.brave && !parent.providers.brave) || (co && (!po || !subset(co.tasks, po.tasks) || TIER_RANK[co.maxTier] > TIER_RANK[po.maxTier]))) out.push("providers");
  const l = (k: keyof AuthorityLimits) => child.limits[k] > parent.limits[k];
  if (l("maxToolCalls")) out.push("tool_calls");
  if (l("maxModelCalls")) out.push("model_calls");
  if (l("maxExternalRequests")) out.push("external_requests");
  if (l("maxProviderCalls")) out.push("provider_calls");
  if (l("maxDurationMs")) out.push("runtime");
  if (l("maxCostUsd")) out.push("cost");
  // A child consumes one of its parent's child runs; it can hand down at most what remains.
  if (parent.limits.maxChildRuns < 1 || child.limits.maxChildRuns > parent.limits.maxChildRuns - 1) out.push("child_runs");
  if (child.depth !== parent.depth + 1 || child.depth > parent.limits.maxDepth || child.limits.maxDepth > parent.limits.maxDepth) out.push("depth");
  if (child.autonomy > parent.autonomy) out.push("autonomy");
  if (child.approval.variableCost === "pre_approved" && parent.approval.variableCost !== "pre_approved") out.push("approval");
  return out;
}

/**
 * Derives a child authority for a delegated run. The request is first intersected with the parent; anything
 * the parent does not hold makes the derivation fail (AuthorityExpansionError), so callers can trip a wire.
 */
export function deriveChild(parent: AuthorityContract, requested: AuthorityContract, ids: { runId: string | null }): AuthorityContract {
  const child: AuthorityContract = { ...requested, organizationId: requested.organizationId, userId: requested.userId, parentRunId: parent.runId, depth: parent.depth + 1, missionId: parent.missionId, runId: ids.runId, killSwitch: "enforced", version: 1 };
  const wider = expansions(parent, child);
  if (wider.length) throw new AuthorityExpansionError(wider);
  return child;
}

// ---------------------------------------------------------------------------
// Persisted form: parsed strictly; anything malformed is treated as no authority.

const Limits = z.strictObject({
  maxToolCalls: z.number().int().min(0).max(100),
  maxModelCalls: z.number().int().min(0).max(50),
  maxExternalRequests: z.number().int().min(0).max(200),
  maxProviderCalls: z.number().int().min(0).max(200),
  maxDurationMs: z.number().int().min(0).max(900_000),
  maxCostUsd: z.number().min(0).max(1_000),
  maxChildRuns: z.number().int().min(0).max(8),
  maxDepth: z.number().int().min(0).max(MAX_DELEGATION_DEPTH),
});

export const AuthoritySchema = z.strictObject({
  version: z.literal(1),
  organizationId: z.uuid(),
  userId: z.uuid(),
  entitlement: z.enum(["free", "pro", "business", "internal"]),
  missionId: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  parentRunId: z.uuid().nullable(),
  depth: z.number().int().min(0).max(MAX_DELEGATION_DEPTH),
  agent: z.enum(AGENT_IDS),
  capability: z.enum(CAPABILITY_IDS),
  tools: z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length),
  dataDomains: z.array(z.enum(DATA_DOMAINS)).max(DATA_DOMAINS.length),
  writes: z.array(z.enum(WRITE_SCOPES)).max(WRITE_SCOPES.length),
  network: z.enum(NETWORK_LEVELS),
  providers: z.strictObject({ openrouter: z.strictObject({ tasks: z.array(z.enum(MODEL_TASKS)).max(MODEL_TASKS.length), maxTier: z.enum(MODEL_TIERS) }).nullable(), brave: z.boolean() }),
  limits: Limits,
  autonomy: z.union(AUTONOMY_LEVELS.map((l) => z.literal(l)) as unknown as [z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]),
  approval: z.strictObject({ variableCost: z.enum(["per_call", "pre_approved"]) }),
  killSwitch: z.literal("enforced"),
});

export function parseAuthority(raw: unknown): AuthorityContract | null {
  const r = AuthoritySchema.safeParse(raw);
  return r.success ? (r.data as AuthorityContract) : null;
}

/** Deep, key-order-independent equality of two authorities (a stored snapshot vs the server's own rebuild). */
export function sameAuthority(a: AuthorityContract, b: AuthorityContract): boolean {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canon(x)])) : v);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

export const networkAllows = (held: NetworkLevel, needed: NetworkLevel) => NETWORK_RANK[held] >= NETWORK_RANK[needed];
export const tierAllows = (held: ModelTier, needed: ModelTier) => TIER_RANK[held] >= TIER_RANK[needed];
export const toolNeeds = (t: ToolId) => TOOL_NEEDS[t] ?? { network: "none" as NetworkLevel };
