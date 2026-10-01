/**
 * Opportunity Intelligence (Phase 11): an explainable brief for one business
 * thesis — "what business could we realistically create with this company,
 * why, why now, what supports it, what is missing, what should we do next?"
 *
 * Deterministic and pure: no I/O, no model, no provider. It does not create a
 * second reasoning system. A thesis comes from an existing source, adapted here:
 *   search    — a Phase 3 relevance candidate (rules + critic, own vs target);
 *   graph     — a Phase 10 graph candidate (a connection worth investigating);
 *   canonical — a stored opportunity (read only; its workflow stage is never touched).
 * One shared assessment then adds relationship, timing and event context,
 * contradictions, unknowns, the critic and the next validation action.
 *
 * Dimensions stay separate, and only FIT decides support:
 *   FIT          — participant contributions backed by evidence or records.
 *   TIMING       — dated signals, dated plans, upcoming events. Never adds fit.
 *   RELATIONSHIP — Network stage, contacts, interactions, events. Never adds fit.
 * Graph topology is a path, not proof; a relationship, an event or a signal
 * never upgrades support. Statuses are never upgraded (inference stays
 * inference). No probability, score or revenue figure is ever produced.
 * Nothing here writes a record, changes a stage or contacts anyone.
 */
import type { OpportunityCandidate } from "@/lib/graph/opportunity/candidates";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { conceptLabel, conceptsIn, isGeneric } from "@/lib/intelligence/concepts";
import type { EvaluatedCandidate, Insight, ValidationKey } from "@/lib/intelligence/relevance";
import type { OwnCompanyContext, RelationshipType, TargetProfile } from "@/lib/intelligence/types";
import { candidateVars } from "@/lib/intelligence/wording";
import type { NetworkStage } from "@/lib/network/model";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** User-facing wording: an i18n key with variables, or text recorded elsewhere (shown verbatim, never rewritten). */
export type Text = { key: MessageKey; vars?: Record<string, string | number> } | { literal: string };

export const INTEL_SOURCES = ["search", "graph", "canonical"] as const;
export type IntelSource = (typeof INTEL_SOURCES)[number];

/** What the brief is. A graph or Search candidate is never presented as a qualified opportunity. */
export type IntelLabel = "connection_worth_investigating" | "search_hypothesis" | "search_opportunity" | "tracked_opportunity";

/** Explainable support states (no score). Derived only from fit evidence and contradictions. */
export const SUPPORT_STATES = ["supported", "partially_supported", "needs_validation", "insufficient_evidence", "contradicted"] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];
const SUPPORT_ORDER: SupportState[] = ["supported", "partially_supported", "needs_validation", "insufficient_evidence"];
const weaker = (a: SupportState, b: SupportState | null): SupportState => (b && SUPPORT_ORDER.indexOf(b) > SUPPORT_ORDER.indexOf(a) ? b : a);

/** Epistemic basis of a statement. "recorded": a workspace record with no evidence attached. */
export type Basis = "fact" | "inference" | "assumption" | "recorded" | "unknown";
const BASIS_RANK: Record<Basis, number> = { fact: 4, inference: 3, assumption: 2, recorded: 1, unknown: 0 };
const strongest = (xs: Basis[]): Basis => xs.reduce<Basis>((a, x) => (BASIS_RANK[x] > BASIS_RANK[a] ? x : a), "unknown");

/** Where a piece of evidence comes from. Not all evidence is equal. */
export type EvidenceOrigin = "official" | "third_party" | "workspace_profile" | "workspace_record" | "recorded_evidence";

/** Mechanism categories: the existing Search relationship types, plus a third company completing a recorded gap. */
export type MechanismKind = RelationshipType | "complement" | "reciprocal";

export interface EvidenceItem {
  id: string;
  company: string;
  text: Text;
  status: Basis;
  origin: EvidenceOrigin;
  /** The company describing itself (positioning), not independent proof. */
  selfDescribed: boolean;
  url: string | null;
}

export interface Contribution {
  text: Text;
  /** e.g. the profile field it was declared in. */
  qualifier?: Text;
  status: Basis;
}

export type ParticipantRole = "own" | "target" | "provider" | "seeker" | "participant" | "complement";

export interface Participant {
  companyId: string | null;
  name: string;
  isOwn: boolean;
  role: ParticipantRole;
  /** What this company would bring (capability, product, service, channel…). Empty: not established. */
  brings: Contribution[];
  /** What this company is recorded as looking for. */
  seeks: Contribution[];
  /** Strongest basis on this company's side; "unknown" when nothing supports it. */
  support: Basis;
}

export interface TimingItem {
  kind: "signal" | "stated_plan" | "upcoming_event" | "recorded";
  company: string;
  text: Text;
  day: string | null;
  status: Basis;
  ref: string | null;
}

/** Minimized PRIVATE relationship context. Counts, days, stage and names only — never contact channels, notes or bodies. */
export interface RelationshipInput {
  companyId: string;
  companyName: string;
  stage: NetworkStage | null;
  /** null: not known in this view (e.g. the graph view does not load contacts). */
  contacts: number | null;
  primaryContactName: string | null;
  interactions: number | null;
  lastInteractionOn: string | null;
  openFollowUps: number;
  events: { eventId: string; eventName: string; status: string; upcoming: boolean }[];
}

export interface SignalInput {
  id: string;
  companyId: string;
  companyName: string;
  headline: string;
  kind: string;
  publishedOn: string | null;
  epistemic: "fact" | "inference";
}

/** Context shared by every thesis about the same companies. */
export interface IntelContext {
  relationships: RelationshipInput[];
  /** Open (non-dismissed) public signals. */
  signals: SignalInput[];
}

export type RelationshipLevel = "not_in_network" | "in_network" | "contact_known" | "in_conversation" | "inactive";
export type Access = "direct" | "via_event" | "none" | "unknown";

export interface RelationshipSummary extends RelationshipInput {
  level: RelationshipLevel;
  access: Access;
}

export interface Dimensions {
  fit: "supported" | "partial" | "unverified" | "none";
  timing: "evidence" | "none";
  relationship: RelationshipLevel;
  access: Access;
  evidence: "independent" | "official" | "workspace" | "none";
}

export type ContradictionCode = "marked_not_relevant" | "relationship_dormant" | "outside_goals" | "possible_competitor" | "geography_mismatch" | "missing_capability" | "critic_rejected";
export interface Contradiction {
  code: ContradictionCode;
  /** blocking: the thesis is contradicted · weakening: caps support · access: affects acting on it, not fit. */
  severity: "blocking" | "weakening" | "access";
  text: Text;
}

/** How an unknown can be resolved: public research, asking the company, or completing the own profile. */
export type Resolve = "research" | "ask" | "profile";

export interface Unknown {
  code: string;
  origin: "contradiction" | "evidence" | "mechanism" | "timing";
  text: Text;
  question: Text;
  resolve: Resolve;
  /** The company that holds the answer, when it is one participant. */
  companyId: string | null;
  company: string | null;
}

export type ValidationAction =
  | { kind: "ask_contact"; contact: string; company: string; question: Text; unknown: string }
  | { kind: "follow_up_event"; event: string; company: string; question: Text; unknown: string }
  | { kind: "ask_company"; company: string; question: Text; unknown: string }
  | { kind: "identify_contact"; company: string; question: Text; unknown: string }
  | { kind: "research"; company: string | null; question: Text; unknown: string }
  | { kind: "update_profile"; question: Text; unknown: string }
  | { kind: "watch_timing"; company: string | null }
  | { kind: "decide" }
  | { kind: "none"; reason: "not_relevant" | "contradicted" };

export const CRITIC_CHECKS = ["mechanism", "own_contribution", "other_contribution", "demand", "value", "fit_specific", "contradictions", "critical_unknown", "timing", "relationship"] as const;
export type CriticCheckId = (typeof CRITIC_CHECKS)[number];
export interface CriticCheck {
  id: CriticCheckId;
  /** Timing and relationship are always "info": they can never rescue missing fit. */
  result: "pass" | "warn" | "fail" | "info";
  code: string;
}

export interface OpportunityIntelligence {
  /** Deterministic: source + source id. */
  id: string;
  source: IntelSource;
  label: IntelLabel;
  /** Canonical workflow stage, read only. Never derived from or overwritten by the support state. */
  workflowStage: string | null;
  mechanism: { kind: MechanismKind | null; concrete: boolean; rule: string | null };
  thesis: Text | null;
  /** How the mechanism works (an inference by ORQO, or recorded text). */
  why: Text | null;
  whyBasis: Basis;
  /** Value the mechanism could create. null: not supported — never invented. */
  value: Text | null;
  participants: Participant[];
  fitEvidence: EvidenceItem[];
  /** Canonical references behind the thesis (evidence items, sources, records). */
  references: string[];
  timing: TimingItem[];
  relationships: RelationshipSummary[];
  assumptions: Text[];
  contradictions: Contradiction[];
  /** Smallest ordered set of unknowns; the first is the critical one. */
  unknowns: Unknown[];
  nextAction: ValidationAction;
  critic: CriticCheck[];
  dimensions: Dimensions;
  support: SupportState;
}

/** What an adapter provides; the shared assessment completes it. */
export interface ThesisDraft {
  id: string;
  source: IntelSource;
  label: IntelLabel;
  workflowStage: string | null;
  mechanism: OpportunityIntelligence["mechanism"];
  thesis: Text | null;
  why: Text | null;
  whyBasis: Basis;
  value: Text | null;
  participants: Participant[];
  fitEvidence: EvidenceItem[];
  references: string[];
  timing: TimingItem[];
  /** Relationship context carried by the source (graph view). The shared context wins for the same company. */
  relationships: RelationshipInput[];
  assumptions: Text[];
  contradictions: Contradiction[];
  /** Mechanism unknowns, highest decision value first. */
  unknowns: Unknown[];
  /** False when the thesis rests only on generic concepts. */
  specific: boolean;
  /**
   * Whether some participant's NEED for the mechanism is established (a declared or evidenced "looking for").
   * false: every side shows what it has, nobody shows it wants this — at best partially supported.
   * null: not assessed by this source.
   */
  demandEstablished: boolean | null;
  /** Strongest state the source itself allows (e.g. the Search critic said "weak"). */
  cap: SupportState | null;
}

// ---------------------------------------------------------------------------
// Relationship context (minimized)
// ---------------------------------------------------------------------------

/** Builds minimized relationship context from Network memory. Only counts, days, stage and the primary contact's name survive. */
export function relationshipFrom(input: {
  company: { id: string; name: string; stage: NetworkStage | null };
  contacts: readonly { name: string; isPrimary: boolean; createdAt: string }[];
  interactions: readonly { occurredAt: string }[];
  followUps: readonly { status: string }[];
  events: readonly { event: { id: string; name: string; startsOn: string | null }; target: { status: string } }[];
  today: string;
}): RelationshipInput {
  const primary = input.contacts.find((c) => c.isPrimary) ?? [...input.contacts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
  const last = input.interactions.reduce<string | null>((a, i) => (!a || i.occurredAt > a ? i.occurredAt : a), null);
  return {
    companyId: input.company.id,
    companyName: input.company.name,
    stage: input.company.stage,
    contacts: input.contacts.length,
    primaryContactName: primary?.name ?? null,
    interactions: input.interactions.length,
    lastInteractionOn: last ? last.slice(0, 10) : null,
    openFollowUps: input.followUps.filter((f) => f.status === "open").length,
    events: input.events.map(({ event, target }) => ({ eventId: event.id, eventName: event.name, status: target.status, upcoming: Boolean(event.startsOn && event.startsOn >= input.today) })),
  };
}

function summarize(r: RelationshipInput): RelationshipSummary {
  const met = r.events.some((e) => e.status === "met");
  const level: RelationshipLevel =
    r.stage === "dormant" || r.stage === "not_relevant"
      ? "inactive"
      : (r.interactions ?? 0) > 0 || r.lastInteractionOn
        ? "in_conversation"
        : (r.contacts ?? 0) > 0
          ? "contact_known"
          : r.stage
            ? "in_network"
            : "not_in_network";
  const access: Access = (r.contacts ?? 0) > 0 || (r.interactions ?? 0) > 0 ? "direct" : met ? "via_event" : r.contacts === null && r.stage ? "unknown" : "none";
  return { ...r, level, access };
}

const LEVEL_RANK: Record<RelationshipLevel, number> = { in_conversation: 4, contact_known: 3, in_network: 2, inactive: 1, not_in_network: 0 };
const ACCESS_RANK: Record<Access, number> = { direct: 3, via_event: 2, unknown: 1, none: 0 };

// ---------------------------------------------------------------------------
// Shared assessment
// ---------------------------------------------------------------------------

const ASK_ORDER: Record<Unknown["origin"], number> = { contradiction: 0, evidence: 1, mechanism: 2, timing: 4 };

/** Completes a draft: context, contradictions, unknowns, support, dimensions, critic and next validation action. */
export function assess(draft: ThesisDraft, ctx: IntelContext): OpportunityIntelligence {
  const others = draft.participants.filter((p) => !p.isOwn);
  const own = draft.participants.find((p) => p.isOwn) ?? null;
  const ids = new Set(draft.participants.map((p) => p.companyId).filter((x): x is string => Boolean(x)));

  // Relationship: shared context wins; the draft's own context fills companies the shared context does not cover.
  const rels = new Map<string, RelationshipInput>();
  for (const r of draft.relationships) rels.set(r.companyId, r);
  for (const r of ctx.relationships) if (ids.has(r.companyId)) rels.set(r.companyId, r);
  const relationships = others.flatMap((p) => (p.companyId && rels.has(p.companyId) ? [summarize(rels.get(p.companyId)!)] : []));

  // Timing: source items, then open public signals and upcoming events about the participants. Never fit.
  const timing = [...draft.timing];
  const seen = new Set(timing.map((x) => x.ref).filter(Boolean));
  for (const s of ctx.signals) {
    if (!ids.has(s.companyId) || seen.has(`company_signals:${s.id}`)) continue;
    seen.add(`company_signals:${s.id}`);
    timing.push({ kind: "signal", company: s.companyName, text: { literal: s.headline }, day: s.publishedOn, status: s.epistemic, ref: `company_signals:${s.id}` });
  }
  for (const r of relationships) {
    for (const e of r.events.filter((x) => x.upcoming && x.status !== "skipped")) {
      timing.push({ kind: "upcoming_event", company: r.companyName, text: { key: "opportunityIntel.timing.upcomingEvent", vars: { event: e.eventName, company: r.companyName } }, day: null, status: "fact", ref: `events:${e.eventId}` });
    }
  }
  timing.sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || String(a.ref).localeCompare(String(b.ref)));

  // Contradictions recorded by people (Network stage).
  const contradictions = [...draft.contradictions];
  for (const r of relationships) {
    if (r.stage === "not_relevant") contradictions.unshift({ code: "marked_not_relevant", severity: "blocking", text: { key: "opportunityIntel.contradictions.marked_not_relevant", vars: { company: r.companyName } } });
    if (r.stage === "dormant") contradictions.push({ code: "relationship_dormant", severity: "access", text: { key: "opportunityIntel.contradictions.relationship_dormant", vars: { company: r.companyName } } });
  }

  // Unknowns: evidence gaps on each side, then the mechanism's own unknowns, then timing.
  const unknowns: Unknown[] = [...draft.unknowns];
  for (const p of draft.participants) {
    if (p.isOwn) {
      if (p.brings.length === 0 && p.seeks.length === 0) {
        unknowns.push({ code: "own_contribution", origin: "evidence", text: { key: "opportunityIntel.unknowns.own_contribution", vars: { company: p.name } }, question: { key: "opportunityIntel.questions.own_contribution", vars: { company: p.name } }, resolve: "profile", companyId: p.companyId, company: p.name });
      }
      continue;
    }
    if (p.role === "participant") continue; // already part of the tracked opportunity
    if (p.support === "unknown" || p.support === "recorded") {
      unknowns.push({ code: "side_no_evidence", origin: "evidence", text: { key: "opportunityIntel.unknowns.side_no_evidence", vars: { company: p.name } }, question: { key: "opportunityIntel.questions.side_no_evidence", vars: { company: p.name } }, resolve: "research", companyId: p.companyId, company: p.name });
    } else if (p.support !== "fact") {
      unknowns.push({ code: "side_not_fact", origin: "evidence", text: { key: "opportunityIntel.unknowns.side_not_fact", vars: { company: p.name } }, question: { key: "opportunityIntel.questions.side_not_fact", vars: { company: p.name } }, resolve: "research", companyId: p.companyId, company: p.name });
    }
  }
  const hasTiming = timing.length > 0;
  const focus = others.find((p) => p.role !== "participant") ?? others[0] ?? null;
  if (!hasTiming && focus) {
    unknowns.push({ code: "timing", origin: "timing", text: { key: "opportunityIntel.unknowns.timing", vars: { company: focus.name } }, question: { key: "opportunityIntel.questions.timing", vars: { company: focus.name } }, resolve: "ask", companyId: focus.companyId, company: focus.name });
  }
  // Stable: contradiction-derived first (they can kill the thesis), then missing evidence, then the mechanism order, timing last.
  const ordered = unknowns.map((u, i) => ({ u, i })).sort((a, b) => ASK_ORDER[a.u.origin] - ASK_ORDER[b.u.origin] || a.i - b.i).map((x) => x.u);

  // Support: fit only. Timing and relationship are not inputs.
  const sides = draft.participants.filter((p) => p.role !== "participant");
  const facts = sides.filter((p) => p.support === "fact").length;
  let fitState: SupportState = sides.length === 0 || sides.some((p) => p.support === "unknown") ? "insufficient_evidence" : facts === sides.length ? "supported" : facts > 0 ? "partially_supported" : "needs_validation";
  const fit: Dimensions["fit"] = fitState === "supported" ? "supported" : fitState === "partially_supported" ? "partial" : fitState === "needs_validation" ? "unverified" : "none";
  if (!draft.mechanism.concrete || !draft.specific) fitState = "insufficient_evidence";
  if (!draft.value) fitState = weaker(fitState, "needs_validation");
  // Capabilities on both sides are not enough: someone must be shown to need the mechanism.
  if (draft.demandEstablished === false) fitState = weaker(fitState, "partially_supported");
  fitState = weaker(fitState, draft.cap);
  if (contradictions.some((c) => c.severity === "weakening")) fitState = weaker(fitState, "needs_validation");
  const support: SupportState = contradictions.some((c) => c.severity === "blocking") ? "contradicted" : fitState;

  const best = relationships.reduce<RelationshipSummary | null>((a, r) => (!a || LEVEL_RANK[r.level] > LEVEL_RANK[a.level] ? r : a), null);
  const access = relationships.reduce<Access>((a, r) => (ACCESS_RANK[r.access] > ACCESS_RANK[a] ? r.access : a), relationships.length ? "none" : "unknown");
  const origins = new Set(draft.fitEvidence.map((e) => e.origin));
  const dimensions: Dimensions = {
    fit,
    timing: hasTiming ? "evidence" : "none",
    relationship: best?.level ?? "not_in_network",
    access,
    evidence: origins.has("third_party") ? "independent" : origins.has("official") || origins.has("recorded_evidence") ? "official" : origins.size > 0 ? "workspace" : "none",
  };

  const nextAction = chooseAction(support, contradictions, ordered, relationships, hasTiming, focus);

  // The critic, in order. It can reject; timing and relationship never pass or fail.
  const sideResult = (ps: Participant[]): CriticCheck["result"] => (ps.length === 0 ? "fail" : ps.some((p) => p.support === "unknown") ? "fail" : ps.every((p) => p.support === "fact") ? "pass" : "warn");
  const otherSides = others.filter((p) => p.role !== "participant");
  const critic: CriticCheck[] = [
    { id: "mechanism", result: draft.mechanism.concrete ? "pass" : "fail", code: draft.mechanism.concrete ? "concrete" : draft.mechanism.kind ? "contextual" : "none" },
    own ? { id: "own_contribution", result: sideResult([own]), code: own.support } : { id: "own_contribution", result: "info", code: "not_involved" },
    { id: "other_contribution", result: sideResult(otherSides), code: otherSides.length === 0 ? "none" : strongestCode(otherSides) },
    { id: "demand", result: draft.demandEstablished === null ? "info" : draft.demandEstablished ? "pass" : "warn", code: draft.demandEstablished === null ? "not_assessed" : draft.demandEstablished ? "established" : "unestablished" },
    { id: "value", result: draft.value ? "pass" : "fail", code: draft.value ? "stated" : "unsupported" },
    { id: "fit_specific", result: draft.specific && draft.mechanism.concrete ? "pass" : "fail", code: draft.specific ? (draft.mechanism.concrete ? "specific" : "contextual") : "generic" },
    {
      id: "contradictions",
      result: contradictions.some((c) => c.severity === "blocking") ? "fail" : contradictions.some((c) => c.severity === "weakening") ? "warn" : "pass",
      code: contradictions.some((c) => c.severity === "blocking") ? "blocking" : contradictions.some((c) => c.severity === "weakening") ? "weakening" : "none",
    },
    { id: "critical_unknown", result: ordered.some((u) => u.origin !== "timing") ? "warn" : "pass", code: ordered.find((u) => u.origin !== "timing")?.code ?? "none" },
    { id: "timing", result: "info", code: hasTiming ? "evidence" : "none" },
    { id: "relationship", result: "info", code: best?.level ?? "not_in_network" },
  ];

  return {
    id: draft.id,
    source: draft.source,
    label: draft.label,
    workflowStage: draft.workflowStage,
    mechanism: draft.mechanism,
    thesis: draft.thesis,
    why: draft.why,
    whyBasis: draft.whyBasis,
    value: draft.value,
    participants: draft.participants,
    fitEvidence: draft.fitEvidence,
    references: draft.references,
    timing,
    relationships,
    assumptions: draft.assumptions,
    contradictions,
    unknowns: ordered.slice(0, 5),
    nextAction,
    critic,
    dimensions,
    support,
  };
}

function strongestCode(ps: Participant[]): string {
  return ps.some((p) => p.support === "unknown") ? "unknown" : strongest(ps.map((p) => p.support)) === "fact" && ps.every((p) => p.support === "fact") ? "fact" : "unverified";
}

/**
 * The next action that reduces the most important uncertainty (opportunity-specific, not statistical):
 *  1. blocked by a person's decision → no action;
 *  2. the critical unknown, resolved where it can be: own profile, public research, or the company itself
 *     (the recorded contact, the event where they met, or finding who owns the decision);
 *  3. only timing missing → watch for a dated reason;
 *  4. nothing open → the team decides (ORQO never qualifies or creates anything).
 */
function chooseAction(support: SupportState, contradictions: Contradiction[], unknowns: Unknown[], relationships: RelationshipSummary[], hasTiming: boolean, focus: Participant | null): ValidationAction {
  if (contradictions.some((c) => c.code === "marked_not_relevant")) return { kind: "none", reason: "not_relevant" };
  if (support === "contradicted") return { kind: "none", reason: "contradicted" };
  const first = unknowns.find((u) => u.origin !== "timing");
  if (!first) return hasTiming ? { kind: "decide" } : { kind: "watch_timing", company: focus?.name ?? null };
  if (first.resolve === "profile") return { kind: "update_profile", question: first.question, unknown: first.code };
  const company = first.company ?? focus?.name ?? null;
  if (first.resolve === "research") return { kind: "research", company, question: first.question, unknown: first.code };
  const rel = relationships.find((r) => r.companyId === first.companyId) ?? relationships.find((r) => r.companyId === focus?.companyId) ?? null;
  const name = rel?.companyName ?? company ?? "";
  if (rel?.primaryContactName) return { kind: "ask_contact", contact: rel.primaryContactName, company: name, question: first.question, unknown: first.code };
  const met = rel?.events.find((e) => e.status === "met");
  if (met && rel && (rel.contacts ?? 0) === 0) return { kind: "follow_up_event", event: met.eventName, company: name, question: first.question, unknown: first.code };
  if (!rel || rel.contacts === null) return { kind: "ask_company", company: name, question: first.question, unknown: first.code };
  return { kind: "identify_contact", company: name, question: first.question, unknown: first.code };
}

// ---------------------------------------------------------------------------
// Adapter: Search (Phase 3 relevance candidate)
// ---------------------------------------------------------------------------

/** Unknowns behind each Search validation key that can be researched publicly; the rest need the company itself. */
const RESEARCHABLE: ReadonlySet<ValidationKey> = new Set(["production_model", "manufacturing_partners", "deployment_geography", "regional_plans", "channel_coverage"]);

export interface SearchAdapterInput {
  candidate: EvaluatedCandidate;
  profile: TargetProfile;
  own: OwnCompanyContext;
  ownCompany: { id: string | null; name: string };
  target: { id: string | null; name: string };
  insights: readonly Insight[];
  locale: Locale;
}

export function fromSearch({ candidate: c, profile, own, ownCompany, target, insights, locale }: SearchAdapterInput): ThesisDraft {
  const t = createTranslator(locale);
  const vars = candidateVars(c, target.name, ownCompany.name, locale);
  const claims = new Map(profile.claims.map((x) => [x.id, x]));
  const sources = new Map(profile.sources.map((s) => [s.key, s]));
  const support = c.targetClaimIds.map((id) => claims.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));

  const ownBrings = c.ownBrings.filter((f) => f.field !== "soughtCapabilities");
  const ownSeeks = c.ownBrings.filter((f) => f.field === "soughtCapabilities");
  const ownSide: Participant = {
    companyId: ownCompany.id,
    name: ownCompany.name,
    isOwn: true,
    role: "own",
    brings: ownBrings.map((f) => ({ text: { literal: f.value }, qualifier: { key: `company.fields.${f.field}` as MessageKey }, status: "fact" })),
    seeks: ownSeeks.map((f) => ({ text: { literal: f.value }, qualifier: { key: "company.fields.soughtCapabilities" }, status: "fact" })),
    // A statement in the workspace's own saved profile: a fact about what the workspace declares.
    support: c.ownBrings.length > 0 ? "fact" : "unknown",
  };
  const targetSide: Participant = {
    companyId: target.id,
    name: target.name,
    isOwn: false,
    role: "target",
    brings: support.slice(0, 4).map((x) => ({ text: { literal: x.statement }, status: x.epistemic === "unknown" ? "unknown" : x.epistemic })),
    seeks: [],
    support: strongest(support.map((x) => (x.epistemic === "unknown" ? "unknown" : x.epistemic))),
  };

  const fitEvidence: EvidenceItem[] = [
    ...support.slice(0, 6).map((x) => {
      const src = x.sourceKey ? sources.get(x.sourceKey) : undefined;
      return {
        id: x.id,
        company: target.name,
        text: { literal: x.statement },
        status: (x.epistemic === "unknown" ? "unknown" : x.epistemic) as Basis,
        origin: (src?.authority === "third_party" ? "third_party" : "official") as EvidenceOrigin,
        selfDescribed: x.selfDescribed,
        url: src?.url ?? null,
      };
    }),
    ...c.ownBrings.slice(0, 4).map((f, i) => ({ id: `own-${i}`, company: ownCompany.name, text: { literal: f.value }, status: "fact" as Basis, origin: "workspace_profile" as EvidenceOrigin, selfDescribed: false, url: null })),
  ];

  const timing: TimingItem[] = c.whyNowClaimIds.flatMap((id) => {
    const x = claims.get(id);
    return x ? [{ kind: "stated_plan" as const, company: target.name, text: { literal: x.statement }, day: x.sourceKey ? (sources.get(x.sourceKey)?.retrievedAt.slice(0, 10) ?? null) : null, status: (x.epistemic === "unknown" ? "unknown" : x.epistemic) as Basis, ref: `claim:${x.id}` }] : [];
  });

  // Contradictions grounded in the profile and the stored evidence only.
  const contradictions: Contradiction[] = [];
  const unknowns: Unknown[] = [];
  const goal = c.checks.find((k) => k.id === "goal_fit");
  if (goal?.code === "outside") contradictions.push({ code: "outside_goals", severity: "weakening", text: { key: "opportunityIntel.contradictions.outside_goals", vars: { relationship: t(`analysis.relationships.${c.relationship}`) } } });
  const competitor = insights.find((i) => i.code === "possible_competitor");
  if (competitor && (c.relationship === "supplier" || c.relationship === "channel" || c.relationship === "customer")) {
    const drivers = competitor.drivers.slice(0, 3).map((d) => conceptLabel(d, locale)).join(", ");
    contradictions.push({ code: "possible_competitor", severity: "weakening", text: { key: "opportunityIntel.contradictions.possible_competitor", vars: { target: target.name, drivers } } });
    unknowns.push({ code: "competes", origin: "contradiction", text: { key: "opportunityIntel.unknowns.competes", vars: { target: target.name, own: ownCompany.name } }, question: { key: "opportunityIntel.questions.competes", vars: { target: target.name, own: ownCompany.name, drivers } }, resolve: "research", companyId: target.id, company: target.name });
  }
  if (c.rule === "channel" || c.rule === "segment_customer") {
    const ownGeo = new Set(conceptsIn([...own.geographies], "geography"));
    const targetGeo = new Set(profile.claims.filter((x) => x.field === "geography" && x.epistemic === "fact").flatMap((x) => x.concepts));
    if (ownGeo.size > 0 && targetGeo.size > 0 && ![...ownGeo].some((g) => targetGeo.has(g))) {
      contradictions.push({ code: "geography_mismatch", severity: "weakening", text: { key: "opportunityIntel.contradictions.geography_mismatch", vars: { target: target.name, geos: own.geographies.slice(0, 3).join(", ") } } });
    }
  }

  if (c.narrative) {
    for (const [i, q] of c.narrative.questions.slice(0, 3).entries()) unknowns.push({ code: `model_question_${i}`, origin: "mechanism", text: { literal: q }, question: { literal: q }, resolve: "ask", companyId: target.id, company: target.name });
  } else {
    for (const k of c.validation) {
      unknowns.push({ code: k, origin: "mechanism", text: { key: `opportunityIntel.unknowns.${k}` as MessageKey, vars }, question: { key: `analysis.validation.${k}` as MessageKey, vars }, resolve: RESEARCHABLE.has(k) ? "research" : "ask", companyId: target.id, company: target.name });
    }
  }

  const specific = c.checks.find((k) => k.id === "specificity")?.result === "pass";
  // Demand comes from the Search engine itself (one definition): a declared "looking for" or a stated target need, never products alone.
  const demandEstablished = c.demand;
  const concrete = c.mechanism === "concrete" && c.checks.find((k) => k.id === "mechanism")?.result === "pass";
  const cap: SupportState | null = c.verdict === "reject" ? "insufficient_evidence" : c.verdict === "weak" ? "needs_validation" : c.confidence === "limited" ? "partially_supported" : null;
  // Rule value statements are templates tied to the mechanism; a model narrative's value is an assumption, so it is not stated as value.
  const value: Text | null = !c.narrative && c.rule && concrete ? { key: `opportunityIntel.value.${c.rule}` as MessageKey, vars } : null;

  return {
    id: `search:${profile.domain}:${c.id}`,
    source: "search",
    label: c.verdict === "pass" && c.aligned ? "search_opportunity" : "search_hypothesis",
    workflowStage: null,
    mechanism: { kind: c.relationship, concrete, rule: c.rule ?? "model" },
    thesis: c.narrative ? { literal: c.narrative.title } : c.rule ? { key: `analysis.rules.${c.rule}.title` as MessageKey, vars } : null,
    why: c.narrative ? { literal: c.narrative.mechanism } : c.rule ? { key: `analysis.rules.${c.rule}.why` as MessageKey, vars } : null,
    whyBasis: c.origin === "model" ? "assumption" : "inference",
    value,
    participants: [ownSide, targetSide],
    fitEvidence,
    references: support.map((x) => `claim:${x.id}`),
    timing,
    relationships: [],
    assumptions: c.narrative ? c.narrative.assumptions.map((a) => ({ literal: a })) : c.rule ? [{ key: `analysis.rules.${c.rule}.assumption` as MessageKey, vars }] : [],
    contradictions,
    unknowns,
    specific,
    demandEstablished,
    cap,
  };
}

// ---------------------------------------------------------------------------
// Adapter: Opportunity Graph candidate (Phase 10)
// ---------------------------------------------------------------------------

const GRAPH_MECHANISM_UNKNOWNS = new Set(["need_current", "offer_fit", "complement_fit", "partner_interest"]);

export function fromGraph(c: OpportunityCandidate, locale: Locale): ThesisDraft {
  const t = createTranslator(locale);
  const label = (x: OpportunityCandidate["concepts"][number]) => (x.vocabulary === "concept" ? conceptLabel(x.term, locale) : x.label);
  const concepts = c.concepts.map(label).join(", ");
  const names = (role: OpportunityCandidate["companies"][number]["role"]) =>
    c.companies
      .filter((x) => x.role === role)
      .map((x) => (x.isOwnCompany ? t("graph.candidates.you", { name: x.name }) : x.name))
      .join(", ");
  const vars = { provider: names("provider"), seeker: names("seeker"), complement: names("complement"), opportunity: c.opportunity?.title ?? "", concepts };
  const byName = new Map(c.companies.map((x) => [x.name, x]));

  const participants: Participant[] = c.companies.map((x) => {
    // A side's evidence status, or a workspace record without evidence. Own-profile statements are facts about the workspace.
    const status: Basis = x.epistemic ?? "recorded";
    const items: Contribution[] = c.concepts.map((k) => ({ text: { literal: label(k) }, status }));
    const role: ParticipantRole = x.role;
    return {
      companyId: x.id,
      name: x.name,
      isOwn: x.isOwnCompany,
      role,
      brings:
        role === "provider" || role === "complement"
          ? items
          : role === "participant"
            ? [{ text: { key: "opportunityIntel.participants.inOpportunity", vars: { opportunity: c.opportunity?.title ?? "" } }, status: "recorded" }]
            : [],
      seeks: role === "seeker" ? items : [],
      support: role === "participant" ? "recorded" : status,
    };
  });

  const fitEvidence: EvidenceItem[] = c.companies
    .filter((x) => x.role !== "participant")
    .map((x) => ({
      id: `${x.id}:${x.role}`,
      company: x.name,
      text: { key: `opportunityIntel.graphFit.${x.role === "seeker" ? "seeks" : "offers"}` as MessageKey, vars: { company: x.name, concepts } },
      status: x.epistemic ?? "recorded",
      origin: x.isOwnCompany ? "workspace_profile" : x.epistemic ? "recorded_evidence" : "workspace_record",
      selfDescribed: false,
      url: null,
    }));

  const unknowns: Unknown[] = c.unknowns
    .filter((u) => GRAPH_MECHANISM_UNKNOWNS.has(u.key))
    .filter((u) => !(u.company && byName.get(u.company)?.isOwnCompany)) // the workspace answers its own questions internally
    .map((u) => {
      const who = u.company ? byName.get(u.company) : undefined;
      const company = u.company ?? vars.complement;
      return {
        code: u.key,
        origin: "mechanism" as const,
        text: { key: `graph.candidates.unknown.${u.key}` as MessageKey, vars: { company } },
        question: { key: `opportunityIntel.questions.${u.key}` as MessageKey, vars: { ...vars, company } },
        resolve: "ask" as const,
        companyId: who?.id ?? null,
        company: who?.name ?? null,
      };
    });

  const relationships: RelationshipInput[] = c.context.relationship.flatMap((r) => {
    const who = byName.get(r.companyName);
    if (!who) return [];
    return [
      {
        companyId: who.id,
        companyName: r.companyName,
        stage: (r.stage as NetworkStage | null) ?? null,
        contacts: null,
        primaryContactName: null,
        interactions: null,
        lastInteractionOn: r.lastInteractionOn,
        openFollowUps: r.openFollowUps,
        events: c.context.events.filter((e) => e.companyName === r.companyName).map((e) => ({ eventId: e.eventId, eventName: e.eventName, status: e.status, upcoming: false })),
      },
    ];
  });

  return {
    id: `graph:${c.id}`,
    source: "graph",
    label: "connection_worth_investigating",
    workflowStage: null,
    mechanism: { kind: c.rule === "missing_piece" ? "complement" : "supplier", concrete: true, rule: c.rule },
    thesis: { key: `graph.candidates.why.${c.rule}`, vars },
    why: { key: `opportunityIntel.graphWhy.${c.rule}`, vars },
    whyBasis: "inference",
    value: { key: `opportunityIntel.value.${c.rule}`, vars },
    participants,
    fitEvidence,
    references: c.evidence,
    timing: c.context.timing.map((s) => ({ kind: "signal" as const, company: s.companyName, text: { literal: s.headline }, day: s.publishedOn, status: s.epistemic ?? "inference", ref: `company_signals:${s.signalId}` })),
    relationships,
    assumptions: [],
    contradictions: [],
    unknowns,
    // Shared closed-vocabulary terms. A generic evidence concept alone is too broad to be a mechanism.
    specific: c.concepts.some((k) => k.vocabulary === "tag" || !isGeneric(k.term)),
    // The seeker's need (or the opportunity's recorded gap) is the demand; its own status already governs support.
    demandEstablished: true,
    // A missing piece rests on an engine-inferred gap: at best partially supported.
    cap: c.rule === "missing_piece" ? "partially_supported" : null,
  };
}

// ---------------------------------------------------------------------------
// Adapter: canonical opportunity (read only)
// ---------------------------------------------------------------------------

/** A stored opportunity, column-minimized. Evidence carries only the disclosable claim — never the private detail. */
export interface CanonicalOpportunityRecord {
  id: string;
  title: string;
  stage: string;
  kind: "reciprocal" | "customer" | "multi";
  whyExists: string;
  whyNow: string;
  structure: string;
  evidence: { id: string; claim: string; visibility: string; epistemic: "fact" | "inference" | "assumption"; companyId: string; marketingLanguage: boolean }[];
  assumptions: string[];
  unknowns: string[];
  questions: string[];
  missingCapabilities: string[];
  criticVerdict: string | null;
  participants: { companyId: string; name: string; isOwn: boolean; role: string; contributions: string[] }[];
}

/** Evidence visibilities a workspace member may see in a brief. "agent-only" and "private" never appear. */
const SHOWN_VISIBILITY = new Set(["public", "network", "connection"]);

export function fromCanonical(o: CanonicalOpportunityRecord): ThesisDraft {
  const evidence = o.evidence.filter((e) => SHOWN_VISIBILITY.has(e.visibility));
  const names = new Map(o.participants.map((p) => [p.companyId, p.name]));
  const participants: Participant[] = o.participants.map((p) => {
    const own = evidence.filter((e) => e.companyId === p.companyId && !e.marketingLanguage);
    const status: Basis = own.length > 0 ? strongest(own.map((e) => e.epistemic)) : p.contributions.length > 0 ? "recorded" : "unknown";
    // Multi-company (A + B + C): every participant is a contributing side.
    const role: ParticipantRole = p.isOwn ? "own" : o.kind === "multi" ? "complement" : "target";
    return { companyId: p.companyId, name: p.name, isOwn: p.isOwn, role, brings: p.contributions.slice(0, 4).map((x) => ({ text: { literal: x }, status })), seeks: [], support: status };
  });
  const focus = o.participants.find((p) => !p.isOwn) ?? null;
  const contradictions: Contradiction[] = [];
  if (o.criticVerdict === "reject") contradictions.push({ code: "critic_rejected", severity: "weakening", text: { key: "opportunityIntel.contradictions.critic_rejected" } });
  if (o.missingCapabilities.length > 0) contradictions.push({ code: "missing_capability", severity: "weakening", text: { key: "opportunityIntel.contradictions.missing_capability", vars: { capabilities: o.missingCapabilities.slice(0, 4).join(", ") } } });
  return {
    id: `canonical:${o.id}`,
    source: "canonical",
    label: "tracked_opportunity",
    workflowStage: o.stage,
    mechanism: { kind: o.kind === "multi" ? "complement" : o.kind === "customer" ? "customer" : "reciprocal", concrete: o.structure.trim().length > 0 && o.participants.every((p) => p.contributions.length > 0), rule: null },
    thesis: { literal: o.title },
    why: o.whyExists ? { literal: o.whyExists } : null,
    whyBasis: "inference",
    value: o.structure ? { literal: o.structure } : null,
    participants,
    fitEvidence: evidence.slice(0, 8).map((e) => ({ id: e.id, company: names.get(e.companyId) ?? "", text: { literal: e.claim }, status: e.epistemic, origin: "workspace_record", selfDescribed: e.marketingLanguage, url: null })),
    references: [`opportunities:${o.id}`],
    timing: o.whyNow ? [{ kind: "recorded", company: focus?.name ?? "", text: { literal: o.whyNow }, day: null, status: "inference", ref: `opportunities:${o.id}` }] : [],
    relationships: [],
    assumptions: o.assumptions.slice(0, 4).map((a) => ({ literal: a })),
    contradictions,
    unknowns: o.unknowns.slice(0, 4).map((u, i) => ({ code: `recorded_${i}`, origin: "mechanism" as const, text: { literal: u }, question: { literal: o.questions[i] ?? u }, resolve: "ask" as const, companyId: focus?.companyId ?? null, company: focus?.name ?? null })),
    specific: true,
    demandEstablished: null,
    cap: o.criticVerdict === "weak" ? "needs_validation" : null,
  };
}

// ---------------------------------------------------------------------------
// One company: every thesis, plus a truthful weak/empty state
// ---------------------------------------------------------------------------

export type EmptyReason = "no_analysis" | "own_profile_missing" | "analysis_no_mechanism" | "no_graph_pattern";

export interface CompanyIntelligence {
  briefs: OpportunityIntelligence[];
  /** Why nothing (or nothing stronger) could be described. Empty when briefs exist. */
  reasons: EmptyReason[];
}

const SOURCE_ORDER: Record<IntelSource, number> = { canonical: 0, search: 1, graph: 2 };
const STATE_RANK: Record<SupportState, number> = { supported: 0, partially_supported: 1, needs_validation: 2, insufficient_evidence: 3, contradicted: 4 };

/**
 * Not a leaderboard: tracked opportunities first, then by support state, then by source and id.
 * Timing and relationship never reorder.
 */
export function compareIntelligence(a: OpportunityIntelligence, b: OpportunityIntelligence): number {
  const tracked = (x: OpportunityIntelligence) => (x.source === "canonical" ? 0 : 1);
  return tracked(a) - tracked(b) || STATE_RANK[a.support] - STATE_RANK[b.support] || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.id.localeCompare(b.id);
}

export const MAX_BRIEFS = 6;

export function companyIntelligence(input: {
  drafts: ThesisDraft[];
  context: IntelContext;
  hasAnalysis: boolean;
  analysisStatus: "opportunities" | "hypotheses_only" | "none" | "own_profile_missing" | null;
  hasGraphPattern: boolean;
}): CompanyIntelligence {
  const briefs = input.drafts.map((d) => assess(d, input.context)).sort(compareIntelligence).slice(0, MAX_BRIEFS);
  if (briefs.length > 0) return { briefs, reasons: [] };
  const reasons: EmptyReason[] = [];
  if (!input.hasAnalysis) reasons.push("no_analysis");
  else if (input.analysisStatus === "own_profile_missing") reasons.push("own_profile_missing");
  else reasons.push("analysis_no_mechanism");
  if (!input.hasGraphPattern) reasons.push("no_graph_pattern");
  return { briefs, reasons };
}

/** Short, non-ranking attention tags for a brief. */
export function attentionTags(b: OpportunityIntelligence): ("timing_signal" | "contradiction" | "direct_access" | "open_unknowns")[] {
  const out: ("timing_signal" | "contradiction" | "direct_access" | "open_unknowns")[] = [];
  if (b.dimensions.timing === "evidence") out.push("timing_signal");
  if (b.contradictions.some((c) => c.severity !== "access")) out.push("contradiction");
  if (b.dimensions.access === "direct") out.push("direct_access");
  if (b.unknowns.some((u) => u.origin !== "timing")) out.push("open_unknowns");
  return out;
}
