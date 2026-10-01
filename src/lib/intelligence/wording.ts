/**
 * Localized wording for relevance candidates (pure): template variables and
 * the validation question whose answer would most quickly confirm or kill an
 * opportunity. Shared by the Search UI and the agent result builder.
 */
import { conceptLabel } from "./concepts";
import type { Candidate } from "./relevance";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";

/** Template variables for a candidate: names, drivers, the own services and geographies the mechanism relies on. */
export function candidateVars(c: Candidate, target: string, own: string, locale: Locale): Record<string, string> {
  return {
    target,
    own,
    drivers: driversText(c.drivers.filter((d) => !c.ownServices.includes(d)), locale),
    services: driversText(c.ownServices, locale),
    geos: c.geographies.slice(0, 4).join(", ") || "—",
  };
}

/** The question whose answer would most quickly confirm or kill the opportunity. */
export function validationQuestion(c: Candidate, target: string, own: string, locale: Locale): string | null {
  const t = createTranslator(locale);
  if (c.narrative) return c.narrative.questions[0] ?? null;
  const key = c.validation[0];
  return key ? t(`analysis.validation.${key}`, candidateVars(c, target, own, locale)) : null;
}

export function driversText(drivers: string[], locale: Locale): string {
  return drivers
    .slice(0, 4)
    .map((d) => (d.startsWith("~") ? `“${d.slice(1)}”` : conceptLabel(d, locale)))
    .join(", ");
}

