import { DEFAULT_LOCALE, type Locale } from "./config";
import { en, type Messages } from "./messages/en";
import { fr } from "./messages/fr";

const CATALOGS: Record<Locale, Messages> = { en, fr };

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Dot-path key of any message, e.g. "auth.signInTitle". Checked at compile time. */
export type MessageKey = Leaves<Messages>;

export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

function lookup(catalog: Messages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Returns `t(key, vars)`; missing keys fall back to the default locale, then to the key itself. */
export function createTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale];
  return (key, vars) => {
    const template = lookup(catalog, key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key) ?? key;
    return vars ? template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : template;
  };
}

export function catalogFor(locale: Locale): Messages {
  return CATALOGS[locale];
}
