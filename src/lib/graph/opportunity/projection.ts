/**
 * Opportunity Graph projection (Phase 10).
 *
 * POSTGRESQL IS THE SOURCE OF TRUTH. This module turns a snapshot of one
 * organization's canonical records into a DERIVED, REBUILDABLE, DISPOSABLE
 * graph: nodes and edges keyed by organization id + canonical record id. It
 * never invents identities (no name/domain/email keys), never reads a model or
 * provider, and never stores private CRM text. Deleting every projected graph
 * loses nothing: running this function again over PostgreSQL rebuilds it.
 *
 * Pure and deterministic: the same snapshot always yields the same, sorted
 * nodes and edges, so a sync can MERGE on keys idempotently and a rebuild can
 * remove whatever the latest projection no longer contains.
 */
import { TAGS } from "@/lib/domain/taxonomy";
import { concept, conceptsIn, isGeneric } from "@/lib/intelligence/concepts";

/** Projection format marker, stored with every synced graph. Bump when nodes/edges change meaning. */
export const PROJECTION_VERSION = "orqo-graph/1";

export const NODE_KINDS = ["company", "capability", "need", "concept", "opportunity", "signal", "event"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Every edge has one meaning (labels and explanations: i18n `graph.edges.*`).
 * There is deliberately no generic CONNECTED_TO and no company↔company edge:
 * ORQO has no canonical company-to-company relationship record to project.
 */
export const EDGE_KINDS = [
  "HAS_CAPABILITY", // company → capability: the capability is recorded for the company
  "HAS_NEED", // company → need: the need is recorded for the company
  "TAGGED", // capability|need → concept: classified with a closed-vocabulary tag
  "OFFERS", // company → concept: stored evidence (or your own profile) says the company offers it
  "SEEKS", // company → concept: stored evidence (or your own profile) says the company looks for it
  "PARTICIPATES_IN", // company → opportunity: participant of a canonical opportunity
  "MISSING", // opportunity → concept: the opportunity records this capability as missing
  "ABOUT", // signal → company: a public change about the company (timing, never fit)
  "TARGETED_AT", // company → event: an event target that was not (yet) met
  "MET_AT", // company → event: the company was met at the event
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export type Epistemic = "fact" | "inference" | "assumption";

/** Where an edge comes from. Explains "why is this connection here?". */
export const EDGE_BASES = ["workspace_record", "evidence_store", "workspace_profile", "vocabulary", "opportunity_record", "public_signal", "event_plan"] as const;
export type EdgeBasis = (typeof EDGE_BASES)[number];

/** The canonical PostgreSQL table a node traces back to. Concepts come from ORQO's closed vocabularies, not from a table. */
export type CanonicalTable = "companies" | "company_capabilities" | "company_needs" | "vocabulary" | "opportunities" | "company_signals" | "events";

export type Scalar = string | number | boolean | null;
export type Attrs = Record<string, Scalar | string[]>;

export interface GraphNode {
  key: string;
  kind: NodeKind;
  organizationId: string;
  canonicalTable: CanonicalTable;
  canonicalId: string;
  label: string;
  attrs: Attrs;
}

export interface GraphEdge {
  key: string;
  kind: EdgeKind;
  organizationId: string;
  from: string;
  to: string;
  /** null: a recorded structural fact of the workspace (a plan, a classification), not an evidence claim. */
  epistemic: Epistemic | null;
  basis: EdgeBasis;
  /** Canonical references, "table:id". References only: no excerpts or private text. */
  provenance: string[];
  attrs: Attrs;
}

export interface GraphProjection {
  version: string;
  organizationId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The loader hit a row bound: the projection is a bounded subset of the workspace. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Canonical snapshot: exactly the columns the projection may use. The loader
// selects nothing else, so private fields cannot reach the graph by accident.
// ---------------------------------------------------------------------------

export interface EvidenceMark {
  sourceId: string;
  epistemic: Epistemic;
}

export interface CanonicalSnapshot {
  organizationId: string;
  truncated: boolean;
  companies: {
    id: string;
    name: string;
    domain: string | null;
    isOwnCompany: boolean;
    networkStage: string | null;
    /** Own company only: the profile lists the workspace itself declares. */
    offerings: string[];
    soughtCapabilities: string[];
  }[];
  capabilities: { id: string; companyId: string; label: string; tags: string[]; visibility: string; evidence: EvidenceMark[] }[];
  needs: { id: string; companyId: string; label: string; tags: string[]; intensity: string; visibility: string; evidence: EvidenceMark[] }[];
  intelligence: { id: string; domain: string; researchedAt: string }[];
  evidenceItems: { id: string; intelligenceId: string; sourceId: string | null; field: string; epistemic: Epistemic | "unknown"; concepts: string[]; selfDescribed: boolean }[];
  opportunities: { id: string; title: string; stage: string; kind: string; confidence: string | null; missingCapabilities: string[]; participants: { companyId: string; role: string }[] }[];
  signals: { id: string; companyId: string; kind: string; headline: string; status: string; epistemic: Epistemic; evidenceQuality: string; sourceAuthority: string; sourceId: string | null; publishedOn: string | null }[];
  events: { id: string; name: string; startsOn: string | null; endsOn: string | null; archived: boolean }[];
  eventTargets: { id: string; eventId: string; companyId: string; status: string; priority: string; attendance: string }[];
  /** Structural relationship activity only: dates and counts, never interaction text. */
  activity: { companyId: string; lastInteractionOn: string | null; openFollowUps: number }[];
}

/** Evidence-store fields that say what a company offers / looks for. Other fields (identity, industry…) are not fit claims. */
export const OFFER_FIELDS: readonly string[] = ["offering", "product", "technology"];
export const SEEK_FIELDS: readonly string[] = ["need"];

const MAX_PROVENANCE = 12;
const MAX_LABEL = 160;
const EPISTEMIC_RANK: Record<Epistemic, number> = { fact: 3, inference: 2, assumption: 1 };

export function nodeKey(organizationId: string, kind: NodeKind, canonicalId: string): string {
  return `${organizationId}/${kind}/${canonicalId}`;
}

export function edgeKey(kind: EdgeKind, from: string, to: string): string {
  return `${kind}|${from}|${to}`;
}

/** Concept ids carry their vocabulary: "tag:<TAGS key>" (capabilities/needs) or "concept:<CONCEPTS key>" (evidence store). */
export function tagConceptId(tag: string): string | null {
  return Object.hasOwn(TAGS, tag) ? `tag:${tag}` : null;
}

export function lexiconConceptId(key: string): string | null {
  return concept(key) && !isGeneric(key) ? `concept:${key}` : null;
}

/** Strongest status present, and how many of each. Never upgrades: an inference stays an inference. */
export function summarizeEpistemics(marks: readonly Epistemic[]): { best: Epistemic | null; facts: number; inferences: number; assumptions: number } {
  let best: Epistemic | null = null;
  for (const m of marks) if (!best || EPISTEMIC_RANK[m] > EPISTEMIC_RANK[best]) best = m;
  return {
    best,
    facts: marks.filter((m) => m === "fact").length,
    inferences: marks.filter((m) => m === "inference").length,
    assumptions: marks.filter((m) => m === "assumption").length,
  };
}

const clip = (s: string, n = MAX_LABEL): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const uniq = <T,>(xs: Iterable<T>): T[] => [...new Set(xs)];
const byKey = <T extends { key: string }>(a: T, b: T): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function buildProjection(s: CanonicalSnapshot): GraphProjection {
  const org = s.organizationId;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (kind: NodeKind, canonicalTable: CanonicalTable, canonicalId: string, label: string, attrs: Attrs): string => {
    const key = nodeKey(org, kind, canonicalId);
    if (!nodes.has(key)) nodes.set(key, { key, kind, organizationId: org, canonicalTable, canonicalId, label: clip(label), attrs });
    return key;
  };
  const addEdge = (kind: EdgeKind, from: string, to: string, e: { epistemic: Epistemic | null; basis: EdgeBasis; provenance: string[]; attrs?: Attrs }): void => {
    if (!nodes.has(from) || !nodes.has(to)) return;
    const key = edgeKey(kind, from, to);
    edges.set(key, { key, kind, organizationId: org, from, to, epistemic: e.epistemic, basis: e.basis, provenance: uniq(e.provenance).sort().slice(0, MAX_PROVENANCE), attrs: e.attrs ?? {} });
  };
  const conceptNode = (id: string): string => {
    const [vocabulary, k] = id.split(":") as ["tag" | "concept", string];
    const label = vocabulary === "tag" ? TAGS[k as keyof typeof TAGS] : (concept(k)?.en ?? k);
    return addNode("concept", "vocabulary", id, label, { vocabulary, term: k });
  };

  // Companies, with structural relationship context only (stage, last interaction day, open follow-up count).
  const activity = new Map(s.activity.map((a) => [a.companyId, a]));
  const companyKey = new Map<string, string>();
  for (const c of s.companies) {
    const a = activity.get(c.id);
    companyKey.set(
      c.id,
      addNode("company", "companies", c.id, c.name, {
        isOwnCompany: c.isOwnCompany,
        domain: c.domain,
        stage: c.isOwnCompany ? null : c.networkStage,
        lastInteractionOn: a?.lastInteractionOn ?? null,
        openFollowUps: a?.openFollowUps ?? 0,
      }),
    );
  }

  // Capabilities and needs: canonical rows, classified with the closed TAGS vocabulary.
  const facets = [...s.capabilities.map((x) => ({ ...x, facet: "capability" as const })), ...s.needs.map((x) => ({ ...x, facet: "need" as const }))];
  for (const f of facets) {
    const owner = companyKey.get(f.companyId);
    if (!owner) continue;
    const table = f.facet === "capability" ? "company_capabilities" : "company_needs";
    const tags = uniq(f.tags.filter((t) => tagConceptId(t))).sort();
    const key = addNode(f.facet, table, f.id, f.label, f.facet === "need" ? { tags, intensity: (f as { intensity: string }).intensity, visibility: f.visibility } : { tags, visibility: f.visibility });
    const ep = summarizeEpistemics(f.evidence.map((e) => e.epistemic));
    addEdge(f.facet === "capability" ? "HAS_CAPABILITY" : "HAS_NEED", owner, key, {
      epistemic: ep.best,
      basis: "workspace_record",
      provenance: [`${table}:${f.id}`, ...f.evidence.map((e) => `sources:${e.sourceId}`)],
      attrs: { facts: ep.facts, inferences: ep.inferences, assumptions: ep.assumptions },
    });
    for (const t of tags) addEdge("TAGGED", key, conceptNode(`tag:${t}`), { epistemic: null, basis: "vocabulary", provenance: [`${table}:${f.id}`] });
  }

  // Stored public analysis (Phase 3 evidence store), joined to companies by canonical website domain.
  const companiesByDomain = new Map<string, string[]>();
  for (const c of s.companies) if (c.domain) companiesByDomain.set(c.domain, [...(companiesByDomain.get(c.domain) ?? []), c.id]);
  const intelCompanies = new Map(s.intelligence.map((i) => [i.id, { companyIds: companiesByDomain.get(i.domain) ?? [], intelligenceId: i.id }]));
  const claims = new Map<string, { kind: "OFFERS" | "SEEKS"; from: string; to: string; marks: Epistemic[]; refs: string[]; selfDescribed: number }>();
  for (const e of s.evidenceItems) {
    // UNKNOWN is a gap, not an edge.
    if (e.epistemic === "unknown") continue;
    const kind = OFFER_FIELDS.includes(e.field) ? "OFFERS" : SEEK_FIELDS.includes(e.field) ? "SEEKS" : null;
    const intel = intelCompanies.get(e.intelligenceId);
    if (!kind || !intel) continue;
    for (const companyId of intel.companyIds) {
      for (const ck of e.concepts) {
        const id = lexiconConceptId(ck);
        if (!id) continue;
        const from = companyKey.get(companyId)!;
        const to = conceptNode(id);
        const k = edgeKey(kind, from, to);
        const claim = claims.get(k) ?? { kind, from, to, marks: [], refs: [`company_intelligence:${intel.intelligenceId}`], selfDescribed: 0 };
        claim.marks.push(e.epistemic);
        claim.refs.push(`evidence_items:${e.id}`, ...(e.sourceId ? [`sources:${e.sourceId}`] : []));
        if (e.selfDescribed) claim.selfDescribed += 1;
        claims.set(k, claim);
      }
    }
  }
  for (const c of claims.values()) {
    const ep = summarizeEpistemics(c.marks);
    addEdge(c.kind, c.from, c.to, { epistemic: ep.best, basis: "evidence_store", provenance: c.refs, attrs: { facts: ep.facts, inferences: ep.inferences, assumptions: ep.assumptions, selfDescribed: c.selfDescribed } });
  }

  // The workspace's own profile: what it states it offers and looks for (same lexicon as Phase 3 relevance).
  for (const c of s.companies.filter((x) => x.isOwnCompany)) {
    const from = companyKey.get(c.id)!;
    for (const [kind, texts] of [["OFFERS", c.offerings], ["SEEKS", c.soughtCapabilities]] as const) {
      for (const ck of conceptsIn(texts)) {
        const id = lexiconConceptId(ck);
        if (!id || edges.has(edgeKey(kind, from, nodeKey(org, "concept", id)))) continue;
        addEdge(kind, from, conceptNode(id), { epistemic: "fact", basis: "workspace_profile", provenance: [`companies:${c.id}`] });
      }
    }
  }

  // Canonical opportunities: participants and recorded missing capabilities. Never created here.
  for (const o of s.opportunities) {
    const key = addNode("opportunity", "opportunities", o.id, o.title, { stage: o.stage, kind: o.kind, confidence: o.confidence });
    for (const p of o.participants) {
      const c = companyKey.get(p.companyId);
      if (c) addEdge("PARTICIPATES_IN", c, key, { epistemic: null, basis: "opportunity_record", provenance: [`opportunities:${o.id}`], attrs: { role: p.role } });
    }
    for (const t of uniq(o.missingCapabilities).sort()) {
      const id = tagConceptId(t);
      // The engine derived the gap: an inference to validate, not a fact.
      if (id) addEdge("MISSING", key, conceptNode(id), { epistemic: "inference", basis: "opportunity_record", provenance: [`opportunities:${o.id}`] });
    }
  }

  // Public signals: WHY NOW context about one company. Linked to the company only, never to a concept, so a signal cannot create fit.
  for (const sig of s.signals) {
    const c = companyKey.get(sig.companyId);
    if (!c || sig.status === "dismissed") continue;
    const key = addNode("signal", "company_signals", sig.id, sig.headline, {
      kind: sig.kind,
      status: sig.status,
      evidenceQuality: sig.evidenceQuality,
      sourceAuthority: sig.sourceAuthority,
      publishedOn: sig.publishedOn,
    });
    addEdge("ABOUT", key, c, { epistemic: sig.epistemic, basis: "public_signal", provenance: [`company_signals:${sig.id}`, ...(sig.sourceId ? [`sources:${sig.sourceId}`] : [])] });
  }

  // Events: targets and meetings as the team recorded them. Private "why" and preparation notes are never loaded.
  const eventKey = new Map<string, string>();
  for (const ev of s.events) eventKey.set(ev.id, addNode("event", "events", ev.id, ev.name, { startsOn: ev.startsOn, endsOn: ev.endsOn, archived: ev.archived }));
  for (const t of s.eventTargets) {
    const c = companyKey.get(t.companyId);
    const ev = eventKey.get(t.eventId);
    if (!c || !ev) continue;
    addEdge(t.status === "met" ? "MET_AT" : "TARGETED_AT", c, ev, { epistemic: null, basis: "event_plan", provenance: [`event_companies:${t.id}`], attrs: { status: t.status, priority: t.priority, attendance: t.attendance } });
  }

  return { version: PROJECTION_VERSION, organizationId: org, nodes: [...nodes.values()].sort(byKey), edges: [...edges.values()].sort(byKey), truncated: s.truncated };
}
