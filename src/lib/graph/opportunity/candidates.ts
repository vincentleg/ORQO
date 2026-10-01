/**
 * Opportunity candidates (Phase 10): GRAPH PATTERNS WORTH INVESTIGATING.
 *
 * A candidate is not an opportunity. A path in the graph proves only that
 * stored records point at the same closed-vocabulary concept; it says nothing
 * about intent, timing, terms or willingness to partner. So a candidate always
 * carries what is still unknown and a question to validate it, and nothing
 * here writes an opportunity, changes a stage or contacts anyone.
 *
 * Deterministic rules over structured data only (no model, no fuzzy text):
 *   capability_need — company A offers concept X (a capability tagged X, or
 *     stored evidence), company B needs X (a need tagged X, or stored evidence).
 *   missing_piece   — a canonical opportunity records capability X as missing,
 *     and company C (not a participant) has a capability tagged X (A + B + C).
 *
 * Three dimensions stay separate:
 *   FIT          — the capability/need evidence above. Only fit decides support.
 *   TIMING       — public signals (WHY NOW). Shown as context; never adds fit.
 *   RELATIONSHIP — Network stage, last interaction, events. Only breaks ties
 *                  in ordering; never adds fit.
 */
import type { Epistemic, GraphEdge, GraphNode, GraphProjection } from "./projection";

export const CANDIDATE_RULES = ["capability_need", "missing_piece"] as const;
export type CandidateRule = (typeof CANDIDATE_RULES)[number];

/** Explainable support categories (no scores, no probabilities). */
export const SUPPORT_LEVELS = ["supported", "partial", "needs_validation"] as const;
export type Support = (typeof SUPPORT_LEVELS)[number];

export const UNKNOWN_KEYS = ["need_current", "offer_fit", "complement_fit", "partner_interest", "side_not_fact", "side_no_evidence", "no_relationship"] as const;
export type UnknownKey = (typeof UNKNOWN_KEYS)[number];

export const CANDIDATE_LIMIT = 20;

export interface CandidateCompany {
  key: string;
  id: string;
  name: string;
  isOwnCompany: boolean;
  role: "provider" | "seeker" | "participant" | "complement";
  /** Strongest evidence status on this company's side of the pattern (null: none attached). */
  epistemic: Epistemic | null;
}

export interface CandidateConcept {
  key: string;
  vocabulary: "tag" | "concept";
  term: string;
  label: string;
}

export interface OpportunityCandidate {
  /** Deterministic: rule + canonical ids. */
  id: string;
  rule: CandidateRule;
  support: Support;
  companies: CandidateCompany[];
  concepts: CandidateConcept[];
  opportunity: { id: string; title: string } | null;
  /** The graph pattern: node and edge keys, for highlighting and explanation. */
  path: { nodes: string[]; edges: string[] };
  /** Canonical references behind the fit edges (evidence items, sources, records). */
  evidence: string[];
  unknowns: { key: UnknownKey; company?: string }[];
  context: {
    timing: { signalId: string; companyName: string; headline: string; kind: string; publishedOn: string | null; epistemic: Epistemic | null }[];
    relationship: { companyName: string; stage: string | null; lastInteractionOn: string | null; openFollowUps: number }[];
    events: { eventId: string; eventName: string; companyName: string; status: string }[];
  };
}

const RANK: Record<Epistemic, number> = { fact: 3, inference: 2, assumption: 1 };
const best = (xs: (Epistemic | null)[]): Epistemic | null => xs.reduce<Epistemic | null>((a, x) => (x && (!a || RANK[x] > RANK[a]) ? x : a), null);
const SUPPORT_RANK: Record<Support, number> = { supported: 0, partial: 1, needs_validation: 2 };
const OPEN_SIGNAL = new Set(["new", "reviewed"]);

interface Side {
  company: GraphNode;
  edges: GraphEdge[];
  nodes: string[];
  epistemic: Epistemic | null;
  noEvidence: boolean;
}

/** Index of a projection for the rules below. */
function index(p: Pick<GraphProjection, "nodes" | "edges">) {
  const node = new Map(p.nodes.map((n) => [n.key, n]));
  const out = new Map<string, GraphEdge[]>();
  const into = new Map<string, GraphEdge[]>();
  for (const e of p.edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    into.set(e.to, [...(into.get(e.to) ?? []), e]);
  }
  return { node, out: (k: string) => out.get(k) ?? [], into: (k: string) => into.get(k) ?? [] };
}
type Index = ReturnType<typeof index>;

/** Companies that offer (provider) or need (seeker) a concept, with the edges that say so. */
function sidesFor(ix: Index, conceptKey: string, dir: "provider" | "seeker"): Map<string, Side> {
  const [facetEdge, facetKind, claimEdge] = dir === "provider" ? (["HAS_CAPABILITY", "capability", "OFFERS"] as const) : (["HAS_NEED", "need", "SEEKS"] as const);
  const sides = new Map<string, Side>();
  const add = (companyKey: string, edges: GraphEdge[], nodes: string[], ep: Epistemic | null, noEvidence: boolean) => {
    const company = ix.node.get(companyKey);
    if (!company || company.kind !== "company") return;
    const s = sides.get(companyKey) ?? { company, edges: [], nodes: [], epistemic: null, noEvidence: true };
    s.edges.push(...edges);
    s.nodes.push(...nodes);
    s.epistemic = best([s.epistemic, ep]);
    s.noEvidence = s.noEvidence && noEvidence;
    sides.set(companyKey, s);
  };
  for (const e of ix.into(conceptKey)) {
    if (e.kind === claimEdge) add(e.from, [e], [], e.epistemic, false);
    if (e.kind === "TAGGED" && ix.node.get(e.from)?.kind === facetKind) {
      for (const owner of ix.into(e.from).filter((x) => x.kind === facetEdge)) add(owner.from, [owner, e], [e.from], owner.epistemic, owner.epistemic === null);
    }
  }
  return sides;
}

function supportOf(eps: (Epistemic | null)[]): Support {
  const facts = eps.filter((x) => x === "fact").length;
  return facts === eps.length ? "supported" : facts > 0 ? "partial" : "needs_validation";
}

const evidenceRefs = (edges: GraphEdge[]): string[] => [...new Set(edges.flatMap((e) => e.provenance))].sort();

function conceptOf(n: GraphNode): CandidateConcept {
  return { key: n.key, vocabulary: n.attrs.vocabulary === "tag" ? "tag" : "concept", term: String(n.attrs.term ?? n.canonicalId), label: n.label };
}

function companyOf(s: Side, role: CandidateCompany["role"]): CandidateCompany {
  return { key: s.company.key, id: s.company.canonicalId, name: s.company.label, isOwnCompany: s.company.attrs.isOwnCompany === true, role, epistemic: s.epistemic };
}

function contextFor(ix: Index, companies: GraphNode[]): OpportunityCandidate["context"] {
  const timing: OpportunityCandidate["context"]["timing"] = [];
  const relationship: OpportunityCandidate["context"]["relationship"] = [];
  const events: OpportunityCandidate["context"]["events"] = [];
  for (const c of companies) {
    for (const e of ix.into(c.key).filter((x) => x.kind === "ABOUT")) {
      const s = ix.node.get(e.from);
      if (s && OPEN_SIGNAL.has(String(s.attrs.status))) {
        timing.push({ signalId: s.canonicalId, companyName: c.label, headline: s.label, kind: String(s.attrs.kind), publishedOn: (s.attrs.publishedOn as string | null) ?? null, epistemic: e.epistemic });
      }
    }
    if (c.attrs.isOwnCompany !== true) {
      relationship.push({ companyName: c.label, stage: (c.attrs.stage as string | null) ?? null, lastInteractionOn: (c.attrs.lastInteractionOn as string | null) ?? null, openFollowUps: Number(c.attrs.openFollowUps ?? 0) });
    }
    for (const e of ix.out(c.key).filter((x) => x.kind === "MET_AT" || x.kind === "TARGETED_AT")) {
      const ev = ix.node.get(e.to);
      if (ev) events.push({ eventId: ev.canonicalId, eventName: ev.label, companyName: c.label, status: String(e.attrs.status) });
    }
  }
  timing.sort((a, b) => (b.publishedOn ?? "").localeCompare(a.publishedOn ?? "") || a.signalId.localeCompare(b.signalId));
  return { timing: timing.slice(0, 3), relationship, events: events.slice(0, 4) };
}

function sideUnknowns(sides: Side[]): OpportunityCandidate["unknowns"] {
  const out: OpportunityCandidate["unknowns"] = [];
  for (const s of sides) {
    const own = s.company.attrs.isOwnCompany === true;
    if (s.noEvidence) {
      if (!own) out.push({ key: "side_no_evidence", company: s.company.label });
    } else if (s.epistemic !== "fact") out.push({ key: "side_not_fact", company: s.company.label });
    if (!own && !s.company.attrs.stage && !s.company.attrs.lastInteractionOn) out.push({ key: "no_relationship", company: s.company.label });
  }
  return out;
}

const excluded = (c: GraphNode): boolean => c.attrs.stage === "not_relevant";

export function findOpportunityCandidates(p: Pick<GraphProjection, "nodes" | "edges">, opts: { limit?: number; involving?: string } = {}): { candidates: OpportunityCandidate[]; total: number } {
  const ix = index(p);
  const limit = Math.max(0, Math.min(opts.limit ?? CANDIDATE_LIMIT, CANDIDATE_LIMIT));

  // Pairs already tracked together in a canonical opportunity are not resurfaced.
  const tracked = new Set<string>();
  const participants = new Map<string, Set<string>>();
  for (const e of p.edges.filter((x) => x.kind === "PARTICIPATES_IN")) participants.set(e.to, (participants.get(e.to) ?? new Set()).add(e.from));
  for (const cs of participants.values()) for (const a of cs) for (const b of cs) if (a !== b) tracked.add(`${a}|${b}`);

  const out: OpportunityCandidate[] = [];
  const concepts = p.nodes.filter((n) => n.kind === "concept");

  // Rule 1 — capability_need, grouped per (provider, seeker) over all shared concepts.
  const pairs = new Map<string, { provider: Side; seeker: Side; concepts: GraphNode[] }>();
  for (const c of concepts) {
    const providers = sidesFor(ix, c.key, "provider");
    const seekers = sidesFor(ix, c.key, "seeker");
    for (const prov of providers.values()) {
      for (const seek of seekers.values()) {
        const a = prov.company;
        const b = seek.company;
        if (a.key === b.key || excluded(a) || excluded(b) || tracked.has(`${a.key}|${b.key}`)) continue;
        const k = `${a.key}|${b.key}`;
        const pair = pairs.get(k) ?? {
          provider: { company: a, edges: [], nodes: [], epistemic: null, noEvidence: true },
          seeker: { company: b, edges: [], nodes: [], epistemic: null, noEvidence: true },
          concepts: [],
        };
        for (const [into, from] of [
          [pair.provider, prov],
          [pair.seeker, seek],
        ] as const) {
          into.edges.push(...from.edges);
          into.nodes.push(...from.nodes);
          into.epistemic = best([into.epistemic, from.epistemic]);
          into.noEvidence = into.noEvidence && from.noEvidence;
        }
        pair.concepts.push(c);
        pairs.set(k, pair);
      }
    }
  }
  for (const { provider, seeker, concepts: cs } of pairs.values()) {
    const edges = [...provider.edges, ...seeker.edges];
    out.push({
      id: `capability_need:${provider.company.canonicalId}:${seeker.company.canonicalId}`,
      rule: "capability_need",
      support: supportOf([provider.epistemic, seeker.epistemic]),
      companies: [companyOf(provider, "provider"), companyOf(seeker, "seeker")],
      concepts: cs.map(conceptOf),
      opportunity: null,
      path: { nodes: [...new Set([provider.company.key, ...provider.nodes, ...cs.map((c) => c.key), ...seeker.nodes, seeker.company.key])], edges: [...new Set(edges.map((e) => e.key))].sort() },
      evidence: evidenceRefs(edges),
      unknowns: [{ key: "need_current", company: seeker.company.label }, { key: "offer_fit", company: provider.company.label }, ...sideUnknowns([provider, seeker])],
      context: contextFor(ix, [provider.company, seeker.company]),
    });
  }

  // Rule 2 — missing_piece (A + B + C): a canonical opportunity's recorded gap, and a non-participant with a capability tagged with it.
  for (const opp of p.nodes.filter((n) => n.kind === "opportunity")) {
    const inside = participants.get(opp.key) ?? new Set<string>();
    const gaps = ix.out(opp.key).filter((e) => e.kind === "MISSING");
    const byCompany = new Map<string, { side: Side; gaps: GraphEdge[]; concepts: GraphNode[] }>();
    for (const gap of gaps) {
      const c = ix.node.get(gap.to);
      if (!c) continue;
      for (const s of sidesFor(ix, c.key, "provider").values()) {
        // Only a recorded capability can fill a recorded gap (OFFERS claims use a different vocabulary).
        if (inside.has(s.company.key) || excluded(s.company) || !s.edges.some((e) => e.kind === "HAS_CAPABILITY")) continue;
        const entry = byCompany.get(s.company.key) ?? { side: { company: s.company, edges: [], nodes: [], epistemic: null, noEvidence: true }, gaps: [], concepts: [] };
        entry.side.edges.push(...s.edges);
        entry.side.nodes.push(...s.nodes);
        entry.side.epistemic = best([entry.side.epistemic, s.epistemic]);
        entry.side.noEvidence = entry.side.noEvidence && s.noEvidence;
        entry.gaps.push(gap);
        entry.concepts.push(c);
        byCompany.set(s.company.key, entry);
      }
    }
    const members = [...inside].map((k) => ix.node.get(k)).filter((n): n is GraphNode => Boolean(n));
    for (const { side, gaps: gs, concepts: cs } of byCompany.values()) {
      const memberEdges = p.edges.filter((e) => e.kind === "PARTICIPATES_IN" && e.to === opp.key);
      const edges = [...memberEdges, ...gs, ...side.edges];
      out.push({
        id: `missing_piece:${opp.canonicalId}:${side.company.canonicalId}`,
        rule: "missing_piece",
        // The gap itself is an engine inference, so the pattern is at best partial.
        support: supportOf([side.epistemic, "inference"]),
        companies: [
          ...members.map((m) => ({ key: m.key, id: m.canonicalId, name: m.label, isOwnCompany: m.attrs.isOwnCompany === true, role: "participant" as const, epistemic: null })),
          companyOf(side, "complement"),
        ],
        concepts: cs.map(conceptOf),
        opportunity: { id: opp.canonicalId, title: opp.label },
        path: { nodes: [...new Set([...members.map((m) => m.key), opp.key, ...cs.map((c) => c.key), ...side.nodes, side.company.key])], edges: [...new Set(edges.map((e) => e.key))].sort() },
        evidence: evidenceRefs(edges),
        unknowns: [{ key: "complement_fit", company: side.company.label }, { key: "partner_interest" }, ...sideUnknowns([side])],
        context: contextFor(ix, [...members, side.company]),
      });
    }
  }

  // Order: fit support, then breadth of fit, then an existing relationship (tie-break only), then id. Signals never reorder.
  const known = (c: OpportunityCandidate) => c.context.relationship.filter((r) => r.stage || r.lastInteractionOn).length;
  out.sort((a, b) => SUPPORT_RANK[a.support] - SUPPORT_RANK[b.support] || b.concepts.length - a.concepts.length || known(b) - known(a) || a.id.localeCompare(b.id));
  const scoped = opts.involving ? out.filter((c) => c.companies.some((x) => x.id === opts.involving)) : out;
  return { candidates: scoped.slice(0, limit), total: scoped.length };
}
