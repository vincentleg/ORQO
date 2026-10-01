"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/server/auth/context";
import { actionErrorKey } from "@/lib/server/auth/page";
import { addSearchedCompany } from "@/lib/server/network/search";
import { createFollowUp, createNetworkContact, recordInteraction, setFollowUpStatus, updateNetworkContact, updateRelationship } from "@/lib/server/repositories/network-memory";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { ActionState } from "./workspace";

/*
 * Network relationship memory (Phase 6). Every action: signed-in user →
 * membership (member+) of the organization named in the form, which is only a
 * lookup key → validated input → organization-filtered write under RLS.
 * Deterministic database writes only: no provider, model or outbound message.
 */

const str = (form: FormData, key: string): string => String(form.get(key) ?? "");
const optional = (form: FormData, key: string): string | null => str(form, key).trim() || null;

async function member(form: FormData) {
  const { db, user } = await requireAuth();
  const m = await requireMembership(db, user.id, str(form, "organizationId"), "member");
  return { db, user, organizationId: m.organizationId };
}

function done(companyId?: string): ActionState {
  revalidatePath("/workspace/network", "layout");
  if (companyId) revalidatePath(`/workspace/network/${companyId}`);
  return { ok: true };
}

export type AddSearchedState = ActionState & { companyId?: string; existing?: boolean };

/** Search → Add to Network. Only the query is sent; the server re-derives the company from its own stored analysis. */
export async function addSearchedCompanyAction(_: AddSearchedState, form: FormData): Promise<AddSearchedState> {
  try {
    const { db, organizationId } = await member(form);
    const { companyId, created } = await addSearchedCompany(db, organizationId, str(form, "q"));
    revalidatePath("/workspace", "layout");
    return { ok: true, companyId, existing: !created };
  } catch (e) {
    return { error: actionErrorKey(e, "addSearchedCompany") };
  }
}

export async function updateRelationshipAction(_: ActionState, form: FormData): Promise<ActionState> {
  const companyId = str(form, "companyId");
  try {
    const { db, organizationId } = await member(form);
    await updateRelationship(db, organizationId, companyId, { stage: optional(form, "stage") as never, origin: optional(form, "origin") as never, reason: str(form, "reason") });
  } catch (e) {
    return { error: actionErrorKey(e, "updateRelationship") };
  }
  return done(companyId);
}

export async function saveContactAction(_: ActionState, form: FormData): Promise<ActionState> {
  const companyId = str(form, "companyId");
  try {
    const { db, organizationId } = await member(form);
    const input = {
      name: str(form, "name"),
      role: str(form, "role"),
      email: str(form, "email"),
      phone: str(form, "phone"),
      profileUrl: str(form, "profileUrl"),
      notes: str(form, "notes"),
      isPrimary: form.get("isPrimary") === "on",
    };
    const contactId = optional(form, "contactId");
    if (contactId) await updateNetworkContact(db, organizationId, companyId, contactId, input);
    else await createNetworkContact(db, organizationId, companyId, input);
  } catch (e) {
    return { error: actionErrorKey(e, "saveContact") };
  }
  return done(companyId);
}

export async function recordInteractionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const companyId = str(form, "companyId");
  try {
    const { db, organizationId } = await member(form);
    await recordInteraction(db, organizationId, companyId, {
      kind: str(form, "kind") as never,
      occurredAt: str(form, "occurredAt"),
      contactId: optional(form, "contactId"),
      title: str(form, "title"),
      summary: str(form, "summary"),
      outcome: str(form, "outcome"),
      nextStep: str(form, "nextStep"),
    });
  } catch (e) {
    return { error: actionErrorKey(e, "recordInteraction") };
  }
  return done(companyId);
}

export async function createFollowUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const companyId = str(form, "companyId");
  try {
    const { db, user, organizationId } = await member(form);
    await createFollowUp(db, organizationId, companyId, {
      title: str(form, "title"),
      description: str(form, "description"),
      dueOn: optional(form, "dueOn"),
      priority: (optional(form, "priority") ?? "normal") as never,
      contactId: optional(form, "contactId"),
      interactionId: optional(form, "interactionId"),
      // The only assignee the form can choose is the signed-in user.
      assignedTo: form.get("assignToMe") === "on" ? user.id : null,
    });
  } catch (e) {
    return { error: actionErrorKey(e, "createFollowUp") };
  }
  return done(companyId);
}

export async function setFollowUpStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, organizationId } = await member(form);
    const { companyId } = await setFollowUpStatus(db, organizationId, str(form, "followUpId"), str(form, "status"));
    return done(companyId);
  } catch (e) {
    return { error: actionErrorKey(e, "setFollowUpStatus") };
  }
}
