import { describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE, LOCALES, isLocale } from "./config";
import { en } from "./messages/en";
import { fr } from "./messages/fr";
import { fromAcceptLanguage, negotiateLocale } from "./negotiate";
import { createTranslator } from "./translate";

function keys(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v as object, `${prefix}${k}.`)));
}

describe("locales", () => {
  test("English and French are the supported locales, English is the default", () => {
    expect([...LOCALES]).toEqual(["en", "fr"]);
    expect(DEFAULT_LOCALE).toBe("en");
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
  });

  test("French catalog has exactly the English keys, all non-empty", () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
    expect(keys(fr).every((k) => createTranslator("fr")(k as never).length > 0)).toBe(true);
  });
});

describe("translator", () => {
  test("translates and interpolates per locale", () => {
    expect(createTranslator("en")("auth.passwordHint", { min: 8 })).toBe("At least 8 characters.");
    expect(createTranslator("fr")("auth.passwordHint", { min: 8 })).toBe("Au moins 8 caractères.");
  });

  test("leaves unknown placeholders intact", () => {
    expect(createTranslator("en")("workspace.yourRole", {})).toBe("Your role: {role}");
  });
});

describe("negotiation", () => {
  test("profile preference beats cookie and browser", () => {
    expect(negotiateLocale({ profile: "fr", cookie: "en", acceptLanguage: "en-US" })).toBe("fr");
  });

  test("cookie beats browser when there is no profile", () => {
    expect(negotiateLocale({ cookie: "fr", acceptLanguage: "en-US,en;q=0.9" })).toBe("fr");
  });

  test("Accept-Language picks the highest-weighted supported language", () => {
    expect(fromAcceptLanguage("de-DE,de;q=0.9,fr-CA;q=0.8,en;q=0.5")).toBe("fr");
    expect(fromAcceptLanguage("es;q=1, en;q=0")).toBeUndefined();
  });

  test("falls back to the default locale", () => {
    expect(negotiateLocale({ profile: "xx", cookie: undefined, acceptLanguage: "ja" })).toBe("en");
  });
});
