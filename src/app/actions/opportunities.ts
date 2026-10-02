"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/server/auth/context";
import { actionErrorKey } from "@/lib/server/auth/page";
import { addSearchedCompany } from "@/lib/server/network/search";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import { setTrackedStatus, trackOpportunity } from "@/lib/server/repositories/tracked-opportunities";
import { addRelationshipAnswer } from "@/lib/server/repositories/understanding";
import type { ActionState } from "./workspace";

/*
 * Phase 16A: tracked opportunities and the relationship question. Every action:
 * signed-in user → membership (member+) of the organization named in the form,
 * which is only a lookup key → the server re-derives everything else (the
 * company, its dossier, the scenario) → organization-filtered write under RLS.
 * No provider, model or outbound message.
 */

const str = (form: FormData, key: string): string => String(form.get(key) ?? "");

async function member(form: FormData) {
  const { db, user } = await requireAuth();
  const m = await requireMembership(db, user.id, str(form, "organizationId"), "member");
  return { db, organizationId: m.organizationId };
}

function refresh(companyId?: string) {
  revalidatePath("/workspace/opportunities", "layout");
  revalidatePath("/workspace", "layout");
  if (companyId) revalidatePath(`/workspace/network/${companyId}`);
}

export type TrackState = ActionState & { opportunityId?: string; existing?: boolean };

/**
 * "Track this opportunity". The form carries a remembered company id, or, from Search, only the query (the
 * company is then remembered first, from the server's own stored analysis), plus the scenario key.
 */
export async function trackOpportunityAction(_: TrackState, form: FormData): Promise<TrackState> {
  try {
    const { db, organizationId } = await member(form);
    let companyId = str(form, "companyId");
    if (!companyId && str(form, "q")) companyId = (await addSearchedCompany(db, organizationId, str(form, "q"))).companyId;
    const { id, created } = await trackOpportunity(db, organizationId, { targetCompanyId: companyId, scenarioKey: str(form, "scenarioKey") });
    refresh(companyId);
    return { ok: true, opportunityId: id, existing: !created };
  } catch (e) {
    return { error: actionErrorKey(e, "trackOpportunity") };
  }
}

export async function setTrackedStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, organizationId } = await member(form);
    const o = await setTrackedStatus(db, organizationId, str(form, "opportunityId"), { status: str(form, "status") });
    refresh(o.targetCompanyId);
    revalidatePath(`/workspace/opportunities/${o.id}`);
  } catch (e) {
    return { error: actionErrorKey(e, "setTrackedStatus") };
  }
  return { ok: true };
}

/** "How does this company work with you today?" One answer, stored once; the question is then never asked again. */
export async function answerRelationshipAction(_: ActionState, form: FormData): Promise<ActionState> {
  const companyId = str(form, "companyId");
  try {
    const { db, organizationId } = await member(form);
    // The exclusive buttons ("No relationship yet", "Not sure") win over any ticked role.
    const values = form.getAll("values").map(String);
    const exclusive = ["not_sure", "none"].find((v) => values.includes(v));
    await addRelationshipAnswer(db, organizationId, companyId, { values: exclusive ? [exclusive] : values });
  } catch (e) {
    return { error: actionErrorKey(e, "answerRelationship") };
  }
  refresh(companyId);
  return { ok: true };
}
