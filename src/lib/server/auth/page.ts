import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { MessageKey } from "@/lib/i18n/translate";
import { AppError, type AppErrorCode } from "@/lib/server/errors";
import { listMyOrganizations, type OrganizationMembership } from "@/lib/server/repositories/tenancy";
import { getAuthContext, type AuthContext } from "./context";
import { errorSummary } from "@/lib/server/observability";
import { recordDenial } from "@/lib/server/http";
import { recordOperation } from "@/lib/server/observability";

/** Remembers which workspace the user last opened. A preference only: membership is re-checked on every request. */
export const ACTIVE_ORG_COOKIE = "orqo-org";

export async function requirePageAuth(currentPath: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    // Aggregate only: no path, no identity.
    recordOperation({ operation: "auth.page_redirect", outcome: "denied", errorCategory: "unauthenticated" });
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }
  return ctx;
}

export interface WorkspaceContext extends AuthContext {
  active: OrganizationMembership;
  organizations: OrganizationMembership[];
}

/** The signed-in user's active workspace; sends users without one to onboarding. */
export async function requireWorkspace(currentPath: string): Promise<WorkspaceContext> {
  const ctx = await requirePageAuth(currentPath);
  const organizations = await listMyOrganizations(ctx.db, ctx.user.id);
  if (organizations.length === 0) redirect("/onboarding");
  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active = organizations.find((o) => o.organizationId === preferred) ?? organizations[0];
  return { ...ctx, active, organizations };
}

const MESSAGE_FOR: Partial<Record<AppErrorCode, MessageKey>> = {
  forbidden: "errors.forbidden",
  not_found: "errors.notFound",
  conflict: "errors.conflict",
  invalid_input: "errors.invalidInput",
  rate_limited: "errors.rateLimited",
  unavailable: "errors.unavailable",
};

/** Message key for a Server Action failure. Unexpected errors are logged, never shown. */
export function actionErrorKey(e: unknown, action: string): MessageKey {
  recordDenial(e, `action:${action}`);
  if (e instanceof AppError) return MESSAGE_FOR[e.code] ?? "common.genericError";
  console.error(`[orqo] action ${action} failed`, errorSummary(e));
  return "common.genericError";
}
