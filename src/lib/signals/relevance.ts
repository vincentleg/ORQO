/**
 * Why a PUBLIC signal may matter to THIS organization, and what a person may
 * want to re-evaluate (Phase 7). Deterministic and explainable: understandable
 * reasons and states, never a numeric "AI score".
 *
 * Three kinds of input stay distinct all the way to the UI:
 *  - the public signal (evidence: fact or inference);
 *  - the organization's own profile (what it offers, where, what it seeks);
 *  - PRIVATE relationship memory (stage, interactions, follow-ups, "why it
 *    matters"). Private memory only ever produces a reference to the private
 *    item ("your team recorded…"), never a public claim, a citation or a fact
 *    about the other company.
 *
 * Nothing here claims a company needs a supplier, wants a partner or outsources
 * anything: those stay explicit unknowns unless evidence states them.
 */
import { conceptsIn, foldText, matchConcepts } from "@/lib/intelligence/concepts";
import { BUILD_SERVICES } from "@/lib/intelligence/relevance";
import type { OwnCompanyContext } from "@/lib/intelligence/types";
import { compareFollowUps, type FollowUpView, type InteractionView, type NetworkStage } from "@/lib/network/model";
import { isOpenSignal, type SignalKind, type SignalView } from "./model";

export const RELEVANCE_STATES = ["relevant", "potentially_relevant", "needs_validation", "no_clear_link"] as const;
export type RelevanceState = (typeof RELEVANCE_STATES)[number];

export const RELEVANCE_DIMENSIONS = ["geography", "capability_fit", "partnership", "timing", "relationship", "private_context"] as const;
export type RelevanceDimension = (typeof RELEVANCE_DIMENSIONS)[number];

export type ReasonBasis = "fact" | "inference" | "private";

export interface RelevanceReason {
  dimension: RelevanceDimension;
  basis: ReasonBasis;
  /** Concept keys behind the reason (localized by the UI). */
  concepts: string[];
}

export const UNKNOWN_KEYS = ["need_unproven", "expansion_scope", "build_or_partner", "use_of_funds", "partner_room", "impact_unclear", "date_unknown", "change_timing", "own_profile_missing"] as const;
export type UnknownKey = (typeof UNKNOWN_KEYS)[number];

/** A private item the public change relates to. Referenced, never quoted as evidence. */
export interface PrivateMatch {
  kind: "interaction" | "follow_up" | "reason";
  id: string | null;
  title: string;
  at: string | null;
}

/** The private relationship memory of one company, as the server read it for this organization. */
export interface RelationshipMemory {
  stage: NetworkStage | null;
  reason: string;
  interactions: readonly InteractionView[];
  followUps: readonly FollowUpView[];
}

export interface SignalAssessment {
  state: RelevanceState;
  reasons: RelevanceReason[];
  unknowns: UnknownKey[];
  privateMatches: PrivateMatch[];
}

// ---------------------------------------------------------------------------
// Private context: does private memory mention the topic of the public change?
// ---------------------------------------------------------------------------

const TOPIC_TERMS: Record<SignalKind, string[]> = {
  geographic_expansion: ["expansion", "expand", "expanding", "international", "abroad", "export", "new market", "new markets", "new region", "implantation", "s'implanter", "etranger", "internationalisation", "nouveaux marches", "nouveau marche"],
  market_entry: ["new market", "new markets", "new vertical", "new sector", "nouveau marche", "nouveaux marches", "nouveau secteur", "diversification"],
  product_launch: ["launch", "new product", "prototype", "roadmap", "release", "lancement", "nouveau produit", "feuille de route"],
  offering_change: ["new product", "new offering", "roadmap", "prototype", "nouvelle offre", "nouveau produit", "feuille de route"],
  manufacturing: ["manufacturing", "production", "prototype", "volume", "industrialization", "industrialisation", "fabrication", "series", "serie", "scale up", "scale-up"],
  funding: ["funding", "fundraising", "raise", "investment", "investor", "budget", "levee", "financement", "investisseur"],
  hiring: ["hiring", "team", "recruit", "recrutement", "equipe", "headcount"],
  partnership: ["partner", "partnership", "alliance", "partenaire", "partenariat"],
  acquisition: ["acquisition", "acquire", "merger", "rachat", "fusion"],
  customer_win: ["customer", "contract", "tender", "deal", "client", "contrat", "appel d'offres"],
  certification: ["certification", "certified", "compliance", "iso", "conformite", "homologation", "qualification"],
  event: ["event", "trade show", "conference", "salon", "evenement"],
  other: [],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function topicMatcher(signal: Pick<SignalView, "kind" | "concepts">): (text: string) => boolean {
  const terms = TOPIC_TERMS[signal.kind].map((t) => escapeRe(foldText(t)));
  const re = terms.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${terms.join("|")})(?=$|[^\\p{L}\\p{N}])`, "u") : null;
  const concepts = new Set(signal.concepts);
  return (text: string) => {
    if (!text.trim()) return false;
    if (re?.test(foldText(text))) return true;
    return concepts.size > 0 && matchConcepts(text).some((k) => concepts.has(k));
  };
}

/**
 * Private items that mention the topic of a public change: interactions
 * (title, notes, outcome, next step), open follow-ups and the recorded "why it
 * matters". Returned as references (kind, id, title, date) for the internal
 * explanation only. Newest first, at most 3.
 */
export function privateContextMatches(signal: Pick<SignalView, "kind" | "concepts">, memory: RelationshipMemory): PrivateMatch[] {
  const hit = topicMatcher(signal);
  const out: PrivateMatch[] = [];
  for (const i of [...memory.interactions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    if (hit([i.title, i.summary, i.outcome, i.nextStep].join(" \n "))) out.push({ kind: "interaction", id: i.id, title: i.title, at: i.occurredAt });
  }
  for (const f of memory.followUps.filter((x) => x.status === "open").sort(compareFollowUps)) {
    if (hit(`${f.title} \n ${f.description}`)) out.push({ kind: "follow_up", id: f.id, title: f.title, at: f.dueOn });
  }
  if (hit(memory.reason)) out.push({ kind: "reason", id: null, title: "", at: null });
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Relevance
// ---------------------------------------------------------------------------

const ACTIVE_STAGES: ReadonlySet<NetworkStage> = new Set(["contacted", "conversation", "qualified", "opportunity", "customer_partner", "dormant"]);
/** Kinds that typically move priorities and timing (stated as an inference, never as a fact about the company). */
const TIMING_KINDS: ReadonlySet<SignalKind> = new Set(["geographic_expansion", "market_entry", "product_launch", "manufacturing", "funding", "acquisition", "customer_win", "certification"]);
/** Kinds where a build/integrate/deploy offering may become relevant — as a question to validate. */
const BUILD_KINDS: ReadonlySet<SignalKind> = new Set(["product_launch", "offering_change", "manufacturing", "geographic_expansion"]);
const BUSINESS: ReadonlySet<RelevanceDimension> = new Set(["geography", "capability_fit", "partnership"]);

function ownConcepts(own: OwnCompanyContext): { geo: Set<string>; other: Set<string> } {
  const geo = new Set(conceptsIn([...own.geographies, ...own.markets], "geography"));
  const other = new Set(conceptsIn([own.summary, ...own.offerings, ...own.customerSegments, ...own.markets, ...own.soughtCapabilities]).filter((k) => !geo.has(k)));
  return { geo, other };
}

function hasOwnProfile(own: OwnCompanyContext | null): own is OwnCompanyContext {
  return Boolean(own && (own.offerings.length > 0 || own.summary.trim() || own.geographies.length > 0 || own.markets.length > 0));
}

/**
 * Deterministic relevance of a public signal for this organization:
 *  - geography: the change concerns a geography the organization serves (both facts);
 *  - capability_fit: the change concerns something the organization offers or seeks,
 *    or a build/deploy-type change meets a build/integration offering (inference);
 *  - partnership: a partnership/acquisition/expansion meets declared partnership goals (inference);
 *  - timing: this kind of change often moves priorities (inference);
 *  - relationship: there is an active recorded relationship (private);
 *  - private_context: private memory mentions this topic (private).
 * States:
 *  - needs_validation: the evidence is limited (inference / snippet) or the own profile is missing;
 *  - relevant: a business link AND (a relationship / private context, or two business links);
 *  - potentially_relevant: one business link, or a relationship with a timing change;
 *  - no_clear_link: nothing connects it to this organization yet.
 */
export function assessSignal(signal: SignalView, own: OwnCompanyContext | null, memory: RelationshipMemory | null): SignalAssessment {
  const reasons: RelevanceReason[] = [];
  const profile = hasOwnProfile(own) ? own : null;
  if (profile) {
    const { geo, other } = ownConcepts(profile);
    const geoHits = signal.concepts.filter((k) => geo.has(k));
    if (geoHits.length) reasons.push({ dimension: "geography", basis: signal.epistemic, concepts: geoHits });
    const fitHits = signal.concepts.filter((k) => other.has(k));
    if (fitHits.length) reasons.push({ dimension: "capability_fit", basis: signal.epistemic, concepts: fitHits });
    else if (BUILD_KINDS.has(signal.kind)) {
      const build = [...other].filter((k) => BUILD_SERVICES.includes(k));
      if (build.length) reasons.push({ dimension: "capability_fit", basis: "inference", concepts: build.slice(0, 3) });
    }
    const goals = profile.partnershipGoals;
    if ((signal.kind === "partnership" || signal.kind === "acquisition") && goals.length > 0) reasons.push({ dimension: "partnership", basis: "inference", concepts: [] });
    else if ((signal.kind === "geographic_expansion" || signal.kind === "market_entry") && goals.some((g) => g === "market_entry" || g === "channel")) reasons.push({ dimension: "partnership", basis: "inference", concepts: [] });
  }
  if (TIMING_KINDS.has(signal.kind)) reasons.push({ dimension: "timing", basis: "inference", concepts: [] });
  const privateMatches = memory ? privateContextMatches(signal, memory) : [];
  const active = Boolean(memory?.stage && ACTIVE_STAGES.has(memory.stage));
  if (active) reasons.push({ dimension: "relationship", basis: "private", concepts: [] });
  if (privateMatches.length) reasons.push({ dimension: "private_context", basis: "private", concepts: [] });

  const business = reasons.filter((r) => BUSINESS.has(r.dimension)).length;
  const relational = active || privateMatches.length > 0;
  const timing = reasons.some((r) => r.dimension === "timing");
  let state: RelevanceState;
  if (business === 0 && !relational) state = profile ? "no_clear_link" : "needs_validation";
  else if (signal.evidenceQuality === "limited") state = "needs_validation";
  else if (business >= 1 && (relational || business >= 2)) state = "relevant";
  else if (business >= 1 || (relational && timing) || privateMatches.length > 0) state = "potentially_relevant";
  else state = "no_clear_link";

  return { state, reasons, unknowns: signalUnknowns(signal, profile !== null), privateMatches };
}

/** What stays unknown. "Need" is never established by a change alone. */
export function signalUnknowns(signal: Pick<SignalView, "kind" | "publishedOn" | "origin">, ownProfile = true): UnknownKey[] {
  const out: UnknownKey[] = ["need_unproven"];
  switch (signal.kind) {
    case "geographic_expansion":
    case "market_entry":
      out.push("expansion_scope");
      break;
    case "product_launch":
    case "offering_change":
    case "manufacturing":
      out.push("build_or_partner");
      break;
    case "funding":
      out.push("use_of_funds");
      break;
    case "partnership":
    case "acquisition":
      out.push("partner_room");
      break;
    default:
      out.push("impact_unclear");
  }
  if (!signal.publishedOn) out.push("date_unknown");
  // A difference between two readings of a website shows what ORQO newly saw, not when it changed.
  if (signal.origin === "research" && !signal.publishedOn) out.push("change_timing");
  if (!ownProfile) out.push("own_profile_missing");
  return out;
}

// ---------------------------------------------------------------------------
// Re-evaluation (a suggestion for a person; never an automatic action)
// ---------------------------------------------------------------------------

export type Reevaluation =
  /** Dismissed / acted on, or nothing connects it to the organization. */
  | { kind: "no_material_change"; why: "closed" | "no_clear_link" }
  /** Check the evidence or the fit before anything else. */
  | { kind: "review" }
  /** A recorded opportunity / qualified relationship: its assessment may need revisiting. */
  | { kind: "reevaluate_opportunity"; followUp: FollowUpView | null }
  /** The change touches a topic the team recorded privately: the relationship may deserve attention earlier. */
  | { kind: "revisit_relationship"; followUp: FollowUpView | null };

const OPPORTUNITY_STAGES: ReadonlySet<NetworkStage> = new Set(["qualified", "opportunity", "customer_partner"]);

/**
 * Deterministic re-evaluation seam. An existing open follow-up is never
 * replaced: when one exists, the suggestion is to review IT (e.g. its due
 * date), and the Phase 6 Next Best Action stays exactly as it was.
 */
export function reevaluate(signal: SignalView, a: SignalAssessment, memory: RelationshipMemory | null): Reevaluation {
  if (!isOpenSignal(signal)) return { kind: "no_material_change", why: "closed" };
  if (a.state === "no_clear_link") return { kind: "no_material_change", why: "no_clear_link" };
  if (a.state === "needs_validation") return { kind: "review" };
  const open = (memory?.followUps ?? []).filter((f) => f.status === "open").sort(compareFollowUps);
  const related = a.privateMatches.find((m) => m.kind === "follow_up");
  const followUp = (related && open.find((f) => f.id === related.id)) ?? open[0] ?? null;
  if (memory?.stage && OPPORTUNITY_STAGES.has(memory.stage)) return { kind: "reevaluate_opportunity", followUp };
  if (a.privateMatches.length > 0) return { kind: "revisit_relationship", followUp };
  return { kind: "review" };
}

/** Needs attention: open, new, and something to re-evaluate. Ordered by strength, then recency. */
export function needsAttention<T extends { signal: SignalView; assessment: SignalAssessment; reevaluation: Reevaluation }>(items: readonly T[]): T[] {
  const order: Record<RelevanceState, number> = { relevant: 0, potentially_relevant: 1, needs_validation: 2, no_clear_link: 3 };
  return items
    .filter((x) => x.signal.status === "new" && x.reevaluation.kind !== "no_material_change" && x.assessment.state !== "needs_validation")
    .sort((a, b) => order[a.assessment.state] - order[b.assessment.state] || b.signal.firstSeenAt.localeCompare(a.signal.firstSeenAt));
}

/** Future AI reasoning over a signal (Signals Agent) — the seam is declared, and it is never reached on the Free path. */
export interface SignalReasoner {
  explain(signal: SignalView, own: OwnCompanyContext | null): Promise<{ hypotheses: string[] }>;
}
