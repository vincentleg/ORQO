/**
 * Projects the World into typed graph nodes and edges. Used by the UI graph and
 * by the Neo4j repository, so both see the same shape.
 */
import type { World } from "@/lib/domain/types";

export type NodeKind = "person" | "company" | "opportunity" | "capability" | "need" | "signal";
export type EdgeKind = "WORKS_AT" | "MET" | "PARTICIPATES_IN" | "OFFERS" | "NEEDS" | "EMITTED" | "AFFECTS" | "DERIVED_FROM";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  props: Record<string, string | number | boolean | null>;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  props: Record<string, string | number | boolean | null>;
}

export interface GraphElements {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function toGraph(world: World, opts: { detail?: boolean } = {}): GraphElements {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edge = (kind: EdgeKind, from: string, to: string, props: GraphEdge["props"] = {}) =>
    edges.push({ id: `${kind}:${from}->${to}`, kind, from, to, props });

  for (const c of Object.values(world.companies)) {
    nodes.push({ id: c.id, kind: "company", label: c.name, props: { headquarters: c.headquarters, accent: c.accent } });
    if (!opts.detail) continue;
    for (const cap of c.offers) {
      nodes.push({ id: cap.id, kind: "capability", label: cap.label, props: { visibility: cap.visibility, observedAt: cap.observedAt, tags: cap.tags.join(",") } });
      edge("OFFERS", c.id, cap.id, { source: cap.evidence[0]?.sourceId ?? null });
    }
    for (const n of c.needs) {
      nodes.push({ id: n.id, kind: "need", label: n.label, props: { visibility: n.visibility, intensity: n.intensity, observedAt: n.observedAt, tags: n.tags.join(",") } });
      edge("NEEDS", c.id, n.id, { source: n.evidence[0]?.sourceId ?? null });
    }
  }
  for (const p of Object.values(world.people)) {
    nodes.push({ id: p.id, kind: "person", label: p.name, props: { role: p.role } });
    edge("WORKS_AT", p.id, p.companyId);
  }
  for (const r of Object.values(world.relationships)) {
    edge("MET", r.personIds[0], r.personIds[1], {
      relationshipId: r.id,
      event: r.encounter.event,
      date: r.encounter.date,
      status: r.status,
      evaluations: r.evaluations.length,
    });
  }
  for (const o of Object.values(world.opportunities)) {
    nodes.push({ id: o.id, kind: "opportunity", label: o.title, props: { stage: o.stage, confidence: o.confidence.level, verdict: o.critic.verdict, kind: o.kind, discoveredAt: o.discoveredAt } });
    for (const c of o.contributions) edge("PARTICIPATES_IN", c.companyId, o.id, { role: c.role });
    for (const parent of o.parentOpportunityIds ?? []) edge("DERIVED_FROM", o.id, parent);
  }
  if (opts.detail) {
    for (const s of Object.values(world.signals)) {
      nodes.push({ id: s.id, kind: "signal", label: s.headline, props: { type: s.type, occurredAt: s.occurredAt, simulated: s.simulated } });
      edge("EMITTED", s.companyId, s.id);
      for (const r of s.affectedRelationshipIds) edge("AFFECTS", s.id, r);
    }
  }
  return { nodes, edges };
}
