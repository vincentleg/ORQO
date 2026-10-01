/**
 * Events (Phase 8): events, their target companies, fast capture and the
 * reads behind the Events workspace. Every call runs as the signed-in user,
 * so RLS is the backstop; every query also filters on the organization.
 *
 * Events never own a parallel CRM: companies, contacts, interactions and
 * follow-ups are written through the canonical Phase 6 repository with the
 * event kept as context. A company already known is reused (never duplicated)
 * and keeps its original Network origin; only a company CREATED through an
 * event records origin "event" and that event. No provider, model, fetch or
 * outbound message is reachable from here.
 */
import { z } from "zod";
import { resolveEventCompany, eventExternalRef } from "@/lib/events/identity";
import {
  ATTENDANCE,
  EVENT_OBJECTIVES,
  TARGET_PRIORITIES,
  TARGET_STATUSES,
  canRemoveTarget,
  canTransitionTarget,
  eventPhase,
  reviewCounts,
  validEventDates,
  type EventActivity,
  type EventSummary,
  type EventTargetView,
  type EventView,
  type TargetStatus,
} from "@/lib/events/model";
import { NETWORK_STAGES, isIsoDay } from "@/lib/network/model";
import { AppError, fromDbError, parseInput } from "@/lib/server/errors";
import { IsoTimestamp } from "@/lib/server/orqo/schemas";
import type { Db } from "@/lib/server/supabase/types";
import { createCompany, listCompanies } from "./companies";
import { ContactInput, InteractionInput, createNetworkContact, getNetworkCompany, listContactRefs, listEventFollowUps, listEventInteractions, recordInteraction } from "./network-memory";

/** The same name is already known under a different website: nothing is merged silently. */
export class AmbiguousCompanyError extends AppError {
  constructor(readonly existingCompanyId: string) {
    super("conflict", "A company with this name is already known with a different website.");
  }
}

/** Archived events are read-only. */
export class ArchivedEventError extends AppError {
  constructor() {
    super("conflict", "This event is archived.");
  }
}

const Text = (max: number) => z.string().trim().max(max);
const HttpUrl = z.url({ protocol: /^https?$/ }).max(500);
const OptionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(HttpUrl.nullable());
const OptionalDay = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().refine(isIsoDay, "Expected a calendar day (YYYY-MM-DD).").nullable());

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const EVENT_COLUMNS = "id, name, description, starts_on, ends_on, location, website, objective_kind, objective, topics, archived_at, created_at";
const EventRow = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  starts_on: z.string().nullable(),
  ends_on: z.string().nullable(),
  location: z.string(),
  website: z.string().nullable(),
  objective_kind: z.enum(EVENT_OBJECTIVES).nullable(),
  objective: z.string(),
  topics: z.array(z.string()),
  archived_at: IsoTimestamp.nullable(),
  created_at: IsoTimestamp,
});
const toEvent = (r: z.infer<typeof EventRow>): EventView => ({
  id: r.id,
  name: r.name,
  description: r.description,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  location: r.location,
  website: r.website,
  objectiveKind: r.objective_kind,
  objective: r.objective,
  topics: r.topics,
  archivedAt: r.archived_at,
  createdAt: r.created_at,
});

export const EventInput = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    description: Text(4000).default(""),
    startsOn: OptionalDay,
    endsOn: OptionalDay,
    location: Text(200).default(""),
    website: OptionalUrl,
    objectiveKind: z.enum(EVENT_OBJECTIVES).nullable().default(null),
    objective: Text(2000).default(""),
    topics: z.array(Text(80).min(1)).max(20).default([]),
  })
  .refine((e) => validEventDates(e.startsOn, e.endsOn), { message: "The end day needs a start day and cannot be before it.", path: ["endsOn"] });

const eventRow = (e: z.infer<typeof EventInput>) => ({
  name: e.name,
  description: e.description,
  starts_on: e.startsOn,
  ends_on: e.endsOn,
  location: e.location,
  website: e.website,
  objective_kind: e.objectiveKind,
  objective: e.objective,
  topics: e.topics,
});

export async function listEvents(db: Db, organizationId: string): Promise<EventView[]> {
  const { data, error } = await db.from("events").select(EVENT_COLUMNS).eq("organization_id", organizationId).order("starts_on", { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw fromDbError(error);
  return z.array(EventRow).parse(data).map(toEvent);
}

export async function getEvent(db: Db, organizationId: string, eventId: string): Promise<EventView | null> {
  if (!z.uuid().safeParse(eventId).success) return null;
  const { data, error } = await db.from("events").select(EVENT_COLUMNS).eq("organization_id", organizationId).eq("id", eventId).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? toEvent(EventRow.parse(data)) : null;
}

/** An event of this organization that can still change (archived events are read-only). */
async function requireOpenEvent(db: Db, organizationId: string, eventId: string): Promise<EventView> {
  const e = await getEvent(db, organizationId, eventId);
  if (!e) throw new AppError("not_found", "Event not found.");
  if (e.archivedAt) throw new ArchivedEventError();
  return e;
}

export async function createEvent(db: Db, organizationId: string, input: z.input<typeof EventInput>): Promise<string> {
  const e = parseInput(EventInput, input);
  const { data, error } = await db
    .from("events")
    .insert({ organization_id: organizationId, ...eventRow(e) })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.uuid() }).parse(data).id;
}

export async function updateEvent(db: Db, organizationId: string, eventId: string, input: z.input<typeof EventInput>): Promise<void> {
  const e = parseInput(EventInput, input);
  await requireOpenEvent(db, organizationId, eventId);
  const { data, error } = await db.from("events").update(eventRow(e)).eq("organization_id", organizationId).eq("id", eventId).select("id");
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) throw new AppError("not_found", "Event not found.");
}

/** Archive (or restore) an event. Events are never deleted, so the provenance they carry stays. */
export async function setEventArchived(db: Db, organizationId: string, eventId: string, archived: boolean): Promise<void> {
  if (!z.uuid().safeParse(eventId).success) throw new AppError("not_found", "Event not found.");
  const { data, error } = await db
    .from("events")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", eventId)
    .select("id");
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) throw new AppError("not_found", "Event not found.");
}

// ---------------------------------------------------------------------------
// Event targets
// ---------------------------------------------------------------------------

const TARGET_COLUMNS = "id, event_id, company_id, status, priority, attendance, why, prep_notes, reviewed_at, status_changed_at, created_at, companies!inner(name, website, network_stage)";
const TargetRow = z.object({
  id: z.uuid(),
  event_id: z.uuid(),
  company_id: z.uuid(),
  status: z.enum(TARGET_STATUSES),
  priority: z.enum(TARGET_PRIORITIES),
  attendance: z.enum(ATTENDANCE),
  why: z.string(),
  prep_notes: z.string(),
  reviewed_at: IsoTimestamp.nullable(),
  status_changed_at: IsoTimestamp.nullable(),
  created_at: IsoTimestamp,
  companies: z.object({ name: z.string(), website: z.string().nullable(), network_stage: z.enum(NETWORK_STAGES).nullable().catch(null) }),
});
const toTarget = (r: z.infer<typeof TargetRow>): EventTargetView => ({
  id: r.id,
  eventId: r.event_id,
  companyId: r.company_id,
  companyName: r.companies.name,
  companyWebsite: r.companies.website,
  companyStage: r.companies.network_stage,
  status: r.status,
  priority: r.priority,
  attendance: r.attendance,
  why: r.why,
  prepNotes: r.prep_notes,
  reviewedAt: r.reviewed_at,
  statusChangedAt: r.status_changed_at,
  createdAt: r.created_at,
});

export async function listEventTargets(db: Db, organizationId: string, filter: { eventId: string } | { companyId: string }): Promise<EventTargetView[]> {
  let q = db.from("event_companies").select(TARGET_COLUMNS).eq("organization_id", organizationId);
  q = "eventId" in filter ? q.eq("event_id", filter.eventId) : q.eq("company_id", filter.companyId);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(1000);
  if (error) throw fromDbError(error);
  return z.array(TargetRow).parse(data).map(toTarget);
}

export async function getEventTarget(db: Db, organizationId: string, targetId: string): Promise<EventTargetView | null> {
  if (!z.uuid().safeParse(targetId).success) return null;
  const { data, error } = await db.from("event_companies").select(TARGET_COLUMNS).eq("organization_id", organizationId).eq("id", targetId).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? toTarget(TargetRow.parse(data)) : null;
}

export const NewCompanyForEvent = z.strictObject({
  name: z.string().trim().min(1).max(200),
  website: OptionalUrl,
});

/**
 * The canonical company for an event: an existing Network company (by id), or
 * the company the organization already knows under that website / name, or a
 * new one created with origin "event" and this event as provenance. An
 * existing company is never modified, so its original origin is preserved.
 */
async function companyForEvent(db: Db, organizationId: string, eventId: string, company: { companyId: string } | z.input<typeof NewCompanyForEvent>): Promise<{ companyId: string; created: boolean }> {
  if ("companyId" in company) {
    const c = await getNetworkCompany(db, organizationId, company.companyId);
    if (!c || c.isOwnCompany) throw new AppError("not_found", "Company not found.");
    return { companyId: c.id, created: false };
  }
  const input = parseInput(NewCompanyForEvent, company);
  const resolve = async () => resolveEventCompany(input, (await listCompanies(db, organizationId)).map((c) => ({ id: c.id, name: c.name, website: c.website, isOwnCompany: c.is_own_company })));
  const r = await resolve();
  switch (r.kind) {
    case "existing":
      return { companyId: r.companyId, created: false };
    case "ambiguous":
      throw new AmbiguousCompanyError(r.companyId);
    case "own_company":
      throw new AppError("invalid_input", "This is your own company.");
    case "create":
      try {
        const row = await createCompany(db, organizationId, { name: r.name, ...(r.website && { website: r.website }), networkOrigin: "event", originEventId: eventId, externalRef: eventExternalRef(eventId, r) });
        return { companyId: row.id, created: true };
      } catch (e) {
        // The same company submitted twice at once: the unique external_ref kept one row.
        if (e instanceof AppError && e.code === "conflict") {
          const again = await resolve();
          if (again.kind === "existing") return { companyId: again.companyId, created: false };
        }
        throw e;
      }
  }
}

export const TargetDetails = z.strictObject({
  priority: z.enum(TARGET_PRIORITIES).default("medium"),
  attendance: z.enum(ATTENDANCE).default("unknown"),
  why: Text(2000).default(""),
  prepNotes: Text(4000).default(""),
});

async function findTargetFor(db: Db, organizationId: string, eventId: string, companyId: string): Promise<{ id: string; status: TargetStatus } | null> {
  const { data, error } = await db.from("event_companies").select("id, status").eq("organization_id", organizationId).eq("event_id", eventId).eq("company_id", companyId).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? z.object({ id: z.uuid(), status: z.enum(TARGET_STATUSES) }).parse(data) : null;
}

/** Add a company to an event's targets. A company already on the event is returned as it is (one row per event and company). */
export async function addEventTarget(
  db: Db,
  organizationId: string,
  eventId: string,
  company: { companyId: string } | z.input<typeof NewCompanyForEvent>,
  details: z.input<typeof TargetDetails> = {},
  status: Extract<TargetStatus, "planned" | "targeted" | "met"> = "targeted",
): Promise<{ targetId: string; companyId: string; companyCreated: boolean; alreadyTargeted: boolean }> {
  const d = parseInput(TargetDetails, details);
  await requireOpenEvent(db, organizationId, eventId);
  const { companyId, created } = await companyForEvent(db, organizationId, eventId, company);
  const existing = await findTargetFor(db, organizationId, eventId, companyId);
  if (existing) return { targetId: existing.id, companyId, companyCreated: created, alreadyTargeted: true };
  const { data, error } = await db
    .from("event_companies")
    .insert({ organization_id: organizationId, event_id: eventId, company_id: companyId, status, priority: d.priority, attendance: d.attendance, why: d.why, prep_notes: d.prepNotes })
    .select("id")
    .single();
  if (error) {
    const again = await findTargetFor(db, organizationId, eventId, companyId);
    if (again) return { targetId: again.id, companyId, companyCreated: created, alreadyTargeted: true };
    throw fromDbError(error);
  }
  return { targetId: z.object({ id: z.uuid() }).parse(data).id, companyId, companyCreated: created, alreadyTargeted: false };
}

async function requireTarget(db: Db, organizationId: string, targetId: string): Promise<EventTargetView> {
  const t = await getEventTarget(db, organizationId, targetId);
  if (!t) throw new AppError("not_found", "Target not found.");
  await requireOpenEvent(db, organizationId, t.eventId);
  return t;
}

export async function updateEventTarget(db: Db, organizationId: string, targetId: string, input: z.input<typeof TargetDetails>): Promise<EventTargetView> {
  const d = parseInput(TargetDetails, input);
  const t = await requireTarget(db, organizationId, targetId);
  const { error } = await db.from("event_companies").update({ priority: d.priority, attendance: d.attendance, why: d.why, prep_notes: d.prepNotes }).eq("organization_id", organizationId).eq("id", targetId);
  if (error) throw fromDbError(error);
  return t;
}

/** Move a target through its lifecycle (checked server-side; optimistic on the current status). */
export async function setTargetStatus(db: Db, organizationId: string, targetId: string, status: unknown): Promise<EventTargetView> {
  const to = parseInput(z.enum(TARGET_STATUSES), status);
  const t = await requireTarget(db, organizationId, targetId);
  if (!canTransitionTarget(t.status, to)) throw new AppError("invalid_input", "This change of status is not allowed.");
  const { data, error } = await db.from("event_companies").update({ status: to }).eq("organization_id", organizationId).eq("id", targetId).eq("status", t.status).select("id");
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) throw new AppError("conflict", "The target changed in the meantime.");
  return t;
}

/** After the event: a person decides a target needs no action (or undoes that). The target and its status stay. */
export async function setTargetReviewed(db: Db, organizationId: string, targetId: string, reviewed: boolean): Promise<EventTargetView> {
  const t = await requireTarget(db, organizationId, targetId);
  const { error } = await db
    .from("event_companies")
    .update({ reviewed_at: reviewed ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", targetId);
  if (error) throw fromDbError(error);
  return t;
}

/** Remove a target added by mistake — only before anything happened with it at the event. The company stays in Network. */
export async function removeEventTarget(db: Db, organizationId: string, targetId: string): Promise<EventTargetView> {
  const t = await requireTarget(db, organizationId, targetId);
  const { count, error: countError } = await db.from("interactions").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("event_id", t.eventId).eq("company_id", t.companyId);
  if (countError) throw fromDbError(countError);
  if (!canRemoveTarget(t, count ?? 0)) throw new AppError("conflict", "This target already has recorded activity.");
  const { error } = await db.from("event_companies").delete().eq("organization_id", organizationId).eq("id", targetId).in("status", ["planned", "targeted"]);
  if (error) throw fromDbError(error);
  return t;
}

// ---------------------------------------------------------------------------
// Fast capture: one encounter → canonical contact + interaction, target met
// ---------------------------------------------------------------------------

export const CaptureInput = z.strictObject({
  company: z.union([z.strictObject({ companyId: z.uuid() }), NewCompanyForEvent]),
  contactId: z.uuid().nullable().default(null),
  newContact: ContactInput.nullable().default(null),
  interaction: InteractionInput.omit({ kind: true, contactId: true }),
});

/**
 * What a person records standing at an event. In order: the canonical company
 * (reused or created through the trusted path), an optional new canonical
 * contact (recorded at this event), a canonical interaction of kind "event"
 * with this event as context, and the event target marked "met". The next
 * step is only stored on the interaction: a follow-up is created only when a
 * person explicitly converts it. Nothing is sent to anyone.
 */
export async function captureEncounter(
  db: Db,
  organizationId: string,
  eventId: string,
  input: z.input<typeof CaptureInput>,
): Promise<{ companyId: string; interactionId: string; targetId: string; companyCreated: boolean; contactId: string | null }> {
  const c = parseInput(CaptureInput, input);
  await requireOpenEvent(db, organizationId, eventId);
  // Validated above as a whole; the canonical writers below re-validate their own part from the raw input.
  const { companyId, created } = await companyForEvent(db, organizationId, eventId, input.company);
  const contactId = input.newContact ? await createNetworkContact(db, organizationId, companyId, input.newContact, { eventId }) : c.contactId;
  const interactionId = await recordInteraction(db, organizationId, companyId, { ...c.interaction, kind: "event", contactId }, { eventId });
  const target = await findTargetFor(db, organizationId, eventId, companyId);
  let targetId: string;
  if (!target) {
    targetId = (await addEventTarget(db, organizationId, eventId, { companyId }, {}, "met")).targetId;
  } else {
    targetId = target.id;
    if (target.status !== "met") {
      const { error } = await db.from("event_companies").update({ status: "met" }).eq("organization_id", organizationId).eq("id", target.id);
      if (error) throw fromDbError(error);
    }
  }
  return { companyId, interactionId, targetId, companyCreated: created, contactId };
}

// ---------------------------------------------------------------------------
// Reads behind the Events workspace
// ---------------------------------------------------------------------------

export interface EventDetail extends EventActivity {
  event: EventView;
  contacts: Awaited<ReturnType<typeof listContactRefs>>;
}

export async function getEventDetail(db: Db, organizationId: string, eventId: string): Promise<EventDetail | null> {
  const event = await getEvent(db, organizationId, eventId);
  if (!event) return null;
  const [targets, interactions, followUps, contacts, newCompanies] = await Promise.all([
    listEventTargets(db, organizationId, { eventId }),
    listEventInteractions(db, organizationId, eventId),
    listEventFollowUps(db, organizationId, eventId),
    listContactRefs(db, organizationId, { eventId }),
    db.from("companies").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("origin_event_id", eventId),
  ]);
  if (newCompanies.error) throw fromDbError(newCompanies.error);
  return { event, targets, interactions, followUps, contacts, contactsAdded: contacts.length, newCompanies: newCompanies.count ?? 0 };
}

/** Every event with factual counts, in four organization-wide reads. */
export async function listEventSummaries(db: Db, organizationId: string, today: string): Promise<EventSummary[]> {
  const [events, targets, followUps] = await Promise.all([
    listEvents(db, organizationId),
    db.from("event_companies").select("event_id, status, priority").eq("organization_id", organizationId).limit(5000),
    db.from("follow_ups").select("event_id").eq("organization_id", organizationId).eq("status", "open").not("event_id", "is", null).limit(5000),
  ]);
  for (const r of [targets, followUps]) if (r.error) throw fromDbError(r.error);
  const rows = z.array(z.object({ event_id: z.uuid(), status: z.enum(TARGET_STATUSES), priority: z.enum(TARGET_PRIORITIES) })).parse(targets.data);
  const open = z.array(z.object({ event_id: z.uuid() })).parse(followUps.data);
  return events.map((event) => {
    const mine = rows.filter((r) => r.event_id === event.id);
    return {
      event,
      phase: eventPhase(event, today),
      targets: mine.length,
      met: mine.filter((r) => r.status === "met").length,
      missedHigh: mine.filter((r) => r.status === "missed" && r.priority === "high").length,
      notRecorded: mine.filter((r) => r.status === "planned" || r.status === "targeted").length,
      openFollowUps: open.filter((r) => r.event_id === event.id).length,
    };
  });
}

/** The events a Network company appears in (for its company page), newest first. */
export async function listCompanyEvents(db: Db, organizationId: string, companyId: string): Promise<{ target: EventTargetView; event: EventView }[]> {
  if (!z.uuid().safeParse(companyId).success) return [];
  const [targets, events] = await Promise.all([listEventTargets(db, organizationId, { companyId }), listEvents(db, organizationId)]);
  const byId = new Map(events.map((e) => [e.id, e]));
  return targets.flatMap((target) => {
    const event = byId.get(target.eventId);
    return event ? [{ target, event }] : [];
  });
}

// ---------------------------------------------------------------------------
// Agent seam: event context (read-only, data-minimized)
// ---------------------------------------------------------------------------

export interface EventContext {
  /** The team's private event plan; never public evidence. */
  provenance: "private_event_plan";
  event: { id: string; name: string; startsOn: string | null; endsOn: string | null; location: string; objectiveKind: EventView["objectiveKind"]; objective: string; topics: string[] };
  targets: { companyId: string; companyName: string; status: TargetStatus; priority: EventTargetView["priority"]; attendance: EventTargetView["attendance"] }[];
  review: ReturnType<typeof reviewCounts>;
}

/**
 * What a future Event Agent may read about one event. Preparation notes, the
 * "why" text, contact details and interaction contents are deliberately left
 * out; the agent that holds this tool is not executable yet.
 */
export async function readEventContext(db: Db, organizationId: string, eventId: string): Promise<EventContext | null> {
  const d = await getEventDetail(db, organizationId, eventId);
  if (!d) return null;
  const e = d.event;
  return {
    provenance: "private_event_plan",
    event: { id: e.id, name: e.name, startsOn: e.startsOn, endsOn: e.endsOn, location: e.location, objectiveKind: e.objectiveKind, objective: e.objective, topics: e.topics },
    targets: d.targets.map((t) => ({ companyId: t.companyId, companyName: t.companyName, status: t.status, priority: t.priority, attendance: t.attendance })),
    review: reviewCounts(d),
  };
}
