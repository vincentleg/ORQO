import "server-only";
import { cache } from "react";
import type { Plan } from "@/lib/entitlements/plans";
import type { Locale } from "@/lib/i18n/config";
import { requireWorkspace, type WorkspaceContext } from "@/lib/server/auth/page";
import { getPresentedPlan } from "@/lib/server/entitlements";
import { getRequestLocale } from "@/lib/server/i18n";
import { getProfile } from "@/lib/server/repositories/tenancy";

export interface WorkspaceShell extends WorkspaceContext {
  locale: Locale;
  plan: Plan;
  /** The signed-in person's display name, when they set one (Work greets them with it). */
  displayName: string | null;
}

/**
 * Signed-in user, active workspace, language and presented plan for the
 * current request. Memoized per request (React `cache`) so the layout and the
 * page share one lookup; each page still calls it, so auth is verified by the
 * page itself rather than trusted from the layout.
 */
export const loadWorkspace = cache(async (): Promise<WorkspaceShell> => {
  const ctx = await requireWorkspace("/workspace");
  const profile = await getProfile(ctx.db, ctx.user.id);
  const [locale, plan] = await Promise.all([getRequestLocale(profile?.locale), getPresentedPlan(ctx.active.organizationId)]);
  return { ...ctx, locale, plan, displayName: profile?.displayName?.trim() || null };
});
