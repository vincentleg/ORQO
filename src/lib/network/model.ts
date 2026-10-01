/**
 * Network relationship memory (Phase 6) — the pure, deterministic part:
 * vocabularies, follow-up date buckets, the Next Best Action rules and the
 * relationship timeline. Framework- and persistence-free; no model calls.
 *
 * Everything here works from state a person recorded (stage, contacts,
 * interactions, follow-ups) plus, optionally, the validation question of a
 * stored public analysis. Nothing is inferred as private fact, and no
 * outreach is proposed merely because a company exists.
 */

export const NETWORK_STAGES = ["watching", "identified", "contacted", "conversation", "qualified", "opportunity", "customer_partner", "dormant", "not_relevant"] as const;
export type NetworkStage = (typeof NETWORK_STAGES)[number];

export const NETWORK_ORIGINS = ["search", "discover", "event", "manual", "referral", "existing"] as const;
export type NetworkOrigin = (typeof NETWORK_ORIGINS)[number];

export const INTERACTION_KINDS = ["meeting", "call", "email", "message", "event", "note", "other"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const FOLLOW_UP_STATUSES = ["open", "done", "dismissed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_PRIORITIES = ["low", "normal", "high"] as const;
export type FollowUpPriority = (typeof FOLLOW_UP_PRIORITIES)[number];

export const FOLLOW_UP_ORIGINS = ["manual", "interaction", "next_action"] as const;
export type FollowUpOrigin = (typeof FOLLOW_UP_ORIGINS)[number];

export const NETWORK_EVENT_KINDS = ["stage_changed", "contact_added", "follow_up_created", "follow_up_done", "follow_up_dismissed", "follow_up_reopened"] as const;
export type NetworkEventKind = (typeof NETWORK_EVENT_KINDS)[number];

/** Provenance prefix Discover writes into companies.external_ref (Phase 5). */
export const DISCOVER_REF_PREFIX = "discover:";
/** Provenance prefix Search writes into companies.external_ref (Phase 6). */
export const SEARCH_REF_PREFIX = "search:";

export interface ContactView {
  id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  profileUrl: string | null;
  notes: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface InteractionView {
  id: string;
  companyId: string;
  contactId: string | null;
  kind: InteractionKind;
  occurredAt: string;
  title: string;
  summary: string;
  outcome: string;
  nextStep: string;
  createdAt: string;
}

export interface FollowUpView {
  id: string;
  companyId: string;
  contactId: string | null;
  interactionId: string | null;
  title: string;
  description: string;
  /** Calendar day, YYYY-MM-DD. */
  dueOn: string | null;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  origin: FollowUpOrigin;
  assignedTo: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface NetworkEventView {
  id: string;
  kind: NetworkEventKind;
  subjectId: string | null;
  from: NetworkStage | null;
  to: NetworkStage | null;
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------

/**
 * The recorded origin, or the one proven by stored provenance (a Discover or
 * Search external_ref). Otherwise null: "Not recorded", never guessed.
 */
export function effectiveOrigin(recorded: NetworkOrigin | null, externalRef: string | null): NetworkOrigin | null {
  if (recorded) return recorded;
  if (externalRef?.startsWith(DISCOVER_REF_PREFIX)) return "discover";
  if (externalRef?.startsWith(SEARCH_REF_PREFIX)) return "search";
  return null;
}

/** The Prospecting run a Discover-added company came from, if its provenance says so. */
export function discoverRunId(externalRef: string | null): string | null {
  if (!externalRef?.startsWith(DISCOVER_REF_PREFIX)) return null;
  const id = externalRef.slice(DISCOVER_REF_PREFIX.length).split(":")[0];
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Dates (calendar days as YYYY-MM-DD; deterministic, no locale)
// ---------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The calendar day of an instant in a time zone (default UTC). */
export function isoDay(at: Date, timeZone = "UTC"): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The submitted due date of a follow-up form: an empty field means "no due
 * date" (a legitimate state), never "today". Anything else is passed on as-is
 * and validated as a calendar day by the repository.
 */
export function normalizeDueOn(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return v === "" ? null : v;
}

// ---------------------------------------------------------------------------
// Follow-up buckets
// ---------------------------------------------------------------------------

export const FOLLOW_UP_BUCKETS = ["overdue", "today", "this_week", "later", "completed"] as const;
export type FollowUpBucket = (typeof FOLLOW_UP_BUCKETS)[number];

/**
 * overdue: due before today · today · this_week: due in the next 6 days ·
 * later: further out, or no due date · completed: done or dismissed.
 */
export function followUpBucket(f: Pick<FollowUpView, "status" | "dueOn">, today: string): FollowUpBucket {
  if (f.status !== "open") return "completed";
  if (!f.dueOn) return "later";
  if (f.dueOn < today) return "overdue";
  if (f.dueOn === today) return "today";
  if (f.dueOn <= addDays(today, 6)) return "this_week";
  return "later";
}

const PRIORITY_RANK: Record<FollowUpPriority, number> = { high: 0, normal: 1, low: 2 };

/** Open follow-ups first by due day (undated last), then priority, then creation. Closed ones: most recently closed first. */
export function compareFollowUps(a: FollowUpView, b: FollowUpView): number {
  if ((a.status === "open") !== (b.status === "open")) return a.status === "open" ? -1 : 1;
  if (a.status !== "open") return (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || a.id.localeCompare(b.id);
  if (a.dueOn !== b.dueOn) {
    if (!a.dueOn) return 1;
    if (!b.dueOn) return -1;
    return a.dueOn.localeCompare(b.dueOn);
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function groupFollowUps(items: readonly FollowUpView[], today: string): Record<FollowUpBucket, FollowUpView[]> {
  const out = Object.fromEntries(FOLLOW_UP_BUCKETS.map((b) => [b, [] as FollowUpView[]])) as Record<FollowUpBucket, FollowUpView[]>;
  for (const f of [...items].sort(compareFollowUps)) out[followUpBucket(f, today)].push(f);
  return out;
}

// ---------------------------------------------------------------------------
// Next Best Action (deterministic)
// ---------------------------------------------------------------------------

export type NextAction =
  | { kind: "follow_up"; followUp: FollowUpView; bucket: FollowUpBucket }
  | { kind: "interaction_next_step"; interaction: InteractionView }
  | { kind: "validate"; question: string }
  | { kind: "add_contact" }
  | { kind: "record_first_contact"; contact: ContactView }
  | { kind: "inactive"; stage: "dormant" | "not_relevant" }
  | { kind: "none" };

export interface NextActionInput {
  stage: NetworkStage | null;
  contacts: readonly ContactView[];
  interactions: readonly InteractionView[];
  followUps: readonly FollowUpView[];
  /** The most important unresolved question of a stored public analysis, if any. */
  validationQuestion: string | null;
  today: string;
}

const QUALIFIED_STAGES: ReadonlySet<NetworkStage> = new Set(["qualified", "opportunity", "customer_partner"]);

export function latestInteraction(interactions: readonly InteractionView[]): InteractionView | null {
  let best: InteractionView | null = null;
  for (const i of interactions) if (!best || i.occurredAt > best.occurredAt || (i.occurredAt === best.occurredAt && i.createdAt > best.createdAt)) best = i;
  return best;
}

export function primaryContact(contacts: readonly ContactView[]): ContactView | null {
  return contacts.find((c) => c.isPrimary) ?? [...contacts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

/**
 * In order:
 *  1. the nearest open follow-up (a person already decided to do it);
 *  2. dormant / not relevant → no action is proposed;
 *  3. the next step of the latest interaction, unless a follow-up already tracks it;
 *  4. the most important validation question of the stored analysis, before qualification;
 *  5. no contact → identify who to talk to;
 *  6. contacts but no interaction → record the first contact once it happens;
 *  7. otherwise nothing is recorded — said explicitly.
 */
export function nextBestAction(input: NextActionInput): NextAction {
  const open = input.followUps.filter((f) => f.status === "open").sort(compareFollowUps);
  if (open[0]) return { kind: "follow_up", followUp: open[0], bucket: followUpBucket(open[0], input.today) };
  if (input.stage === "dormant" || input.stage === "not_relevant") return { kind: "inactive", stage: input.stage };

  const latest = latestInteraction(input.interactions);
  if (latest && latest.nextStep.trim() && !input.followUps.some((f) => f.interactionId === latest.id)) return { kind: "interaction_next_step", interaction: latest };

  if (input.validationQuestion && !(input.stage && QUALIFIED_STAGES.has(input.stage))) return { kind: "validate", question: input.validationQuestion };

  const contact = primaryContact(input.contacts);
  if (!contact) return { kind: "add_contact" };
  if (input.interactions.length === 0) return { kind: "record_first_contact", contact };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineEntry =
  | { kind: "added"; at: string; origin: NetworkOrigin | null }
  | { kind: "interaction"; at: string; interaction: InteractionView }
  | { kind: "event"; at: string; event: NetworkEventView };

/**
 * One chronological history, newest first: when the company entered the
 * Network (its real creation time), recorded interactions (at the time they
 * happened) and trigger-written relationship events. Nothing is synthesized
 * for the period before Phase 6.
 */
export function buildTimeline(input: { addedAt: string; origin: NetworkOrigin | null; interactions: readonly InteractionView[]; events: readonly NetworkEventView[] }): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { kind: "added", at: input.addedAt, origin: input.origin },
    ...input.interactions.map((interaction): TimelineEntry => ({ kind: "interaction", at: interaction.occurredAt, interaction })),
    ...input.events.map((event): TimelineEntry => ({ kind: "event", at: event.occurredAt, event })),
  ];
  const rank = (e: TimelineEntry) => (e.kind === "added" ? 0 : 1);
  // Newest first; "added" stays last among entries of the same instant.
  return entries.sort((a, b) => b.at.localeCompare(a.at) || rank(b) - rank(a));
}
