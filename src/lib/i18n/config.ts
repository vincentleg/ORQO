/** Canonical locale identifiers (BCP 47 language subtags). Mirrors the `locale_code` domain in the database. */
export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Remembers the language for signed-out visitors and before the profile loads. */
export const LOCALE_COOKIE = "orqo-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
