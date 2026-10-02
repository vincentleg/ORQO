"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/server/auth/context";
import { actionErrorKey } from "@/lib/server/auth/page";
import { rebuildOrganizationGraph } from "@/lib/server/graph/service";
import type { ActionState } from "./workspace";

/*
 * Opportunity Graph (Phase 10). The only write is to the DERIVED graph store:
 * signed-in user → admin membership of the organization named in the form
 * (only a lookup key) → rebuild of that organization's projection from
 * PostgreSQL. No canonical record, provider, model or outbound message.
 */
export async function rebuildGraphAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireAuth();
    await rebuildOrganizationGraph(db, user.id, String(form.get("organizationId") ?? ""));
  } catch (e) {
    return { error: actionErrorKey(e, "rebuildGraph") };
  }
  revalidatePath("/workspace/network");
  revalidatePath("/workspace/companies", "layout");
  return { ok: true };
}
