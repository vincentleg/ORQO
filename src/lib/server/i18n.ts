import "server-only";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { negotiateLocale } from "@/lib/i18n/negotiate";
import { secureCookies } from "@/lib/server/site";

/**
 * Locale for this request. A signed-in user's saved preference wins; the
 * cookie mirrors it (written on sign-in and on change) so layouts can resolve
 * it without an extra database round trip.
 */
export async function getRequestLocale(profileLocale?: Locale): Promise<Locale> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return negotiateLocale({ profile: profileLocale, cookie: c.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get("accept-language") });
}

export async function rememberLocale(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365, httpOnly: false, secure: secureCookies() });
}
