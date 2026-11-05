/**
 * Sign-in / sign-up logic, independent of Next.js so it is unit-testable with a fake backend. Error results
 * are message keys, never raw text.
 *
 * Recovery (Nov 2026): the backend is ORQO's own account store (accounts.ts) instead of Supabase Auth.
 * - Throttling: per client and per email for sign-in; per client and a global daily cap for sign-up, so a
 *   free-tier database cannot be flooded with accounts.
 * - Sign-up policy: ORQO_SIGNUP=closed refuses new accounts (default: open).
 * - Email confirmation: there is no email provider (none is free without an account), so accounts are usable
 *   immediately and the address is NOT verified. This is disclosed in the product and the release notes.
 */
import { z } from "zod";
import { isLocale, type Locale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translate";

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

export type AuthFlowResult = { ok: true; kind: "signed-in"; userId: string } | { ok: false; error: MessageKey };

/** What the flows need from the account store. */
export interface AuthBackend {
  authenticate(email: string, password: string): Promise<string | null>;
  createAccount(input: { email: string; password: string; displayName?: string; locale: Locale }): Promise<string | null>;
  /** Counts one attempt; false when the limit is exceeded. */
  allow(bucket: string, key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export const AUTH_LIMITS = {
  signInPerEmail: { limit: 10, windowSeconds: 900 },
  signInPerClient: { limit: 50, windowSeconds: 900 },
  signUpPerClient: { limit: 5, windowSeconds: 3600 },
} as const;

export function signUpPolicy(env: Record<string, string | undefined> = process.env): { open: boolean; dailyCap: number; perClientHourly: number } {
  const positive = (v: string | undefined, fallback: number) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
  return {
    open: env.ORQO_SIGNUP !== "closed",
    dailyCap: positive(env.ORQO_SIGNUP_DAILY_CAP, 50),
    perClientHourly: positive(env.ORQO_SIGNUP_PER_CLIENT_HOURLY, AUTH_LIMITS.signUpPerClient.limit),
  };
}

export async function signInWithPassword(backend: AuthBackend, raw: unknown, clientKey: string): Promise<AuthFlowResult> {
  const input = SignInInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "auth.invalidInput" };
  const email = input.data.email.trim().toLowerCase();
  const { signInPerClient: c, signInPerEmail: e } = AUTH_LIMITS;
  if (!(await backend.allow("sign_in_client", clientKey, c.limit, c.windowSeconds)) || !(await backend.allow("sign_in_email", email, e.limit, e.windowSeconds))) {
    return { ok: false, error: "auth.rateLimited" };
  }
  const userId = await backend.authenticate(email, input.data.password);
  return userId ? { ok: true, kind: "signed-in", userId } : { ok: false, error: "auth.invalidCredentials" };
}

export async function signUpWithPassword(backend: AuthBackend, raw: unknown, clientKey: string, env: Record<string, string | undefined> = process.env): Promise<AuthFlowResult> {
  const policy = signUpPolicy(env);
  if (!policy.open) return { ok: false, error: "auth.signUpClosed" };
  const input = SignUpInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "auth.invalidInput" };
  const { email, password, displayName, locale } = input.data;
  const s = AUTH_LIMITS.signUpPerClient;
  if (!(await backend.allow("sign_up_client", clientKey, policy.perClientHourly, s.windowSeconds)) || !(await backend.allow("sign_up_global", "all", policy.dailyCap, 86_400))) {
    return { ok: false, error: "auth.rateLimited" };
  }
  const userId = await backend.createAccount({ email: email.trim().toLowerCase(), password, displayName: displayName || undefined, locale });
  if (userId) return { ok: true, kind: "signed-in", userId };
  // Already registered: the right password simply signs in; otherwise one neutral message.
  const existing = await backend.authenticate(email, password);
  return existing ? { ok: true, kind: "signed-in", userId: existing } : { ok: false, error: "auth.emailUnavailable" };
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
