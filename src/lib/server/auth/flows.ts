/**
 * Sign-in / sign-up logic, independent of Next.js so it is unit-testable with
 * a fake auth client. Error results are message keys, never raw provider text,
 * and sign-up never reveals whether an email is already registered.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isLocale, type Locale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translate";

type Auth = SupabaseClient["auth"];

export const PASSWORD_MIN = 8;

export const SignInInput = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});

export const SignUpInput = z.object({
  email: z.email().max(320),
  password: z.string().min(PASSWORD_MIN).max(200),
  displayName: z.string().trim().max(120).optional(),
  locale: z.custom<Locale>(isLocale),
});

export type AuthFlowResult =
  | { ok: true; kind: "signed-in"; userId: string }
  | { ok: true; kind: "confirmation-required"; email: string }
  | { ok: false; error: MessageKey };

interface ProviderError {
  code?: string;
  status?: number;
}

function mapError(error: ProviderError): MessageKey {
  if (error.code === "invalid_credentials") return "auth.invalidCredentials";
  if (error.code === "email_not_confirmed") return "auth.emailNotConfirmed";
  if (error.status === 429 || error.code?.startsWith("over_")) return "auth.rateLimited";
  if (error.code === "weak_password" || error.code === "validation_failed") return "auth.invalidInput";
  return "common.genericError";
}

export async function signInWithPassword(auth: Pick<Auth, "signInWithPassword">, raw: unknown): Promise<AuthFlowResult> {
  const input = SignInInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "auth.invalidInput" };
  const { data, error } = await auth.signInWithPassword(input.data);
  if (error || !data.user) return { ok: false, error: error ? mapError(error) : "common.genericError" };
  return { ok: true, kind: "signed-in", userId: data.user.id };
}

export async function signUpWithPassword(auth: Pick<Auth, "signUp">, raw: unknown, emailRedirectTo: string): Promise<AuthFlowResult> {
  const input = SignUpInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "auth.invalidInput" };
  const { email, password, displayName, locale } = input.data;
  const { data, error } = await auth.signUp({
    email,
    password,
    options: { emailRedirectTo, data: { locale, ...(displayName && { display_name: displayName }) } },
  });
  if (error) return { ok: false, error: mapError(error) };
  // With email confirmation enabled there is no session until the link is opened.
  // Supabase returns the same shape for already-registered emails, so this does not leak account existence.
  if (!data.session || !data.user) return { ok: true, kind: "confirmation-required", email };
  return { ok: true, kind: "signed-in", userId: data.user.id };
}

/**
 * Only same-site relative paths; anything else becomes the fallback (prevents open redirects).
 * Control characters and whitespace are refused outright: URL parsers strip tab/CR/LF, so "/\t/evil.example"
 * would otherwise collapse to the protocol-relative "//evil.example". As a second check, the path must still
 * resolve to the same origin and keep its own path.
 */
export function safeNextPath(next: unknown, fallback = "/workspace"): string {
  if (typeof next !== "string" || next.length > 2048 || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(next)) return fallback;
  const base = "https://orqo.invalid";
  let resolved: URL;
  try {
    resolved = new URL(next, base);
  } catch {
    return fallback;
  }
  if (resolved.origin !== base || !resolved.pathname.startsWith("/") || resolved.pathname.startsWith("//")) return fallback;
  return next;
}
