"use server";

import { revalidatePath } from "next/cache";
import { normalizeDueOn } from "@/lib/network/model";
import { requireAuth } from "@/lib/server/auth/context";
import { actionErrorKey } from "@/lib/server/auth/page";
import { createFollowUpFromSignal, recordManualSignal, setSignalStatus } from "@/lib/server/repositories/signals";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { ActionState } from "./workspace";

/*
 * Intelligence & signals (Phase 7). Every action: signed-in user → membership
 * (member+) of the organization named in the form, which is only a lookup key
 * → validated input → organization-filtered write under RLS. Deterministic
 * database writes only: no provider, model, fetch or outbound message.
 */

const str = (form: FormData, key: string): string => String(form.get(key) ?? "");
const optional = (form: FormData, key: string): string | null => str(form, key).trim() || null;

async function member(form: FormData) {
  const { db, user } = await requireAuth();
  const m = await requireMembership(db, user.id, str(form, "organizationId"), "member");
  return { db, user, organizationId: m.organizationId };
}

function done(companyId?: string): ActionState {
  revalidatePath("/workspace/intelligence");
  revalidatePath("/workspace/network", "layout");
  if (companyId) revalidatePath(`/workspace/companies/${companyId}`);
  return { ok: true };
}

/** A public change a person read, recorded with its source URL (never fetched by ORQO). */
export async function recordSignalAction(_: ActionState, form: FormData): Promise<ActionState> {
  const companyId = str(form, "companyId");
  try {
    const { db, organizationId } = await member(form);
    await recordManualSignal(db, organizationId, companyId, {
      kind: str(form, "kind") as never,
      headline: str(form, "headline"),
      detail: str(form, "detail"),
      sourceUrl: str(form, "sourceUrl").trim(),
      sourceAuthority: str(form, "sourceAuthority") as never,
      publishedOn: str(form, "publishedOn"),
    });
  } catch (e) {
    return { error: actionErrorKey(e, "recordSignal") };
  }
  return done(companyId);
}

export async function setSignalStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, organizationId } = await member(form);
    const { companyId } = await setSignalStatus(db, organizationId, str(form, "signalId"), str(form, "status"));
    return done(companyId);
  } catch (e) {
    return { error: actionErrorKey(e, "setSignalStatus") };
  }
}

/** Explicit human action: a Network follow-up on the signal's company. Nobody is contacted. */
export async function createFollowUpFromSignalAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, user, organizationId } = await member(form);
    const { companyId } = await createFollowUpFromSignal(db, organizationId, str(form, "signalId"), {
      title: str(form, "title"),
      description: str(form, "description"),
      dueOn: normalizeDueOn(form.get("dueOn")),
      priority: (optional(form, "priority") ?? "normal") as never,
      contactId: optional(form, "contactId"),
      // The only assignee the form can choose is the signed-in user.
      assignedTo: form.get("assignToMe") === "on" ? user.id : null,
    });
    return done(companyId);
  } catch (e) {
    return { error: actionErrorKey(e, "createFollowUp") };
  }
}
