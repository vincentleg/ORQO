import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/** Best supported locale from an Accept-Language header, honouring q-values. */
export function fromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((x) => x.lang && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked.find((x) => isLocale(x.lang))?.lang as Locale | undefined;
}

/** Resolution order: saved profile preference, then cookie, then browser, then default. */
export function negotiateLocale(input: { profile?: unknown; cookie?: unknown; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.profile)) return input.profile;
  if (isLocale(input.cookie)) return input.cookie;
  return fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}
