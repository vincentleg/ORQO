/**
 * The opportunity map of a dossier (Nov 2026): nodes and edges derived ONLY from the dossier, so the graph can
 * never contradict the analysis. Pure. Used by the company page and the public guided tour.
 *
 *   own ──provides──> contribution ──> [credible scenario] <── contribution <──brings── target
 *                                         ▲                 ▲
 *                     shared context ─────┘                 └───── timing evidence (dated, cited)
 *   rejected ideas hang off the pair with the critic's reason (rendered dashed).
 */
import type { Dossier } from "./dossier";
import type { CriticCode, Scenario } from "./scenarios";

export type MapNodeKind = "company" | "contribution" | "scenario" | "shared" | "evidence" | "rejected";

export interface MapNode {
  id: string;
  kind: MapNodeKind;
  /** company: "own" | "target"; contribution: side; others: "both". */
  side: "own" | "target" | "both";
  /** What to label: a company name, "provider"/"partner" (contribution), a scenario key, a concept key, a statement. */
  ref: string;
  /** scenario/rejected: the mechanism key; rejected: the decisive critic code. */
  mechanism?: string;
  critic?: CriticCode;
  sourceUrl?: string | null;
  /** contribution: the scenario's trait keys for this side ("role:manufacturer", "offering_form:physical_product"). */
  traits?: string[];
}

export interface MapEdge {
  from: string;
  to: string;
  kind: "provides" | "needs" | "supports" | "context" | "rejected";
}

export interface OpportunityMap {
  nodes: MapNode[];
  edges: MapEdge[];
  /** The credible scenario the map is centred on (null: no credible opportunity; only rejected ideas are drawn). */
  lead: Scenario | null;
}

const MAX_REJECTED = 3;
const MAX_EVIDENCE = 2;

export function opportunityMap(d: Dossier): OpportunityMap {
  const nodes: MapNode[] = [
    { id: "own", kind: "company", side: "own", ref: d.ownName },
    { id: "target", kind: "company", side: "target", ref: d.targetName },
  ];
  const edges: MapEdge[] = [];
  const lead = d.scenarios[0] ?? d.novel[0] ?? null;
  if (lead) {
    nodes.push({ id: "scenario", kind: "scenario", side: "both", ref: lead.key, mechanism: lead.mechanism });
    for (const role of ["provider", "partner"] as const) {
      // One node per side, labelled with the mechanism's own wording (dossier.mechanisms.<m>.provider|partner).
      const c = lead.contributions[role];
      const company = c.side === "own" ? "own" : "target";
      const id = `c:${role}`;
      nodes.push({ id, kind: "contribution", side: company, ref: role, mechanism: lead.mechanism, traits: c.traits.slice(0, 3) });
      edges.push({ from: company, to: id, kind: role === "provider" ? "provides" : "needs" });
      edges.push({ from: id, to: "scenario", kind: role === "provider" ? "provides" : "needs" });
    }
    for (const key of [...lead.shared.industries, ...lead.shared.technologies].slice(0, 3)) {
      const id = `s:${key}`;
      nodes.push({ id, kind: "shared", side: "both", ref: key });
      edges.push({ from: id, to: "scenario", kind: "context" });
    }
    lead.whyNow.slice(0, MAX_EVIDENCE).forEach((w, i) => {
      const id = `e:${i}`;
      nodes.push({ id, kind: "evidence", side: w.side === "own" ? "own" : "target", ref: w.statement, sourceUrl: w.sourceUrl });
      edges.push({ from: id, to: "scenario", kind: "supports" });
    });
  }
  const rejected = [...d.considered.map((s) => ({ key: s.key, mechanism: s.mechanism, code: s.critic.find((f) => f.severity !== "minor")?.code ?? s.critic[0]?.code }))].filter((r): r is { key: string; mechanism: string; code: CriticCode } => Boolean(r.code));
  for (const r of rejected.slice(0, MAX_REJECTED)) {
    const id = `r:${r.key}`;
    nodes.push({ id, kind: "rejected", side: "both", ref: r.key, mechanism: r.mechanism, critic: r.code });
    edges.push({ from: "own", to: id, kind: "rejected" });
    edges.push({ from: "target", to: id, kind: "rejected" });
  }
  return { nodes, edges, lead };
}
