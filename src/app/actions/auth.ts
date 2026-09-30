"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translate";
import { safeNextPath, signInWithPassword, signUpWithPassword } from "@/lib/server/auth/flows";
import { getRequestLocale, rememberLocale } from "@/lib/server/i18n";
import { getProfile } from "@/lib/server/repositories/tenancy";
import { createSupabaseServerClient } from "@/lib/server/supabase/server";

export interface AuthFormState {
  error?: MessageKey;
  confirmationSentTo?: string;
}

export async function signInAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const db = await createSupabaseServerClient();
  const result = await signInWithPassword(db.auth, { email: form.get("email"), password: form.get("password") });
  if (!result.ok) return { error: result.error };
  if (result.kind === "signed-in") {
    const profile = await getProfile(db, result.userId).catch(() => null);
    if (profile) await rememberLocale(profile.locale);
  }
  redirect(safeNextPath(form.get("next")));
}

export async function signUpAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const h = await headers();
  // Supabase only honours redirect URLs on the project's allow-list; others fall back to the Site URL.
  const origin = h.get("origin") ?? `http://${h.get("host") ?? "localhost:3000"}`;
  const requested = form.get("locale");
  const locale = isLocale(requested) ? requested : await getRequestLocale();
  const db = await createSupabaseServerClient();
  const result = await signUpWithPassword(
    db.auth,
    { email: form.get("email"), password: form.get("password"), displayName: form.get("displayName") || undefined, locale },
    `${origin}/auth/callback?next=/onboarding`,
  );
  if (!result.ok) return { error: result.error };
  if (result.kind === "confirmation-required") return { confirmationSentTo: result.email };
  redirect("/onboarding");
}

export async function signOutAction(): Promise<void> {
  const db = await createSupabaseServerClient();
  await db.auth.signOut({ scope: "local" });
  redirect("/");
}
