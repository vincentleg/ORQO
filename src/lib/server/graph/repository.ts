/**
 * Graph persistence. The UI never talks to Neo4j directly: it keeps the
 * in-memory World, and this repository mirrors its graph projection into Neo4j
 * when credentials are configured. Uses the Neo4j HTTPS Query API (no driver).
 */
import type { EdgeKind, GraphElements, NodeKind } from "@/lib/graph/elements";
import { serverConfig } from "../config";

export interface GraphRepository {
  readonly backend: "neo4j" | "memory";
  sync(elements: GraphElements): Promise<{ nodes: number; edges: number }>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

const NODE_LABEL: Record<NodeKind, string> = {
  person: "Person",
  company: "Company",
  opportunity: "Opportunity",
  capability: "Capability",
  need: "Need",
  signal: "Signal",
};

const EDGE_KINDS: readonly EdgeKind[] = ["WORKS_AT", "MET", "PARTICIPATES_IN", "OFFERS", "NEEDS", "EMITTED", "AFFECTS", "DERIVED_FROM"];

class MemoryGraphRepository implements GraphRepository {
  readonly backend = "memory" as const;
  private last: GraphElements = { nodes: [], edges: [] };
  async sync(elements: GraphElements) {
    this.last = elements;
    return { nodes: this.last.nodes.length, edges: this.last.edges.length };
  }
  async health() {
    return { ok: true, detail: "In-memory graph (no Neo4j credentials configured)." };
  }
}

class Neo4jGraphRepository implements GraphRepository {
  readonly backend = "neo4j" as const;
  constructor(
    private readonly endpoint: string,
    private readonly auth: string,
  ) {}

  private async query(statement: string, parameters: Record<string, unknown> = {}) {
    const res = await fetch(this.endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Basic ${this.auth}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ statement, parameters }),
    });
    if (!res.ok) throw new Error(`Neo4j ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<unknown>;
  }

  async sync(elements: GraphElements) {
    const kinds = [...new Set(elements.nodes.map((n) => n.kind))];
    for (const kind of kinds) {
      const nodes = elements.nodes.filter((n) => n.kind === kind).map((n) => ({ id: n.id, props: { ...n.props, name: n.label } }));
      // Labels cannot be parameterised; they come from the closed NODE_LABEL map, never from input.
      await this.query(`UNWIND $nodes AS n MERGE (x:OrqoEntity {id: n.id}) SET x:${NODE_LABEL[kind]}, x += n.props`, { nodes });
    }
    for (const kind of EDGE_KINDS) {
      const edges = elements.edges.filter((e) => e.kind === kind).map((e) => ({ from: e.from, to: e.to, props: e.props }));
      if (edges.length === 0) continue;
      await this.query(
        `UNWIND $edges AS e MATCH (a:OrqoEntity {id: e.from}), (b:OrqoEntity {id: e.to}) MERGE (a)-[r:${kind}]->(b) SET r += e.props`,
        { edges },
      );
    }
    return { nodes: elements.nodes.length, edges: elements.edges.length };
  }

  async health() {
    try {
      await this.query("RETURN 1 AS ok");
      return { ok: true, detail: "Connected to Neo4j." };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Neo4j unreachable." };
    }
  }
}

/** neo4j+s://host → https://host/db/{db}/query/v2 */
function queryEndpoint(uri: string, database: string): string {
  const host = uri.replace(/^(neo4j|bolt)(\+s|\+ssc)?:\/\//, "").replace(/^https?:\/\//, "").replace(/:\d+$/, "").replace(/\/.*$/, "");
  const secure = !/^(neo4j|bolt):\/\//.test(uri) || uri.includes("+s");
  return `${secure ? "https" : "http"}://${host}${secure ? "" : ":7474"}/db/${database}/query/v2`;
}

let memory: MemoryGraphRepository | undefined;

export function graphRepository(): GraphRepository {
  const { uri, username, password, database } = serverConfig().neo4j;
  if (uri && password) {
    return new Neo4jGraphRepository(queryEndpoint(uri, database), Buffer.from(`${username ?? "neo4j"}:${password}`).toString("base64"));
  }
  memory ??= new MemoryGraphRepository();
  return memory;
}
