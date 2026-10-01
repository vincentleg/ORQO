/**
 * LEGACY DEMO graph mirror (browser-local /demo only).
 *
 * The /demo "Sync graph" button posts the client's demo World here. Until
 * Phase 10 this could be mirrored into Neo4j in a global, non-tenant id
 * namespace. Phase 10 makes the production Opportunity Graph the only writer
 * of Neo4j (src/lib/server/graph/service.ts: organization-scoped, rebuilt
 * from PostgreSQL), so this demo mirror is in-memory only: browser-supplied
 * demo data can never reach the production graph.
 */
import type { GraphElements } from "@/lib/graph/elements";

export interface GraphRepository {
  readonly backend: "memory";
  sync(elements: GraphElements): Promise<{ nodes: number; edges: number }>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

class MemoryGraphRepository implements GraphRepository {
  readonly backend = "memory" as const;
  private last: GraphElements = { nodes: [], edges: [] };
  async sync(elements: GraphElements) {
    this.last = elements;
    return { nodes: this.last.nodes.length, edges: this.last.edges.length };
  }
  async health() {
    return { ok: true, detail: "In-memory demo graph (the demo never writes to Neo4j)." };
  }
}

let memory: MemoryGraphRepository | undefined;

export function graphRepository(): GraphRepository {
  memory ??= new MemoryGraphRepository();
  return memory;
}
