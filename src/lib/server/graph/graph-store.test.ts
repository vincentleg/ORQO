/**
 * Phase 10 — graph store and service. No Neo4j instance is contacted: the
 * Neo4j store runs against a fake fetch, and the service against the
 * in-memory store. Fictional workspaces only.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { BRIGHT, NOVA, ORG_A, ORG_B, snapshot } from "@/lib/graph/opportunity/fixtures";
import { buildProjection, nodeKey } from "@/lib/graph/opportunity/projection";
import { AppError } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";
import { companyGraphContext, fingerprint, loadOpportunityGraph, rebuildOrganizationGraph, resetGraphServiceState } from "./service";
import { CYPHER, GraphStoreError, MemoryGraphStore, Neo4jGraphStore, queryEndpoint, type GraphStore, type StoreConfig } from "./store";

/** requireMembership's lookup, answered with a fixed role (or no membership). */
function fakeDb(role: "viewer" | "member" | "admin" | "owner" | null, org = ORG_A): Db {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: role ? { role, organizations: { id: org, name: "Fictional workspace", default_locale: "en" } } : null, error: null }),
  };
  return { from: () => q } as unknown as Db;
}

const load = async (_db: Db, org: string) => snapshot(org);
const ready = (store: GraphStore): StoreConfig => ({ kind: "ready", store });

beforeEach(() => resetGraphServiceState());

describe("Neo4j store (fake transport)", () => {
  function recorder(respond: (statement: string) => unknown = () => ({ data: { fields: [], values: [] } }), status = 200) {
    const calls: { url: string; statement: string; parameters: Record<string, unknown>; auth: string }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { statement: string; parameters: Record<string, unknown> };
      calls.push({ url, statement: body.statement, parameters: body.parameters, auth: String((init.headers as Record<string, string>).authorization) });
      return new Response(JSON.stringify(respond(body.statement)), { status, headers: { "content-type": "application/json" } });
    };
    return { calls, store: new Neo4jGraphStore("https://graph.example/db/neo4j/query/v2", "Basic ZmFrZTpmYWtl", fetchImpl) };
  }

  test("rebuild is parameterized and organization-scoped; values never appear in statement text", async () => {
    const { calls, store } = recorder();
    const p = buildProjection(snapshot(ORG_A));
    await store.replaceOrganization(ORG_A, p, fingerprint(p), "2026-10-01T00:00:00.000Z");
    expect(calls.length).toBeGreaterThan(4);
    for (const c of calls) {
      expect(c.statement.includes(ORG_A)).toBe(false);
      expect(c.statement.includes("Nova")).toBe(false);
      if (c.statement !== CYPHER.constraint) expect(c.parameters.org).toBe(ORG_A);
      // Every match on a projected node is scoped by organization.
      for (const m of c.statement.matchAll(/\(\w*:OrqoNode \{([^}]*)\}\)/g)) expect(m[1]).toContain("organizationId: $org");
    }
    // Stale removal and the sync marker come last, in that order.
    const tail = calls.slice(-3).map((c) => c.statement);
    expect(tail).toEqual([CYPHER.deleteStaleEdges, CYPHER.deleteStaleNodes, CYPHER.writeMeta]);
  });

  test("a projection for another organization is refused", async () => {
    const { store } = recorder();
    const p = buildProjection(snapshot(ORG_B));
    await expect(store.replaceOrganization(ORG_A, p, "x", "2026-10-01T00:00:00.000Z")).rejects.toBeInstanceOf(GraphStoreError);
  });

  test("reads are bounded and drop rows that do not belong to the organization or the schema", async () => {
    const own = nodeKey(ORG_A, "company", NOVA);
    const foreign = nodeKey(ORG_B, "company", NOVA);
    const { calls, store } = recorder(() => ({
      data: {
        fields: ["key", "kind", "canonicalTable", "canonicalId", "label", "attrs"],
        values: [
          [own, "company", "companies", NOVA, "Nova", "{}"],
          [foreign, "company", "companies", NOVA, "Nova B", "{}"],
          [nodeKey(ORG_A, "company", BRIGHT), "contact", "contacts", BRIGHT, "Injected", "{}"],
        ],
      },
    }));
    const nodes = await store.nodes(ORG_A, [own, ...Array.from({ length: 500 }, (_, i) => `k${i}`)]);
    expect(nodes.map((n) => n.key)).toEqual([own]);
    expect((calls[0].parameters.keys as string[]).length).toBeLessThanOrEqual(200);
    await store.expand(ORG_A, [own], 1_000_000);
    expect(calls[1].parameters.limit).toBe(1000);
    expect(calls[1].statement).toBe(CYPHER.expand);
  });

  test("failures map to safe categories (no provider message)", async () => {
    await expect(recorder(() => ({ errors: [{ message: "secret detail" }] }), 401).store.readMeta(ORG_A)).rejects.toMatchObject({ category: "auth" });
    await expect(recorder(() => ({ errors: [] }), 500).store.readMeta(ORG_A)).rejects.toMatchObject({ category: "http" });
    await expect(recorder(() => ({ nope: true })).store.readMeta(ORG_A)).rejects.toMatchObject({ category: "invalid_response" });
    const down = new Neo4jGraphStore("https://graph.example/db/neo4j/query/v2", "Basic x", async () => {
      throw new TypeError("fetch failed");
    });
    const err = await down.readMeta(ORG_A).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphStoreError);
    expect((err as Error).message).toBe("graph_store:network");
  });

  test("Cypher tokens come only from closed maps; endpoint configuration is validated", () => {
    expect(() => CYPHER.upsertEdges("HAS_NEED) DETACH DELETE (x" as never)).toThrow();
    expect(queryEndpoint("neo4j+s://abc123.databases.neo4j.io", "neo4j")).toBe("https://abc123.databases.neo4j.io/db/neo4j/query/v2");
    expect(queryEndpoint("neo4j://localhost", "neo4j")).toBe("http://localhost:7474/db/neo4j/query/v2");
    expect(queryEndpoint("neo4j+s://host/../../admin", "neo4j")).toBeNull();
    expect(queryEndpoint("neo4j+s://host", "neo4j/../system")).toBeNull();
    expect(queryEndpoint("file:///etc/passwd", "neo4j")).toBeNull();
  });
});

describe("service", () => {
  test("Neo4j unconfigured: the graph still renders as a preview from PostgreSQL, status is truthful", async () => {
    const v = await loadOpportunityGraph(fakeDb("member"), ORG_A, { config: { kind: "unconfigured" }, load });
    expect(v.status.state).toBe("unconfigured");
    expect(v.status.provider).toBeNull();
    expect(v.status.checkedAt).toBeNull();
    expect(v.source).toBe("preview");
    expect(v.neighborhood?.nodes.length).toBeGreaterThan(1);
    expect(v.candidates.length).toBeGreaterThan(0);
  });

  test("Neo4j unavailable: degrades to the preview with a safe category, never throws", async () => {
    const broken: GraphStore = {
      provider: "neo4j",
      readMeta: async () => {
        throw new GraphStoreError("timeout");
      },
      replaceOrganization: async () => {
        throw new GraphStoreError("timeout");
      },
      nodes: async () => [],
      expand: async () => ({ nodes: [], edges: [] }),
      edgesAmong: async () => [],
    };
    const v = await loadOpportunityGraph(fakeDb("member"), ORG_A, { config: ready(broken), load });
    expect(v.status).toMatchObject({ provider: "neo4j", state: "unavailable", errorCategory: "timeout" });
    expect(v.source).toBe("preview");
    expect(v.candidates.length).toBeGreaterThan(0);
    const invalid = await loadOpportunityGraph(fakeDb("member"), ORG_A, { config: { kind: "invalid" }, load });
    expect(invalid.status).toMatchObject({ state: "unavailable", errorCategory: "config" });
  });

  test("not synced → rebuild → in sync and read from the store; canonical change → stale", async () => {
    const store = new MemoryGraphStore();
    const before = await loadOpportunityGraph(fakeDb("admin"), ORG_A, { config: ready(store), load });
    expect(before.status.state).toBe("not_synced");
    await rebuildOrganizationGraph(fakeDb("admin"), "user", ORG_A, { config: ready(store), load });
    const after = await loadOpportunityGraph(fakeDb("admin"), ORG_A, { config: ready(store), load, focusCompanyId: NOVA });
    expect(after.status.state).toBe("in_sync");
    expect(after.source).toBe("store");
    expect(after.status.provider).toBe("memory");
    // The store read and the preview give the same bounded neighborhood.
    const preview = await loadOpportunityGraph(fakeDb("admin"), ORG_A, { config: { kind: "unconfigured" }, load, focusCompanyId: NOVA });
    expect(after.neighborhood?.nodes.map((n) => n.key)).toEqual(preview.neighborhood!.nodes.map((n) => n.key));
    const changed = await loadOpportunityGraph(fakeDb("admin"), ORG_A, { config: ready(store), load: async (_d, org) => snapshot(org, { signals: [] }) });
    expect(changed.status.state).toBe("stale");
  });

  test("rebuild is idempotent, removes stale data, and never touches another organization", async () => {
    const store = new MemoryGraphStore();
    const now = (s: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, s * 60));
    await rebuildOrganizationGraph(fakeDb("admin", ORG_B), "user", ORG_B, { config: ready(store), load, now: now(0) });
    const bNodes = JSON.stringify(store.allNodes().filter((n) => n.organizationId === ORG_B));
    await rebuildOrganizationGraph(fakeDb("admin"), "user", ORG_A, { config: ready(store), load, now: now(1) });
    const once = JSON.stringify(store.allNodes());
    await rebuildOrganizationGraph(fakeDb("admin"), "user", ORG_A, { config: ready(store), load, now: now(2) });
    expect(JSON.stringify(store.allNodes())).toBe(once);
    // Stale: a capability deleted in PostgreSQL disappears on the next rebuild.
    await rebuildOrganizationGraph(fakeDb("admin"), "user", ORG_A, { config: ready(store), load: async (_d, org) => snapshot(org, { capabilities: [] }), now: now(3) });
    expect(store.allNodes().some((n) => n.organizationId === ORG_A && n.kind === "capability")).toBe(false);
    expect(JSON.stringify(store.allNodes().filter((n) => n.organizationId === ORG_B))).toBe(bNodes);
  });

  test("rebuild requires admin, a configured store, and is throttled", async () => {
    const store = new MemoryGraphStore();
    await expect(rebuildOrganizationGraph(fakeDb("member"), "user", ORG_A, { config: ready(store), load })).rejects.toMatchObject({ code: "forbidden" });
    await expect(rebuildOrganizationGraph(fakeDb(null), "user", ORG_A, { config: ready(store), load })).rejects.toMatchObject({ code: "not_found" });
    await expect(rebuildOrganizationGraph(fakeDb("owner"), "user", ORG_A, { config: { kind: "unconfigured" }, load })).rejects.toBeInstanceOf(AppError);
    const t = new Date("2026-10-01T00:00:00.000Z");
    await rebuildOrganizationGraph(fakeDb("owner"), "user", ORG_A, { config: ready(store), load, now: t });
    await expect(rebuildOrganizationGraph(fakeDb("owner"), "user", ORG_A, { config: ready(store), load, now: new Date(t.getTime() + 1000) })).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("a failed rebuild is recorded as a safe category and the view still loads", async () => {
    const failing = new MemoryGraphStore();
    failing.replaceOrganization = async () => {
      throw new GraphStoreError("timeout");
    };
    await expect(rebuildOrganizationGraph(fakeDb("admin"), "user", ORG_A, { config: ready(failing), load })).rejects.toMatchObject({ code: "unavailable" });
    const v = await loadOpportunityGraph(fakeDb("admin"), ORG_A, { config: ready(failing), load });
    expect(v.status.lastSyncError?.category).toBe("timeout");
    expect(v.status.state).toBe("not_synced");
  });

  test("no canonical write and no outbound call happen on the graph read path", async () => {
    const writes: string[] = [];
    const db = new Proxy({}, { get: (_t, p) => (p === "from" ? (table: string) => (writes.push(table), {}) : undefined) }) as unknown as Db;
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("no network");
    }) as unknown as typeof fetch;
    try {
      await loadOpportunityGraph(db, ORG_A, { config: { kind: "unconfigured" }, load });
    } finally {
      globalThis.fetch = original;
    }
    expect(writes).toEqual([]);
    expect(calls).toBe(0);
  });

  test("company context lists offered/sought concepts with their status and only candidates involving the company", () => {
    const p = buildProjection(snapshot(ORG_A));
    const ctx = companyGraphContext(p, BRIGHT)!;
    expect(ctx.seeks).toEqual([{ term: "computer-vision", vocabulary: "tag", label: "Computer vision", epistemic: "inference" }]);
    expect(ctx.candidates.every((c) => c.companies.some((x) => x.id === BRIGHT))).toBe(true);
    expect(companyGraphContext(p, "00000000-0000-4000-8000-999999999999")).toBeNull();
  });
});

describe("PostgreSQL loader and agent seam", () => {
  /** A Supabase-like query builder that records every table, filter and column list, and returns no rows. */
  function recordingDb() {
    const queries: { table: string; columns: string; filters: [string, unknown][] }[] = [];
    const db = {
      from(table: string) {
        const q = { table, columns: "", filters: [] as [string, unknown][] };
        queries.push(q);
        const chain: Record<string, unknown> = {
          select: (c: string) => ((q.columns = c), chain),
          eq: (col: string, v: unknown) => (q.filters.push([col, v]), chain),
          neq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    };
    return { db: db as unknown as Db, queries };
  }

  test("every canonical read is filtered by the organization and selects no private CRM column", async () => {
    const { loadCanonicalSnapshot } = await import("./canonical");
    const { db, queries } = recordingDb();
    const s = await loadCanonicalSnapshot(db, ORG_A);
    expect(s.companies).toEqual([]);
    expect(queries.length).toBe(11);
    for (const q of queries) expect(q.filters).toContainEqual(["organization_id", ORG_A]);
    expect(queries.some((q) => q.table === "contacts")).toBe(false);
    const cols = (t: string) => queries.find((q) => q.table === t)!.columns;
    expect(cols("interactions")).toBe("company_id, occurred_at");
    expect(cols("follow_ups")).toBe("company_id");
    for (const [table, forbidden] of [
      ["companies", ["network_reason", "summary"]],
      ["event_companies", ["why", "prep_notes"]],
      ["evidence_items", ["excerpt", "statement"]],
      ["company_signals", ["excerpt", "detail"]],
      ["events", ["description", "objective"]],
      ["company_needs", ["disclosure", "detail"]],
    ] as const) {
      for (const f of forbidden) expect(cols(table).split(", ")).not.toContain(f);
    }
  });

  test("the graph tool is read-only, bounded, not granted to any agent, and accepts no query text", async () => {
    const { TOOLS } = await import("@/lib/agents/tools");
    const { TOOL_PERMISSIONS, PRIVATE_FIELDS } = await import("@/lib/agents/permissions");
    const { AGENT_REGISTRY, CAPABILITIES } = await import("@/lib/agents/registry");
    const { TOOL_IMPLEMENTATIONS } = await import("@/lib/server/agents/tools");
    const meta = TOOLS.read_opportunity_graph;
    expect(meta).toMatchObject({ risk: "read", externalNetwork: false, variableCost: false, approval: "never", limits: { maxExternalRequests: 0, maxModelCalls: 0 } });
    expect(TOOL_PERMISSIONS.read_opportunity_graph.access).toBe("read");
    expect([...TOOL_PERMISSIONS.read_opportunity_graph.withholds].sort()).toEqual([...PRIVATE_FIELDS].sort());
    expect(Object.values(AGENT_REGISTRY).some((a) => (a.tools as readonly string[]).includes("read_opportunity_graph"))).toBe(false);
    expect(CAPABILITIES.opportunity_graph.tools).toEqual(["read_opportunity_graph"]);
    const impl = TOOL_IMPLEMENTATIONS.read_opportunity_graph;
    expect(impl.input.safeParse({ companyId: NOVA }).success).toBe(true);
    expect(impl.input.safeParse({ companyId: NOVA, cypher: "MATCH (n) DETACH DELETE n" }).success).toBe(false);
    expect(impl.input.safeParse({ companyId: "x' OR 1=1" }).success).toBe(false);

    // Runs against the run's organization only.
    const { db, queries } = recordingDb();
    const out = await (impl.run as (env: unknown, input: unknown) => Promise<unknown>)({ db, organizationId: ORG_A, userId: "u", locale: "en", agentRunId: "r", research: null }, { companyId: NOVA });
    expect(out).toEqual({ context: null });
    expect(queries.every((q) => q.filters.some(([c, v]) => c === "organization_id" && v === ORG_A))).toBe(true);
  });
});
