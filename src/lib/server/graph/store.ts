/**
 * Graph store port (Phase 10): where a DERIVED projection is kept for
 * traversal. PostgreSQL stays canonical; a store only ever receives what
 * buildProjection() produced and can be wiped and rebuilt at any time.
 *
 * Every operation takes the organization id from the server (never from the
 * browser) and every Cypher statement matches on it, so traversal cannot cross
 * workspaces even when two workspaces track the same real-world company.
 * Statements are constants: values travel as parameters; the only interpolated
 * tokens are labels/relationship types from the closed maps below. There is no
 * way to submit Cypher through this module.
 */
import { z } from "zod";
import { EDGE_BASES, EDGE_KINDS, NODE_KINDS, type EdgeKind, type GraphEdge, type GraphNode, type GraphProjection, type NodeKind } from "@/lib/graph/opportunity/projection";
import { serverConfig } from "../config";

export interface ProjectionMeta {
  version: string;
  fingerprint: string;
  syncedAt: string;
  nodes: number;
  edges: number;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type GraphErrorCategory = "config" | "timeout" | "network" | "auth" | "http" | "invalid_response";

/** A store failure with a safe category. The provider's message is never shown to users. */
export class GraphStoreError extends Error {
  constructor(readonly category: GraphErrorCategory) {
    super(`graph_store:${category}`);
  }
}

export interface GraphStore {
  readonly provider: "neo4j" | "memory";
  /** The organization's sync marker (null: never synced). Also the reachability check. */
  readMeta(organizationId: string): Promise<ProjectionMeta | null>;
  /** Idempotent replace of ONE organization's projection: upsert by key, then remove what the projection no longer contains. */
  replaceOrganization(organizationId: string, projection: GraphProjection, fingerprint: string, syncedAt: string): Promise<ProjectionMeta>;
  nodes(organizationId: string, keys: readonly string[]): Promise<GraphNode[]>;
  /** One hop around the given nodes: neighbors and the connecting edges. Bounded by `limit` rows. */
  expand(organizationId: string, keys: readonly string[], limit: number): Promise<Subgraph>;
  edgesAmong(organizationId: string, keys: readonly string[], limit: number): Promise<GraphEdge[]>;
}

export const STORE_LIMITS = { maxKeys: 200, maxRows: 1000, batch: 500, readTimeoutMs: 4_000, writeTimeoutMs: 15_000 } as const;

const boundedKeys = (keys: readonly string[]) => [...new Set(keys)].slice(0, STORE_LIMITS.maxKeys);
const boundedLimit = (n: number) => Math.max(1, Math.min(Math.trunc(n), STORE_LIMITS.maxRows));

// ---------------------------------------------------------------------------
// In-memory store: deterministic test double. Never presented as Neo4j.
// ---------------------------------------------------------------------------

export class MemoryGraphStore implements GraphStore {
  readonly provider = "memory" as const;
  private readonly orgs = new Map<string, { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge>; meta: ProjectionMeta | null }>();

  private org(id: string) {
    let o = this.orgs.get(id);
    if (!o) this.orgs.set(id, (o = { nodes: new Map(), edges: new Map(), meta: null }));
    return o;
  }

  async readMeta(organizationId: string) {
    return this.orgs.get(organizationId)?.meta ?? null;
  }

  async replaceOrganization(organizationId: string, projection: GraphProjection, fingerprint: string, syncedAt: string) {
    if (projection.organizationId !== organizationId) throw new GraphStoreError("invalid_response");
    const o = this.org(organizationId);
    o.nodes = new Map(projection.nodes.filter((n) => n.organizationId === organizationId).map((n) => [n.key, n]));
    o.edges = new Map(projection.edges.filter((e) => e.organizationId === organizationId && o.nodes.has(e.from) && o.nodes.has(e.to)).map((e) => [e.key, e]));
    o.meta = { version: projection.version, fingerprint, syncedAt, nodes: o.nodes.size, edges: o.edges.size };
    return o.meta;
  }

  async nodes(organizationId: string, keys: readonly string[]) {
    const o = this.orgs.get(organizationId);
    return o ? boundedKeys(keys).flatMap((k) => (o.nodes.has(k) ? [o.nodes.get(k)!] : [])) : [];
  }

  async expand(organizationId: string, keys: readonly string[], limit: number) {
    const o = this.orgs.get(organizationId);
    if (!o) return { nodes: [], edges: [] };
    const ks = new Set(boundedKeys(keys));
    const edges = [...o.edges.values()].filter((e) => ks.has(e.from) || ks.has(e.to)).slice(0, boundedLimit(limit));
    const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))].map((k) => o.nodes.get(k)!).filter(Boolean);
    return { nodes, edges };
  }

  async edgesAmong(organizationId: string, keys: readonly string[], limit: number) {
    const o = this.orgs.get(organizationId);
    const ks = new Set(boundedKeys(keys));
    return o ? [...o.edges.values()].filter((e) => ks.has(e.from) && ks.has(e.to)).slice(0, boundedLimit(limit)) : [];
  }

  /** Test helper: every node of every organization. */
  allNodes(): GraphNode[] {
    return [...this.orgs.values()].flatMap((o) => [...o.nodes.values()]);
  }
}

// ---------------------------------------------------------------------------
// Neo4j store over the HTTPS Query API v2 (no driver dependency).
// ---------------------------------------------------------------------------

/** Closed maps: the only tokens ever interpolated into Cypher. */
export const NODE_LABELS: Record<NodeKind, string> = {
  company: "Company",
  capability: "Capability",
  need: "Need",
  concept: "Concept",
  opportunity: "Opportunity",
  signal: "Signal",
  event: "Event",
};
const SAFE_TOKEN = /^[A-Z][A-Za-z_]{0,39}$/;
function token(t: string): string {
  if (!SAFE_TOKEN.test(t)) throw new GraphStoreError("config");
  return t;
}

const NODE_FIELDS = "x.key AS key, x.kind AS kind, x.canonicalTable AS canonicalTable, x.canonicalId AS canonicalId, x.label AS label, x.attrs AS attrs";
const EDGE_FIELDS = "r.key AS edgeKey, r.kind AS edgeKind, startNode(r).key AS edgeFrom, endNode(r).key AS edgeTo, r.epistemic AS epistemic, r.basis AS basis, r.provenance AS provenance, r.attrs AS edgeAttrs";

export const CYPHER = {
  constraint: "CREATE CONSTRAINT orqo_node_org_key IF NOT EXISTS FOR (x:OrqoNode) REQUIRE (x.organizationId, x.key) IS UNIQUE",
  upsertNodes: (kind: NodeKind) =>
    `UNWIND $rows AS n MERGE (x:OrqoNode {organizationId: $org, key: n.key}) SET x:${token(NODE_LABELS[kind])}, x.kind = n.kind, x.canonicalTable = n.canonicalTable, x.canonicalId = n.canonicalId, x.label = n.label, x.attrs = n.attrs, x.projectionVersion = $version, x.syncId = $syncId`,
  upsertEdges: (kind: EdgeKind) =>
    `UNWIND $rows AS e MATCH (a:OrqoNode {organizationId: $org, key: e.from}) MATCH (b:OrqoNode {organizationId: $org, key: e.to}) MERGE (a)-[r:${token(kind)} {key: e.key}]->(b) SET r.organizationId = $org, r.kind = e.kind, r.epistemic = e.epistemic, r.basis = e.basis, r.provenance = e.provenance, r.attrs = e.attrs, r.syncId = $syncId`,
  deleteStaleEdges: "MATCH (:OrqoNode {organizationId: $org})-[r]->(:OrqoNode {organizationId: $org}) WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  deleteStaleNodes: "MATCH (x:OrqoNode {organizationId: $org}) WHERE x.syncId IS NULL OR x.syncId <> $syncId DETACH DELETE x",
  writeMeta:
    "MERGE (m:OrqoProjection {organizationId: $org}) SET m.version = $version, m.fingerprint = $fingerprint, m.syncedAt = $syncedAt, m.nodes = $nodes, m.edges = $edges RETURN m.syncedAt AS syncedAt",
  readMeta: "OPTIONAL MATCH (m:OrqoProjection {organizationId: $org}) RETURN m.version AS version, m.fingerprint AS fingerprint, m.syncedAt AS syncedAt, m.nodes AS nodes, m.edges AS edges",
  nodes: `MATCH (x:OrqoNode {organizationId: $org}) WHERE x.key IN $keys RETURN ${NODE_FIELDS} LIMIT $limit`,
  expand: `MATCH (a:OrqoNode {organizationId: $org})-[r]-(x:OrqoNode {organizationId: $org}) WHERE a.key IN $keys AND r.organizationId = $org RETURN ${NODE_FIELDS}, ${EDGE_FIELDS} LIMIT $limit`,
  edgesAmong: `MATCH (a:OrqoNode {organizationId: $org})-[r]->(b:OrqoNode {organizationId: $org}) WHERE a.key IN $keys AND b.key IN $keys AND r.organizationId = $org RETURN ${EDGE_FIELDS} LIMIT $limit`,
} as const;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const QueryResponse = z.object({ data: z.object({ fields: z.array(z.string()), values: z.array(z.array(z.unknown())) }) });

const Attrs = z
  .string()
  .nullable()
  .transform((s, ctx) => {
    try {
      const v: unknown = JSON.parse(s ?? "{}");
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as GraphNode["attrs"];
    } catch {
      /* fall through */
    }
    ctx.addIssue({ code: "custom", message: "attrs" });
    return z.NEVER;
  });
const NodeRecord = z.object({ key: z.string(), kind: z.enum(NODE_KINDS), canonicalTable: z.string(), canonicalId: z.string(), label: z.string(), attrs: Attrs });
const EdgeRecord = z.object({
  edgeKey: z.string(),
  edgeKind: z.enum(EDGE_KINDS),
  edgeFrom: z.string(),
  edgeTo: z.string(),
  epistemic: z.enum(["fact", "inference", "assumption"]).nullable(),
  basis: z.enum(EDGE_BASES),
  provenance: z.array(z.string()),
  edgeAttrs: Attrs,
});

export class Neo4jGraphStore implements GraphStore {
  readonly provider = "neo4j" as const;
  constructor(
    private readonly endpoint: string,
    private readonly authorization: string,
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
  ) {}

  /** One parameterized statement. Throws GraphStoreError with a safe category only. */
  async run(statement: string, parameters: Record<string, unknown>, timeoutMs: number = STORE_LIMITS.readTimeoutMs): Promise<Record<string, unknown>[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: this.authorization, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ statement, parameters }),
        cache: "no-store",
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      throw new GraphStoreError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    }
    if (res.status === 401 || res.status === 403) throw new GraphStoreError("auth");
    if (!res.ok) {
      // Logged server-side as a status only: provider bodies can echo query details.
      console.error("[orqo] graph store request failed", res.status);
      throw new GraphStoreError("http");
    }
    const parsed = QueryResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new GraphStoreError("invalid_response");
    const { fields, values } = parsed.data.data;
    return values.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
  }

  async readMeta(organizationId: string) {
    const [row] = await this.run(CYPHER.readMeta, { org: organizationId });
    const m = z.object({ version: z.string(), fingerprint: z.string(), syncedAt: z.string(), nodes: z.number(), edges: z.number() }).safeParse(row);
    return m.success ? m.data : null;
  }

  async replaceOrganization(organizationId: string, projection: GraphProjection, fingerprint: string, syncedAt: string) {
    if (projection.organizationId !== organizationId) throw new GraphStoreError("invalid_response");
    const W = STORE_LIMITS.writeTimeoutMs;
    const syncId = `${fingerprint.slice(0, 16)}:${syncedAt}`;
    const base = { org: organizationId, version: projection.version, syncId };
    try {
      await this.run(CYPHER.constraint, {}, W);
    } catch {
      // Best effort: the edition may not support composite constraints. MERGE on (organizationId, key) stays correct.
    }
    for (const kind of NODE_KINDS) {
      const rows = projection.nodes
        .filter((n) => n.kind === kind && n.organizationId === organizationId)
        .map((n) => ({ key: n.key, kind: n.kind, canonicalTable: n.canonicalTable, canonicalId: n.canonicalId, label: n.label, attrs: JSON.stringify(n.attrs) }));
      for (let i = 0; i < rows.length; i += STORE_LIMITS.batch) await this.run(CYPHER.upsertNodes(kind), { ...base, rows: rows.slice(i, i + STORE_LIMITS.batch) }, W);
    }
    for (const kind of EDGE_KINDS) {
      const rows = projection.edges
        .filter((e) => e.kind === kind && e.organizationId === organizationId)
        .map((e) => ({ key: e.key, kind: e.kind, from: e.from, to: e.to, epistemic: e.epistemic, basis: e.basis, provenance: e.provenance, attrs: JSON.stringify(e.attrs) }));
      for (let i = 0; i < rows.length; i += STORE_LIMITS.batch) await this.run(CYPHER.upsertEdges(kind), { ...base, rows: rows.slice(i, i + STORE_LIMITS.batch) }, W);
    }
    // Reconcile: whatever this sync did not touch is stale for THIS organization only.
    await this.run(CYPHER.deleteStaleEdges, { org: organizationId, syncId }, W);
    await this.run(CYPHER.deleteStaleNodes, { org: organizationId, syncId }, W);
    // Written last: an interrupted sync keeps the old marker, so the graph reads as stale, never as current.
    const meta = { version: projection.version, fingerprint, syncedAt, nodes: projection.nodes.length, edges: projection.edges.length };
    await this.run(CYPHER.writeMeta, { org: organizationId, ...meta }, W);
    return meta;
  }

  private toNodes(rows: Record<string, unknown>[], organizationId: string): GraphNode[] {
    return rows.flatMap((r) => {
      const n = NodeRecord.safeParse(r);
      // Anything that does not match the projection schema (or another workspace's key) is ignored, not trusted.
      if (!n.success || !n.data.key.startsWith(`${organizationId}/`)) return [];
      return [{ key: n.data.key, kind: n.data.kind, organizationId, canonicalTable: n.data.canonicalTable as GraphNode["canonicalTable"], canonicalId: n.data.canonicalId, label: n.data.label, attrs: n.data.attrs }];
    });
  }

  private toEdges(rows: Record<string, unknown>[], organizationId: string): GraphEdge[] {
    return rows.flatMap((r) => {
      const e = EdgeRecord.safeParse(r);
      if (!e.success || !e.data.edgeFrom.startsWith(`${organizationId}/`) || !e.data.edgeTo.startsWith(`${organizationId}/`)) return [];
      const d = e.data;
      return [{ key: d.edgeKey, kind: d.edgeKind, organizationId, from: d.edgeFrom, to: d.edgeTo, epistemic: d.epistemic, basis: d.basis, provenance: d.provenance, attrs: d.edgeAttrs }];
    });
  }

  async nodes(organizationId: string, keys: readonly string[]) {
    const ks = boundedKeys(keys);
    return this.toNodes(await this.run(CYPHER.nodes, { org: organizationId, keys: ks, limit: ks.length || 1 }), organizationId);
  }

  async expand(organizationId: string, keys: readonly string[], limit: number) {
    const rows = await this.run(CYPHER.expand, { org: organizationId, keys: boundedKeys(keys), limit: boundedLimit(limit) });
    return { nodes: this.toNodes(rows, organizationId), edges: this.toEdges(rows, organizationId) };
  }

  async edgesAmong(organizationId: string, keys: readonly string[], limit: number) {
    return this.toEdges(await this.run(CYPHER.edgesAmong, { org: organizationId, keys: boundedKeys(keys), limit: boundedLimit(limit) }), organizationId);
  }
}

// ---------------------------------------------------------------------------
// Configuration (server-side environment only; never sent to the browser).
// ---------------------------------------------------------------------------

/** neo4j+s://host → https://host/db/{db}/query/v2. null: the URI is not a recognised Neo4j/HTTP address. */
export function queryEndpoint(uri: string, database: string): string | null {
  const m = /^(neo4j|bolt|https?)(\+s|\+ssc)?:\/\/([a-z0-9.-]{1,253})(?::\d{1,5})?\/?$/i.exec(uri.trim());
  if (!m || !/^[A-Za-z0-9._-]{1,63}$/.test(database)) return null;
  const scheme = m[1].toLowerCase();
  const secure = scheme === "https" || Boolean(m[2]);
  if (scheme === "http" && m[2]) return null;
  return `${secure ? "https" : "http"}://${m[3].toLowerCase()}${secure ? "" : ":7474"}/db/${database}/query/v2`;
}

export type StoreConfig = { kind: "unconfigured" } | { kind: "invalid" } | { kind: "ready"; store: GraphStore };

/** Neo4j is optional: absent → "unconfigured", malformed → "invalid". Neither throws. */
export function graphStoreFromEnv(): StoreConfig {
  const { uri, username, password, database } = serverConfig().neo4j;
  if (!uri || !password) return { kind: "unconfigured" };
  const endpoint = queryEndpoint(uri, database);
  if (!endpoint) return { kind: "invalid" };
  return { kind: "ready", store: new Neo4jGraphStore(endpoint, `Basic ${Buffer.from(`${username ?? "neo4j"}:${password}`).toString("base64")}`) };
}

