/**
 * Opportunity Graph service (Phase 10).
 *
 *   PostgreSQL (canonical) → loadCanonicalSnapshot → buildProjection → GraphStore (Neo4j, derived)
 *
 * Reads always start from PostgreSQL: the projection is rebuilt in process on
 * every view, which gives (a) a truthful preview when Neo4j is unconfigured or
 * down, (b) the candidates (rules run in application code, identically in both
 * modes), and (c) a fingerprint to tell whether Neo4j is in sync. Neo4j is
 * only read for the bounded neighborhood, and only when its copy matches.
 * Nothing here calls a model or a paid provider, and Neo4j failing never
 * fails the caller: it degrades to the preview.
 */
import { createHash } from "node:crypto";
import { findOpportunityCandidates, type OpportunityCandidate } from "@/lib/graph/opportunity/candidates";
import { NEIGHBORHOOD_LIMITS, neighborhood, type Neighborhood } from "@/lib/graph/opportunity/neighborhood";
import { buildProjection, NODE_KINDS, nodeKey, PROJECTION_VERSION, type CanonicalSnapshot, type Epistemic, type GraphEdge, type GraphNode, type GraphProjection, type NodeKind } from "@/lib/graph/opportunity/projection";
import { AppError } from "@/lib/server/errors";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { Db } from "@/lib/server/supabase/types";
import { loadCanonicalSnapshot } from "./canonical";
import { graphStoreFromEnv, GraphStoreError, type GraphErrorCategory, type GraphStore, type ProjectionMeta, type StoreConfig } from "./store";

/**
 * unconfigured: no Neo4j settings · unavailable: configured but unreachable/invalid ·
 * not_synced: reachable, never rebuilt for this workspace · stale: reachable, its copy differs from PostgreSQL ·
 * in_sync: reachable and identical to the current projection. ("syncing" is never claimed: a rebuild is one request.)
 */
export type GraphState = "unconfigured" | "unavailable" | "not_synced" | "stale" | "in_sync";

export interface GraphStatus {
  /** The store actually behind the status ("memory" only in tests; never shown as Neo4j). */
  provider: "neo4j" | "memory" | null;
  state: GraphState;
  /** When the state was checked against the store (null: no check was possible). */
  checkedAt: string | null;
  projectionVersion: string;
  synced: Omit<ProjectionMeta, "fingerprint"> | null;
  errorCategory: GraphErrorCategory | null;
  /** The last rebuild attempt in this server process failed (not durable across restarts). */
  lastSyncError: { category: GraphErrorCategory; at: string } | null;
}

export interface OpportunityGraphView {
  status: GraphStatus;
  /** Where the neighborhood was read from: the graph store (see status.provider) or the in-process preview. */
  source: "store" | "preview";
  summary: { nodes: number; edges: number; truncated: boolean; byKind: Record<NodeKind, number> };
  companies: { key: string; id: string; name: string; isOwnCompany: boolean }[];
  focus: string | null;
  neighborhood: Neighborhood | null;
  candidates: OpportunityCandidate[];
  candidateTotal: number;
}

const lastErrors = new Map<string, { category: GraphErrorCategory; at: string }>();
const lastRebuild = new Map<string, number>();
export const REBUILD_MIN_INTERVAL_MS = 30_000;

/** Stable digest of a projection (nodes and edges are already sorted by key). */
export function fingerprint(p: GraphProjection): string {
  return createHash("sha256").update(JSON.stringify({ v: p.version, n: p.nodes, e: p.edges })).digest("hex");
}

function categoryOf(e: unknown): GraphErrorCategory {
  return e instanceof GraphStoreError ? e.category : "network";
}

export async function graphStatus(config: StoreConfig, organizationId: string, current: string, now: Date): Promise<GraphStatus> {
  const base = { projectionVersion: PROJECTION_VERSION, lastSyncError: lastErrors.get(organizationId) ?? null };
  if (config.kind === "unconfigured") return { ...base, provider: null, state: "unconfigured", checkedAt: null, synced: null, errorCategory: null };
  if (config.kind === "invalid") return { ...base, provider: "neo4j", state: "unavailable", checkedAt: null, synced: null, errorCategory: "config" };
  const provider = config.store.provider;
  try {
    const meta = await config.store.readMeta(organizationId);
    const checkedAt = now.toISOString();
    if (!meta) return { ...base, provider, state: "not_synced", checkedAt, synced: null, errorCategory: null };
    const { fingerprint: fp, ...synced } = meta;
    const state: GraphState = meta.version === PROJECTION_VERSION && fp === current ? "in_sync" : "stale";
    return { ...base, provider, state, checkedAt, synced, errorCategory: null };
  } catch (e) {
    return { ...base, provider, state: "unavailable", checkedAt: now.toISOString(), synced: null, errorCategory: categoryOf(e) };
  }
}

/** Bounded neighborhood read from the store, layer by layer (same bounds and ordering as the preview). */
export async function storeNeighborhood(store: GraphStore, organizationId: string, focus: string): Promise<Neighborhood | null> {
  const [start] = await store.nodes(organizationId, [focus]);
  if (!start) return null;
  const nodes = new Map<string, GraphNode>([[start.key, start]]);
  const edges = new Map<string, GraphEdge>();
  const merge = (sub: { nodes: GraphNode[]; edges: GraphEdge[] }) => {
    sub.nodes.forEach((n) => nodes.set(n.key, n));
    sub.edges.forEach((e) => edges.set(e.key, e));
  };
  const view = (maxDepth?: number) => neighborhood({ nodes: [...nodes.values()], edges: [...edges.values()] }, focus, maxDepth ? { maxDepth } : {});
  let frontier = [focus];
  for (let depth = 1; depth <= NEIGHBORHOOD_LIMITS.maxDepth && frontier.length > 0; depth++) {
    merge(await store.expand(organizationId, frontier, 500));
    frontier = (view(depth)?.nodes ?? []).filter((n) => n.depth === depth).map((n) => n.key);
  }
  const kept = view()?.nodes.map((n) => n.key) ?? [];
  merge({ nodes: [], edges: await store.edgesAmong(organizationId, kept, 500) });
  return view();
}

/** The default focus: the requested company, else the workspace's own company, else the first company. */
function pickFocus(p: GraphProjection, focusCompanyId: string | undefined): string | null {
  const companies = p.nodes.filter((n) => n.kind === "company");
  const wanted = focusCompanyId ? companies.find((c) => c.canonicalId === focusCompanyId) : undefined;
  return (wanted ?? companies.find((c) => c.attrs.isOwnCompany === true) ?? companies[0])?.key ?? null;
}

export interface GraphDeps {
  config?: StoreConfig;
  load?: (db: Db, organizationId: string) => Promise<CanonicalSnapshot>;
  now?: Date;
}

/**
 * The Opportunity Graph of one organization. The caller has already resolved
 * the organization from the signed-in user's membership (loadWorkspace); RLS
 * and the organization filter apply to every read.
 */
export async function loadOpportunityGraph(db: Db, organizationId: string, opts: { focusCompanyId?: string } & GraphDeps = {}): Promise<OpportunityGraphView> {
  const config = opts.config ?? graphStoreFromEnv();
  const now = opts.now ?? new Date();
  const projection = buildProjection(await (opts.load ?? loadCanonicalSnapshot)(db, organizationId));
  const status = await graphStatus(config, organizationId, fingerprint(projection), now);
  const focus = pickFocus(projection, opts.focusCompanyId);

  let source: OpportunityGraphView["source"] = "preview";
  let near: Neighborhood | null = null;
  if (focus && config.kind === "ready" && status.state === "in_sync") {
    try {
      near = await storeNeighborhood(config.store, organizationId, focus);
      source = "store";
    } catch (e) {
      // Degrade, never fail: fall back to the preview computed from PostgreSQL.
      status.state = "unavailable";
      status.errorCategory = categoryOf(e);
      near = null;
    }
  }
  if (source === "preview") near = focus ? neighborhood(projection, focus) : null;

  const byKind = Object.fromEntries(NODE_KINDS.map((k) => [k, 0])) as Record<NodeKind, number>;
  projection.nodes.forEach((n) => (byKind[n.kind] += 1));
  const { candidates, total } = findOpportunityCandidates(projection);
  return {
    status,
    source,
    summary: { nodes: projection.nodes.length, edges: projection.edges.length, truncated: projection.truncated, byKind },
    companies: projection.nodes.filter((n) => n.kind === "company").map((n) => ({ key: n.key, id: n.canonicalId, name: n.label, isOwnCompany: n.attrs.isOwnCompany === true })),
    focus,
    neighborhood: near,
    candidates,
    candidateTotal: total,
  };
}

/**
 * Rebuild ONE organization's derived graph from PostgreSQL (admin+). Upserts
 * by canonical key and removes stale nodes/edges of that organization only.
 * There is no global wipe. Throttled per organization in this process.
 */
export async function rebuildOrganizationGraph(db: Db, userId: string, organizationId: string, deps: GraphDeps = {}): Promise<ProjectionMeta> {
  await requireMembership(db, userId, organizationId, "admin");
  const config = deps.config ?? graphStoreFromEnv();
  if (config.kind !== "ready") throw new AppError("unavailable", "The graph database is not configured.");
  const now = deps.now ?? new Date();
  const previous = lastRebuild.get(organizationId);
  if (previous !== undefined && now.getTime() - previous < REBUILD_MIN_INTERVAL_MS) throw new AppError("rate_limited", "A rebuild just ran. Try again in a moment.");
  lastRebuild.set(organizationId, now.getTime());

  const projection = buildProjection(await (deps.load ?? loadCanonicalSnapshot)(db, organizationId));
  try {
    const meta = await config.store.replaceOrganization(organizationId, projection, fingerprint(projection), now.toISOString());
    lastErrors.delete(organizationId);
    return meta;
  } catch (e) {
    lastErrors.set(organizationId, { category: categoryOf(e), at: now.toISOString() });
    throw new AppError("unavailable", "The graph database could not be updated.");
  }
}

/** Test hook: forget in-process throttle and error state. */
export function resetGraphServiceState(): void {
  lastErrors.clear();
  lastRebuild.clear();
}

// ---------------------------------------------------------------------------
// Company-level context (company page and the read-only agent tool).
// ---------------------------------------------------------------------------

export interface CompanyGraphContext {
  companyId: string;
  offers: { term: string; vocabulary: "tag" | "concept"; label: string; epistemic: Epistemic | null }[];
  seeks: { term: string; vocabulary: "tag" | "concept"; label: string; epistemic: Epistemic | null }[];
  candidates: OpportunityCandidate[];
}

/** What the projection says about one company: its offered/sought concepts and the candidates that involve it. */
export function companyGraphContext(projection: Pick<GraphProjection, "nodes" | "edges" | "organizationId">, companyId: string): CompanyGraphContext | null {
  const key = nodeKey(projection.organizationId, "company", companyId);
  const node = new Map(projection.nodes.map((n) => [n.key, n]));
  if (node.get(key)?.kind !== "company") return null;
  const offers = new Map<string, CompanyGraphContext["offers"][number]>();
  const seeks = new Map<string, CompanyGraphContext["seeks"][number]>();
  const put = (into: Map<string, CompanyGraphContext["offers"][number]>, c: GraphNode | undefined, epistemic: Epistemic | null) => {
    if (c?.kind !== "concept" || into.has(c.key)) return;
    into.set(c.key, { term: String(c.attrs.term), vocabulary: c.attrs.vocabulary === "tag" ? "tag" : "concept", label: c.label, epistemic });
  };
  for (const e of projection.edges.filter((x) => x.from === key)) {
    if (e.kind === "OFFERS") put(offers, node.get(e.to), e.epistemic);
    if (e.kind === "SEEKS") put(seeks, node.get(e.to), e.epistemic);
    if (e.kind === "HAS_CAPABILITY" || e.kind === "HAS_NEED") {
      for (const t of projection.edges.filter((x) => x.from === e.to && x.kind === "TAGGED")) put(e.kind === "HAS_CAPABILITY" ? offers : seeks, node.get(t.to), e.epistemic);
    }
  }
  const { candidates } = findOpportunityCandidates(projection, { involving: companyId });
  return { companyId, offers: [...offers.values()], seeks: [...seeks.values()], candidates };
}

export async function loadCompanyGraphContext(db: Db, organizationId: string, companyId: string, deps: Pick<GraphDeps, "load"> = {}): Promise<CompanyGraphContext | null> {
  return companyGraphContext(buildProjection(await (deps.load ?? loadCanonicalSnapshot)(db, organizationId)), companyId);
}
