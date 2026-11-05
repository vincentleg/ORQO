"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translate";
import { safeNextPath, signInWithPassword, signUpWithPassword, type AuthBackend } from "@/lib/server/auth/flows";
import { authenticate, consumeRateLimit, createAccount, createSession, deleteSession, SESSION_COOKIE } from "@/lib/server/auth/accounts";
import { getRequestLocale, rememberLocale } from "@/lib/server/i18n";
import { getProfile } from "@/lib/server/repositories/tenancy";
import { userDb } from "@/lib/server/db/client";
import { errorSummary, recordOperation } from "@/lib/server/observability";
import { secureCookies } from "@/lib/server/site";

export interface AuthFormState {
  error?: MessageKey;
  /** Kept for the form components' existing "check your email" state; no longer produced (no email provider). */
  confirmationSentTo?: string;
}

const backend: AuthBackend = {
  authenticate,
  createAccount,
  allow: consumeRateLimit,
};

/** A per-client throttling key. On Vercel `x-vercel-forwarded-for` is set by the platform, not the caller. */
async function clientKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0];
  return ip?.trim() || "unknown";
}

async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", expires: expiresAt });
}

/** Database or configuration failure → an honest "temporarily unavailable", logged at error level. */
function unavailable(action: string, e: unknown): AuthFormState {
  console.error(`[orqo] ${action} unavailable`, errorSummary(e));
  recordOperation({ operation: `auth.${action}`, outcome: "unavailable", errorCategory: "backend" });
  return { error: "auth.unavailable" };
}

export async function signInAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  let userId: string;
  try {
    const result = await signInWithPassword(backend, { email: form.get("email"), password: form.get("password") }, await clientKey());
    if (!result.ok) {
      // Aggregate auth-failure category only (e.g. invalidCredentials); never the email.
      recordOperation({ operation: "auth.sign_in", outcome: "denied", errorCategory: String(result.error).replace(/^auth\./, "") });
      return { error: result.error };
    }
    userId = result.userId;
    await startSession(userId);
    const profile = await getProfile(userDb(userId), userId).catch(() => null);
    if (profile) await rememberLocale(profile.locale);
  } catch (e) {
    return unavailable("sign_in", e);
  }
  redirect(safeNextPath(form.get("next")));
}

export async function signUpAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const requested = form.get("locale");
  const locale = isLocale(requested) ? requested : await getRequestLocale();
  try {
    const result = await signUpWithPassword(
      backend,
      { email: form.get("email"), password: form.get("password"), displayName: form.get("displayName") || undefined, locale },
      await clientKey(),
    );
    if (!result.ok) {
      recordOperation({ operation: "auth.sign_up", outcome: "denied", errorCategory: String(result.error).replace(/^auth\./, "") });
      return { error: result.error };
    }
    await startSession(result.userId);
    recordOperation({ operation: "auth.sign_up", outcome: "succeeded" });
  } catch (e) {
    return unavailable("sign_up", e);
  }
  redirect("/onboarding");
}

export async function signOutAction(): Promise<void> {
  const store = await cookies();
  await deleteSession(store.get(SESSION_COOKIE)?.value).catch((e) => console.error("[orqo] sign-out cleanup failed", errorSummary(e)));
  store.delete(SESSION_COOKIE);
  redirect("/");
}
