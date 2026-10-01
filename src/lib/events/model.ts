/**
 * Events (Phase 8) — the pure, deterministic part: vocabularies, the event
 * phase derived from calendar dates, the target lifecycle, an explainable
 * priority suggestion, event preparation and the post-event review.
 * Framework- and persistence-free; no provider or model calls.
 *
 * An event is a business-development context. Its companies, contacts,
 * interactions and follow-ups are the canonical Network records (Phase 6);
 * this module only reasons over them. Nothing here claims that a company
 * attends an event unless a person said so, and nothing proposes outreach.
 */
import { compareFollowUps, isIsoDay, latestInteraction, type ContactView, type FollowUpView, type InteractionView, type NetworkStage } from "@/lib/network/model";

export const EVENT_OBJECTIVES = ["customers", "technology_partners", "distributors", "existing_prospects", "market_exploration", "suppliers", "investors", "strategic_partners", "custom"] as const;
export type EventObjective = (typeof EVENT_OBJECTIVES)[number];

export const TARGET_STATUSES = ["planned", "targeted", "met", "missed", "skipped"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const TARGET_PRIORITIES = ["high", "medium", "low"] as const;
export type TargetPriority = (typeof TARGET_PRIORITIES)[number];

export const ATTENDANCE = ["unknown", "expected", "meeting_booked"] as const;
export type Attendance = (typeof ATTENDANCE)[number];

export const EVENT_PHASES = ["undated", "upcoming", "active", "past"] as const;
export type EventPhase = (typeof EVENT_PHASES)[number];

export interface EventView {
  id: string;
  name: string;
  description: string;
  /** Calendar days, YYYY-MM-DD; null when not set. */
  startsOn: string | null;
  endsOn: string | null;
  location: string;
  website: string | null;
  objectiveKind: EventObjective | null;
  objective: string;
  topics: string[];
  archivedAt: string | null;
  createdAt: string;
}

export interface EventTargetView {
  id: string;
  eventId: string;
  companyId: string;
  companyName: string;
  companyWebsite: string | null;
  companyStage: NetworkStage | null;
  status: TargetStatus;
  priority: TargetPriority;
  attendance: Attendance;
  /** PRIVATE: why the team wants to meet them. */
  why: string;
  /** PRIVATE: preparation notes. */
  prepNotes: string;
  reviewedAt: string | null;
  statusChangedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Phase (derived from dates — never maintained by hand)
// ---------------------------------------------------------------------------

/**
 * undated: no start day recorded · upcoming: before the first day · active:
 * between the first and last day (inclusive) · past: after the last day. A
 * missing end day means a one-day event. Days are compared as calendar days.
 */
export function eventPhase(e: Pick<EventView, "startsOn" | "endsOn">, today: string): EventPhase {
  if (!e.startsOn || !isIsoDay(e.startsOn)) return "undated";
  const end = e.endsOn && isIsoDay(e.endsOn) && e.endsOn >= e.startsOn ? e.endsOn : e.startsOn;
  if (today < e.startsOn) return "upcoming";
  if (today > end) return "past";
  return "active";
}

/** Valid event dates: a start day (optional), and an end day only together with a start day, never before it. */
export function validEventDates(startsOn: string | null, endsOn: string | null): boolean {
  if (startsOn !== null && !isIsoDay(startsOn)) return false;
  if (endsOn === null) return true;
  return startsOn !== null && isIsoDay(endsOn) && endsOn >= startsOn;
}

// ---------------------------------------------------------------------------
// Target lifecycle
// ---------------------------------------------------------------------------

/**
 * planned ⇄ targeted before the event; met / missed / skipped record what
 * actually happened. A missed or skipped target may still be met later, and
 * any state may be reset to "targeted" to correct a mistake. "met" is only
 * left by such an explicit reset: the recorded encounter stays in Network.
 */
export function canTransitionTarget(from: TargetStatus, to: TargetStatus): boolean {
  if (from === to) return false;
  if (to === "targeted") return true;
  switch (from) {
    case "planned":
    case "targeted":
      return true;
    case "missed":
    case "skipped":
      return to === "met" || to === "missed" || to === "skipped";
    case "met":
      return false;
  }
}

/** A target can be removed from an event only before anything happened with it at the event. */
export function canRemoveTarget(t: Pick<EventTargetView, "status">, eventInteractions: number): boolean {
  return (t.status === "planned" || t.status === "targeted") && eventInteractions === 0;
}

const PRIORITY_RANK: Record<TargetPriority, number> = { high: 0, medium: 1, low: 2 };
const STATUS_RANK: Record<TargetStatus, number> = { targeted: 0, planned: 1, met: 2, missed: 3, skipped: 4 };

export function compareTargets(a: EventTargetView, b: EventTargetView): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.companyName.localeCompare(b.companyName) || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Explainable priority suggestion (no score)
// ---------------------------------------------------------------------------

/** What ORQO already knows about a target company, from canonical records only. */
export interface TargetContext {
  stage: NetworkStage | null;
  /** Recorded opportunities (Phase 1 model) the company participates in. */
  opportunities: number;
  contacts: readonly ContactView[];
  interactions: readonly InteractionView[];
  followUps: readonly FollowUpView[];
  /** Open public signals and whether Intelligence assessed them relevant. */
  openSignals: readonly { headline: string; relevant: boolean }[];
  /** Validation questions of a stored public analysis, most important first (already phrased). */
  validationQuestions: readonly string[];
  hasPublicAnalysis: boolean;
}

export type PriorityFactor =
  | "active_opportunity"
  | "advanced_stage"
  | "relevant_signal"
  | "open_follow_up"
  | "existing_relationship"
  | "stated_reason"
  | "public_analysis"
  | "not_relevant"
  | "no_context";

const ACTIVE_STAGES: ReadonlySet<NetworkStage> = new Set(["contacted", "conversation", "qualified", "opportunity", "customer_partner"]);
const ADVANCED_STAGES: ReadonlySet<NetworkStage> = new Set(["qualified", "opportunity", "customer_partner"]);

/**
 * A SUGGESTION the person may follow or ignore — the recorded priority is
 * always theirs. Every factor is a recorded fact about the company:
 *  - high: an opportunity is recorded, the relationship is qualified or
 *    beyond, or an open public signal was assessed relevant;
 *  - low: the team marked the company not relevant;
 *  - medium otherwise.
 */
export function suggestPriority(ctx: TargetContext, why: string): { priority: TargetPriority; factors: PriorityFactor[] } {
  const factors: PriorityFactor[] = [];
  if (ctx.opportunities > 0) factors.push("active_opportunity");
  if (ctx.stage && ADVANCED_STAGES.has(ctx.stage)) factors.push("advanced_stage");
  if (ctx.openSignals.some((s) => s.relevant)) factors.push("relevant_signal");
  if (ctx.followUps.some((f) => f.status === "open")) factors.push("open_follow_up");
  if (ctx.stage && ACTIVE_STAGES.has(ctx.stage) && !ADVANCED_STAGES.has(ctx.stage)) factors.push("existing_relationship");
  if (why.trim()) factors.push("stated_reason");
  if (ctx.hasPublicAnalysis) factors.push("public_analysis");
  if (ctx.stage === "not_relevant") return { priority: "low", factors: ["not_relevant"] };
  if (factors.length === 0) return { priority: "medium", factors: ["no_context"] };
  const high = factors.some((f) => f === "active_opportunity" || f === "advanced_stage" || f === "relevant_signal");
  return { priority: high ? "high" : "medium", factors };
}

// ---------------------------------------------------------------------------
// Preparation (deterministic, from stored ORQO data)
// ---------------------------------------------------------------------------

export type PrepQuestion =
  | { kind: "identify_contact" }
  | { kind: "meet_contact"; name: string; role: string }
  | { kind: "validate"; question: string }
  | { kind: "signal"; headline: string }
  | { kind: "open_follow_up"; title: string }
  | { kind: "previous_next_step"; step: string };

export type PrepUnknown = "no_public_analysis" | "no_contact" | "attendance_unconfirmed" | "no_reason" | "no_history";

export interface Preparation {
  /** PRIVATE context recorded by the team. */
  why: string;
  stage: NetworkStage | null;
  contacts: ContactView[];
  latestInteraction: InteractionView | null;
  openFollowUp: FollowUpView | null;
  /** PUBLIC: open signals, as recorded. */
  signals: { headline: string; relevant: boolean }[];
  hasPublicAnalysis: boolean;
  questions: PrepQuestion[];
  unknowns: PrepUnknown[];
}

/**
 * What to know and ask before meeting a target. Every question is grounded in
 * a recorded fact: an unresolved question of the stored public analysis, a
 * recorded public signal, an open follow-up, a previous next step, or the
 * absence of a known contact. Nothing is invented about the company.
 */
export function prepareTarget(target: Pick<EventTargetView, "why" | "attendance">, ctx: TargetContext): Preparation {
  const latest = latestInteraction(ctx.interactions);
  const openFollowUp = ctx.followUps.filter((f) => f.status === "open").sort(compareFollowUps)[0] ?? null;
  const primary = ctx.contacts.find((c) => c.isPrimary) ?? ctx.contacts[0] ?? null;
  const questions: PrepQuestion[] = [];
  questions.push(primary ? { kind: "meet_contact", name: primary.name, role: primary.role } : { kind: "identify_contact" });
  if (openFollowUp) questions.push({ kind: "open_follow_up", title: openFollowUp.title });
  else if (latest?.nextStep.trim()) questions.push({ kind: "previous_next_step", step: latest.nextStep.trim() });
  for (const s of ctx.openSignals.slice(0, 2)) questions.push({ kind: "signal", headline: s.headline });
  for (const q of [...new Set(ctx.validationQuestions)].slice(0, 2)) questions.push({ kind: "validate", question: q });

  const unknowns: PrepUnknown[] = [];
  if (!ctx.hasPublicAnalysis) unknowns.push("no_public_analysis");
  if (ctx.contacts.length === 0) unknowns.push("no_contact");
  if (target.attendance === "unknown") unknowns.push("attendance_unconfirmed");
  if (!target.why.trim()) unknowns.push("no_reason");
  if (ctx.interactions.length === 0) unknowns.push("no_history");

  return {
    why: target.why,
    stage: ctx.stage,
    contacts: [...ctx.contacts],
    latestInteraction: latest,
    openFollowUp,
    signals: ctx.openSignals.slice(0, 3).map((s) => ({ ...s })),
    hasPublicAnalysis: ctx.hasPublicAnalysis,
    questions,
    unknowns,
  };
}

// ---------------------------------------------------------------------------
// Review (factual counts; no score, no claimed outcome)
// ---------------------------------------------------------------------------

export interface EventActivity {
  targets: readonly EventTargetView[];
  /** Canonical interactions recorded with this event as context. */
  interactions: readonly InteractionView[];
  /** Canonical contacts recorded at this event. */
  contactsAdded: number;
  /** Canonical follow-ups created with this event as context. */
  followUps: readonly FollowUpView[];
  /** Companies whose Network record was created through this event. */
  newCompanies: number;
}

export interface EventReview {
  targets: number;
  met: number;
  missed: number;
  skipped: number;
  /** Targets whose outcome nobody recorded (still planned / targeted). */
  notRecorded: number;
  companiesMet: number;
  newCompanies: number;
  contactsAdded: number;
  interactions: number;
  openFollowUps: number;
  completedFollowUps: number;
}

export function reviewCounts(a: EventActivity): EventReview {
  const by = (s: TargetStatus) => a.targets.filter((t) => t.status === s).length;
  return {
    targets: a.targets.length,
    met: by("met"),
    missed: by("missed"),
    skipped: by("skipped"),
    notRecorded: by("planned") + by("targeted"),
    companiesMet: new Set([...a.targets.filter((t) => t.status === "met").map((t) => t.companyId), ...a.interactions.map((i) => i.companyId)]).size,
    newCompanies: a.newCompanies,
    contactsAdded: a.contactsAdded,
    interactions: a.interactions.length,
    openFollowUps: a.followUps.filter((f) => f.status === "open").length,
    completedFollowUps: a.followUps.filter((f) => f.status === "done").length,
  };
}

export type ReviewReason = "missed_high_priority" | "missed" | "outcome_not_recorded" | "next_step_without_follow_up";

export interface ReviewItem {
  target: EventTargetView | null;
  companyId: string;
  reason: ReviewReason;
  /** For next_step_without_follow_up: the event interaction whose next step has no follow-up yet. */
  interaction: InteractionView | null;
}

/**
 * What still needs a human decision after (or during) an event. Missed targets
 * never disappear: they stay listed until a person creates a follow-up or
 * marks them reviewed. Nothing here creates a follow-up by itself.
 *  - a next step recorded at the event with no follow-up tracking it;
 *  - a missed target (high priority first) without an open event follow-up;
 *  - once the event is over: targets whose outcome was never recorded.
 */
export function reviewItems(a: EventActivity, phase: EventPhase): ReviewItem[] {
  const out: ReviewItem[] = [];
  const tracked = new Set(a.followUps.map((f) => f.interactionId).filter(Boolean));
  const openFollowUpCompanies = new Set(a.followUps.filter((f) => f.status === "open").map((f) => f.companyId));
  const targetOf = new Map(a.targets.map((t) => [t.companyId, t]));
  const seenStep = new Set<string>();
  for (const i of [...a.interactions].sort((x, y) => y.occurredAt.localeCompare(x.occurredAt))) {
    if (!i.nextStep.trim() || tracked.has(i.id) || seenStep.has(i.companyId)) continue;
    seenStep.add(i.companyId);
    out.push({ target: targetOf.get(i.companyId) ?? null, companyId: i.companyId, reason: "next_step_without_follow_up", interaction: i });
  }
  const pending = (t: EventTargetView) => !t.reviewedAt && !openFollowUpCompanies.has(t.companyId);
  for (const t of [...a.targets].sort(compareTargets)) {
    if (t.status === "missed" && pending(t)) out.push({ target: t, companyId: t.companyId, reason: t.priority === "high" ? "missed_high_priority" : "missed", interaction: null });
  }
  if (phase === "past") {
    for (const t of [...a.targets].sort(compareTargets)) if ((t.status === "planned" || t.status === "targeted") && pending(t)) out.push({ target: t, companyId: t.companyId, reason: "outcome_not_recorded", interaction: null });
  }
  const rank: Record<ReviewReason, number> = { missed_high_priority: 0, next_step_without_follow_up: 1, missed: 2, outcome_not_recorded: 3 };
  return out.sort((x, y) => rank[x.reason] - rank[y.reason]);
}

/** Missed targets stay visible after the event, whether or not they were reviewed. */
export function missedTargets(targets: readonly EventTargetView[]): EventTargetView[] {
  return targets.filter((t) => t.status === "missed").sort(compareTargets);
}

// ---------------------------------------------------------------------------
// Landing: what needs attention across events
// ---------------------------------------------------------------------------

export interface EventSummary {
  event: EventView;
  phase: EventPhase;
  targets: number;
  met: number;
  missedHigh: number;
  notRecorded: number;
  openFollowUps: number;
}

export type AttentionReason = "upcoming_without_targets" | "past_open_follow_ups" | "missed_high_priority" | "outcome_not_recorded";

/** Factual attention items for the Events landing page. */
export function eventAttention(items: readonly EventSummary[]): { summary: EventSummary; reason: AttentionReason }[] {
  const out: { summary: EventSummary; reason: AttentionReason }[] = [];
  for (const s of items) {
    if (s.event.archivedAt) continue;
    if ((s.phase === "upcoming" || s.phase === "active") && s.targets === 0) out.push({ summary: s, reason: "upcoming_without_targets" });
    if (s.missedHigh > 0) out.push({ summary: s, reason: "missed_high_priority" });
    if (s.phase === "past" && s.openFollowUps > 0) out.push({ summary: s, reason: "past_open_follow_ups" });
    if (s.phase === "past" && s.notRecorded > 0) out.push({ summary: s, reason: "outcome_not_recorded" });
  }
  return out;
}

/** Active first, then upcoming (soonest first), undated, then past (most recent first). */
export function groupEvents<T extends { event: EventView; phase: EventPhase }>(items: readonly T[]): Record<EventPhase, T[]> {
  const out: Record<EventPhase, T[]> = { active: [], upcoming: [], undated: [], past: [] };
  for (const s of items) out[s.phase].push(s);
  const start = (s: T) => s.event.startsOn ?? "";
  out.active.sort((a, b) => start(a).localeCompare(start(b)));
  out.upcoming.sort((a, b) => start(a).localeCompare(start(b)));
  out.undated.sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt));
  out.past.sort((a, b) => (b.event.endsOn ?? start(b)).localeCompare(a.event.endsOn ?? start(a)));
  return out;
}
