/**
 * Bounded neighborhood of one node (Phase 10). Graph reads never return the
 * whole workspace: depth, nodes per layer and total nodes are capped here,
 * whatever the source (in-process preview or Neo4j). Layers are breadth-first
 * distances from the focus, which also gives the map its column layout.
 */
import { NODE_KINDS, type GraphEdge, type GraphNode } from "./projection";

export const NEIGHBORHOOD_LIMITS = { maxDepth: 4, maxNodes: 36, maxPerLayer: 10 } as const;

export interface Neighborhood {
  focus: string;
  nodes: (GraphNode & { depth: number })[];
  edges: GraphEdge[];
  /** Reachable nodes left out by the bounds. */
  omitted: number;
}

const KIND_ORDER = new Map(NODE_KINDS.map((k, i) => [k, i]));

export function neighborhood(
  graph: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] },
  focus: string,
  opts: { maxDepth?: number; maxNodes?: number; maxPerLayer?: number } = {},
): Neighborhood | null {
  const maxDepth = Math.min(opts.maxDepth ?? NEIGHBORHOOD_LIMITS.maxDepth, NEIGHBORHOOD_LIMITS.maxDepth);
  const maxNodes = Math.min(opts.maxNodes ?? NEIGHBORHOOD_LIMITS.maxNodes, NEIGHBORHOOD_LIMITS.maxNodes);
  const maxPerLayer = Math.min(opts.maxPerLayer ?? NEIGHBORHOOD_LIMITS.maxPerLayer, NEIGHBORHOOD_LIMITS.maxPerLayer);
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const start = byKey.get(focus);
  if (!start) return null;

  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const order = (a: GraphNode, b: GraphNode) => KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)! || a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

  const kept = new Map<string, number>([[focus, 0]]);
  const seen = new Set([focus]);
  let frontier = [focus];
  let omitted = 0;
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next = [...new Set(frontier.flatMap((k) => adj.get(k) ?? []))].filter((k) => !seen.has(k) && byKey.has(k));
    next.forEach((k) => seen.add(k));
    const layer = next.map((k) => byKey.get(k)!).sort(order);
    const room = Math.max(0, Math.min(maxPerLayer, maxNodes - kept.size));
    layer.slice(0, room).forEach((n) => kept.set(n.key, depth));
    omitted += Math.max(0, layer.length - room);
    // Only kept nodes are expanded: the bound also bounds the traversal.
    frontier = layer.slice(0, room).map((n) => n.key);
  }
  return {
    focus,
    nodes: [...kept].map(([k, depth]) => ({ ...byKey.get(k)!, depth })).sort((a, b) => a.depth - b.depth || order(a, b)),
    edges: graph.edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
    omitted,
  };
}
