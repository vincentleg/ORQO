"use server";

import { revalidatePath } from "next/cache";
import type { MessageKey } from "@/lib/i18n/translate";
import { normalizeDueOn } from "@/lib/network/model";
import { requireAuth } from "@/lib/server/auth/context";
import { actionErrorKey } from "@/lib/server/auth/page";
import { splitProfileList } from "@/lib/server/repositories/companies";
import {
  AmbiguousCompanyError,
  ArchivedEventError,
  addEventTarget,
  captureEncounter,
  createEvent,
  getEvent,
  removeEventTarget,
  setEventArchived,
  setTargetReviewed,
  setTargetStatus,
  updateEvent,
  updateEventTarget,
} from "@/lib/server/repositories/events";
import { createFollowUp } from "@/lib/server/repositories/network-memory";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { ActionState } from "./workspace";

/*
 * Events (Phase 8). Every action: signed-in user → membership (member+) of the
 * organization named in the form, which is only a lookup key → validated input
 * → organization-filtered writes under RLS, through the canonical Network
 * repository for companies, contacts, interactions and follow-ups.
 * Deterministic database writes only: no provider, model, fetch or outbound
 * message. A follow-up is only ever created by an explicit submit.
 */

const str = (form: FormData, key: string): string => String(form.get(key) ?? "");
const optional = (form: FormData, key: string): string | null => str(form, key).trim() || null;

async function member(form: FormData) {
  const { db, user } = await requireAuth();
  const m = await requireMembership(db, user.id, str(form, "organizationId"), "member");
  return { db, user, organizationId: m.organizationId };
}

function errorKey(e: unknown, action: string): MessageKey {
  if (e instanceof AmbiguousCompanyError) return "events.errors.ambiguousCompany";
  if (e instanceof ArchivedEventError) return "events.errors.archived";
  return actionErrorKey(e, action);
}

function done(eventId?: string, companyId?: string): ActionState {
  revalidatePath("/workspace/events", "layout");
  if (eventId) revalidatePath(`/workspace/events/${eventId}`, "layout");
  if (companyId) revalidatePath(`/workspace/companies/${companyId}`);
  revalidatePath("/workspace/network");
  return { ok: true };
}

function eventFields(form: FormData) {
  return {
    name: str(form, "name"),
    description: str(form, "description"),
    // An empty date field submits "" (never today's date): it means "not set".
    startsOn: normalizeDueOn(form.get("startsOn")),
    endsOn: normalizeDueOn(form.get("endsOn")),
    location: str(form, "location"),
    website: str(form, "website"),
    objectiveKind: optional(form, "objectiveKind") as never,
    objective: str(form, "objective"),
    topics: splitProfileList(str(form, "topics")).map((v) => v.slice(0, 80)).slice(0, 20),
  };
}

export type CreateEventState = ActionState & { eventId?: string };

export async function createEventAction(_: CreateEventState, form: FormData): Promise<CreateEventState> {
  try {
    const { db, organizationId } = await member(form);
    const eventId = await createEvent(db, organizationId, eventFields(form));
    done(eventId);
    return { ok: true, eventId };
  } catch (e) {
    return { error: errorKey(e, "createEvent") };
  }
}

export async function updateEventAction(_: ActionState, form: FormData): Promise<ActionState> {
  const eventId = str(form, "eventId");
  try {
    const { db, organizationId } = await member(form);
    await updateEvent(db, organizationId, eventId, eventFields(form));
  } catch (e) {
    return { error: errorKey(e, "updateEvent") };
  }
  return done(eventId);
}

export async function setEventArchivedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const eventId = str(form, "eventId");
  try {
    const { db, organizationId } = await member(form);
    await setEventArchived(db, organizationId, eventId, str(form, "archived") === "true");
  } catch (e) {
    return { error: errorKey(e, "setEventArchived") };
  }
  return done(eventId);
}

function targetDetails(form: FormData) {
  return {
    priority: (optional(form, "priority") ?? "medium") as never,
    attendance: (optional(form, "attendance") ?? "unknown") as never,
    why: str(form, "why"),
    prepNotes: str(form, "prepNotes"),
  };
}

/** A Network company picked by id, or a new one typed by the person (resolved server-side, never duplicated). */
function companyChoice(form: FormData): { companyId: string } | { name: string; website: string } | null {
  const companyId = optional(form, "companyId");
  if (companyId && companyId !== "new") return { companyId };
  const name = str(form, "companyName").trim();
  return name ? { name, website: str(form, "companyWebsite") } : null;
}

export type AddTargetState = ActionState & { alreadyTargeted?: boolean };

export async function addEventTargetAction(_: AddTargetState, form: FormData): Promise<AddTargetState> {
  const eventId = str(form, "eventId");
  try {
    const { db, organizationId } = await member(form);
    const company = companyChoice(form);
    if (!company) return { error: "events.errors.pickCompany" };
    const r = await addEventTarget(db, organizationId, eventId, company, targetDetails(form), str(form, "status") === "planned" ? "planned" : "targeted");
    done(eventId, r.companyId);
    return { ok: true, alreadyTargeted: r.alreadyTargeted };
  } catch (e) {
    return { error: errorKey(e, "addEventTarget") };
  }
}

export async function updateEventTargetAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, organizationId } = await member(form);
    const t = await updateEventTarget(db, organizationId, str(form, "targetId"), targetDetails(form));
    return done(t.eventId, t.companyId);
  } catch (e) {
    return { error: errorKey(e, "updateEventTarget") };
  }
}

export async function setTargetStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, organizationId } = await member(form);
    const t = await setTargetStatus(db, organizationId, str(form, "targetId"), str(form, "status"));
    return done(t.eventId, t.companyId);
  } catch (e) {
    return { error: errorKey(e, "setTargetStatus") };
  }
}

export async function setTargetReviewedAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, organizationId } = await member(form);
    const t = await setTargetReviewed(db, organizationId, str(form, "targetId"), str(form, "reviewed") === "true");
    return done(t.eventId, t.companyId);
  } catch (e) {
    return { error: errorKey(e, "setTargetReviewed") };
  }
}

export async function removeEventTargetAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, organizationId } = await member(form);
    const t = await removeEventTarget(db, organizationId, str(form, "targetId"));
    return done(t.eventId, t.companyId);
  } catch (e) {
    return { error: errorKey(e, "removeEventTarget") };
  }
}

export type CaptureState = ActionState & { companyName?: string };

/** Fast capture: canonical company / contact / interaction, target marked met. No follow-up, no outreach. */
export async function captureEncounterAction(_: CaptureState, form: FormData): Promise<CaptureState> {
  const eventId = str(form, "eventId");
  try {
    const { db, organizationId } = await member(form);
    const company = companyChoice(form);
    if (!company) return { error: "events.errors.pickCompany" };
    const contactChoice = optional(form, "contactId");
    const newContact =
      contactChoice === "new"
        ? { name: str(form, "contactName"), role: str(form, "contactRole"), email: str(form, "contactEmail"), phone: str(form, "contactPhone"), profileUrl: str(form, "contactProfileUrl"), notes: str(form, "contactNotes") }
        : null;
    const r = await captureEncounter(db, organizationId, eventId, {
      company,
      contactId: contactChoice && contactChoice !== "new" ? contactChoice : null,
      newContact,
      interaction: { occurredAt: str(form, "occurredAt"), title: str(form, "title"), summary: str(form, "summary"), outcome: str(form, "outcome"), nextStep: str(form, "nextStep") },
    });
    done(eventId, r.companyId);
    return { ok: true, companyName: "companyId" in company ? undefined : company.name };
  } catch (e) {
    return { error: errorKey(e, "captureEncounter") };
  }
}

/** A follow-up explicitly created in the context of an event (from a next step, a missed target, or freely). */
export async function createEventFollowUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const eventId = str(form, "eventId");
  const companyId = str(form, "companyId");
  try {
    const { db, user, organizationId } = await member(form);
    if (!(await getEvent(db, organizationId, eventId))) return { error: "errors.notFound" };
    await createFollowUp(
      db,
      organizationId,
      companyId,
      {
        title: str(form, "title"),
        description: str(form, "description"),
        dueOn: normalizeDueOn(form.get("dueOn")),
        priority: (optional(form, "priority") ?? "normal") as never,
        contactId: optional(form, "contactId"),
        interactionId: optional(form, "interactionId"),
        // The only assignee the form can choose is the signed-in user.
        assignedTo: form.get("assignToMe") === "on" ? user.id : null,
      },
      { eventId },
    );
  } catch (e) {
    return { error: errorKey(e, "createEventFollowUp") };
  }
  return done(eventId, companyId);
}
