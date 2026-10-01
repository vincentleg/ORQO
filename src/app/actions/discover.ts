"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/server/auth/context";
import { actionErrorKey } from "@/lib/server/auth/page";
import { addDiscoveredCompany } from "@/lib/server/discovery/network";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { ActionState } from "./workspace";

export type AddDiscoveredState = ActionState & { existing?: boolean };

/** Adds one company a Discover mission presented to the Network (member+). The organization id is only a lookup key. */
export async function addDiscoveredCompanyAction(_: AddDiscoveredState, form: FormData): Promise<AddDiscoveredState> {
  let created: boolean;
  try {
    const { db, user } = await requireAuth();
    const membership = await requireMembership(db, user.id, String(form.get("organizationId") ?? ""), "member");
    ({ created } = await addDiscoveredCompany(db, membership.organizationId, String(form.get("runId") ?? ""), String(form.get("domain") ?? "")));
  } catch (e) {
    return { error: actionErrorKey(e, "addDiscoveredCompany") };
  }
  revalidatePath("/workspace", "layout");
  return { ok: true, existing: !created };
}
