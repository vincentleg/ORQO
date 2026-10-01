/**
 * Phase 7 human-review finding: "Your offer includes …" must only ever quote
 * what the organization's STORED profile declares. Previously the build-type
 * fit printed lexicon concept labels ("Manufacturing", "Assembly,
 * configuration & integration", "Deployment & support"), matched by alias
 * from the profile text, which overstated the offer. Fictional fixtures only;
 * static render; no database, no provider.
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { conceptLabel } from "@/lib/intelligence/concepts";
import { BUILD_SERVICES } from "@/lib/intelligence/relevance";
import type { OwnCompanyContext } from "@/lib/intelligence/types";
import { nextBestAction } from "@/lib/network/model";
import type { SignalView } from "@/lib/signals/model";
import { assessSignal, reevaluate, type RelationshipMemory } from "@/lib/signals/relevance";

const noop = async () => ({});
mock.module("@/app/actions/signals", () => ({ recordSignalAction: noop, setSignalStatusAction: noop, createFollowUpFromSignalAction: noop }));
mock.module("@/app/actions/network", () => ({ addSearchedCompanyAction: noop, updateRelationshipAction: noop, saveContactAction: noop, recordInteractionAction: noop, createFollowUpAction: noop, setFollowUpStatusAction: noop }));
const { SignalCard } = await import("./signals");

const COMPANY = "00000000-0000-4000-8000-0000000000c7";
const S: SignalView = {
  id: "00000000-0000-4000-8000-000000000071",
  companyId: COMPANY,
  kind: "geographic_expansion",
  origin: "manual",
  headline: "Fictional Vega Compute announces commercial expansion in Europe",
  detail: "",
  excerpt: null,
  field: null,
  concepts: ["europe"],
  epistemic: "fact",
  evidenceQuality: "moderate",
  sourceUrl: "https://vega-fictional.example/news/europe",
  sourceLabel: "vega-fictional.example",
  sourceAuthority: "official",
  publishedOn: null,
  retrievedAt: null,
  previousResearchedAt: null,
  previousConcepts: [],
  status: "new",
  statusChangedAt: null,
  followUpId: null,
  firstSeenAt: "2026-10-01T08:00:00.000Z",
  lastSeenAt: "2026-10-01T08:00:00.000Z",
};

/** Offers A/B/C/D written by a person; none of them says manufacturing, assembly or support. */
const OFFERS = ["Intégration de systèmes hardware et software", "Industrialisation de produits technologiques", "Déploiement et logistique en Europe", "Accompagnement de partenaires technologiques"];
const OWN: OwnCompanyContext = {
  name: "Orbis Fictive",
  website: null,
  summary: "Orbis Fictive aide les entreprises technologiques à déployer leurs produits en Europe.",
  offerings: OFFERS,
  customerSegments: ["Entreprises technologiques B2B"],
  markets: ["Edge AI", "Hardware B2B"],
  geographies: ["France", "Europe"],
  soughtCapabilities: ["Partenariats technologiques et commerciaux"],
  partnershipGoals: [],
};
const PRIVATE_NOTE = "Fictional private note: they may expand to Europe later.";
const MEMORY: RelationshipMemory = {
  stage: "conversation",
  reason: "",
  interactions: [{ id: "00000000-0000-4000-8000-0000000000a7", companyId: COMPANY, contactId: null, kind: "meeting", occurredAt: "2026-09-10T14:00:00.000Z", title: "Fictional intro", summary: PRIVATE_NOTE, outcome: "", nextStep: "Revisit when the European expansion is concrete", createdAt: "2026-09-10T15:00:00.000Z" }],
  followUps: [],
};

function render(locale: "en" | "fr", own: OwnCompanyContext | null, signal: SignalView = S, memory: RelationshipMemory | null = MEMORY) {
  const a = assessSignal(signal, own, memory);
  return renderToStaticMarkup(
    <SignalCard locale={locale} signal={signal} assessment={a} reevaluation={reevaluate(signal, a, memory)} company={{ id: COMPANY, name: "Fictional Vega Compute" }} ownName={own?.name ?? null} stageLabel="Conversation" canWrite organizationId="00000000-0000-4000-8000-0000000000aa" contacts={[]} today="2026-10-01" showCompany />,
  );
}

/** The items quoted in the "your stated offering includes" sentence, or null if absent. */
function quotedOffers(html: string, locale: "en" | "fr"): string[] | null {
  const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
  const m = locale === "fr" ? /Votre offre déclarée comprend (.*?)\. Ce type/.exec(text) : /Your stated offering includes (.*?)\. This kind/.exec(text);
  if (!m) return null;
  return [...m[1].matchAll(locale === "fr" ? /« (.*?) »/g : /“(.*?)”/g)].map((x) => x[1]);
}

const BUILD_LABELS = BUILD_SERVICES.flatMap((k) => [conceptLabel(k, "en"), conceptLabel(k, "fr")]);

describe("own offer is quoted from the stored profile only", () => {
  test("1 · offers A/B/C/D can never produce 'your offer includes' anything else (EN and FR)", () => {
    for (const locale of ["fr", "en"] as const) {
      const offers = quotedOffers(render(locale, OWN), locale);
      expect(offers).not.toBeNull();
      expect(offers!.length).toBeGreaterThan(0);
      for (const o of offers!) expect(OFFERS).toContain(o);
    }
  });

  test("2 · no lexicon / generic build-service label leaks into the offer sentence", () => {
    for (const locale of ["fr", "en"] as const) {
      const html = render(locale, OWN);
      const sentence = (quotedOffers(html, locale) ?? []).join(" | ");
      for (const label of BUILD_LABELS) if (!OFFERS.includes(label)) expect(sentence).not.toContain(label);
      // The exact strings reported in review never appear as an offer.
      expect(html).not.toMatch(/comprend[^.]*(Fabrication|Assemblage|Déploiement et support)/);
      expect(html).not.toMatch(/includes[^.]*(Manufacturing|Assembly, configuration|Deployment &amp; support)/);
    }
  });

  test("3 · incomplete profile: no declared offering → no 'your offer includes', even if the summary mentions build work", () => {
    const summaryOnly: OwnCompanyContext = { ...OWN, offerings: [], summary: "Fictional summary mentioning hardware assembly, manufacturing and deployment." };
    const a = assessSignal(S, summaryOnly, null);
    expect(a.reasons.some((r) => r.dimension === "capability_fit" && r.build)).toBe(false);
    for (const locale of ["fr", "en"] as const) expect(quotedOffers(render(locale, summaryOnly, S, null), locale)).toBeNull();
    // Offers that are not build-type never trigger the build sentence either.
    const nonBuild: OwnCompanyContext = { ...OWN, offerings: ["Études de marché"], summary: "" };
    expect(quotedOffers(render("fr", nonBuild, S, null), "fr")).toBeNull();
    // A direct fit quotes profile items as written, never a lexicon label for the organization's side.
    const direct = assessSignal({ ...S, kind: "partnership", concepts: ["assembly_integration"] }, OWN, null).reasons.find((r) => r.dimension === "capability_fit");
    expect(direct?.ownTerms).toEqual(["Intégration de systèmes hardware et software"]);
  });

  test("4 · geography alone can make a signal relevant without inventing a service need", () => {
    const geoOnly: OwnCompanyContext = { name: "Geo Fictive", website: null, summary: "", offerings: [], customerSegments: [], markets: [], geographies: ["Europe"], soughtCapabilities: [], partnershipGoals: [] };
    const a = assessSignal(S, geoOnly, null);
    expect(a.reasons.map((r) => r.dimension)).toContain("geography");
    expect(a.reasons.some((r) => r.dimension === "capability_fit")).toBe(false);
    expect(a.state).not.toBe("no_clear_link");
    expect(a.unknowns).toContain("need_unproven");
  });

  test("5 · the unknown stays explicit: a public change does not prove the need", () => {
    expect(render("en", OWN)).toContain("a change alone does not establish a need");
  });

  test("6 · private context stays private: the note body is never rendered as public evidence", () => {
    for (const locale of ["fr", "en"] as const) expect(render(locale, OWN)).not.toContain(PRIVATE_NOTE);
    const a = assessSignal(S, OWN, MEMORY);
    for (const r of a.reasons) expect(r.ownTerms ?? []).not.toContain(PRIVATE_NOTE);
  });

  test("7 · unknown publication date: publication date vs first-seen date are two distinct statements", () => {
    const fr = render("fr", OWN);
    expect(fr).toContain("La date de publication reste inconnue. ORQO connaît uniquement la date à laquelle ce signal a été vu pour la première fois.");
    expect(fr).not.toContain("affiche à la place le jour");
    const en = render("en", OWN);
    expect(en).toContain("The publication date remains unknown. ORQO only knows when it first saw this signal.");
    expect(en).not.toContain("shows the day it first saw it instead");
  });

  test("8 · Phase 6 Next Best Action is untouched by signals", () => {
    const nba = nextBestAction({ stage: "conversation", contacts: [], interactions: MEMORY.interactions, followUps: [], validationQuestion: null, today: "2026-10-01" });
    expect(nba.kind).toBe("interaction_next_step");
    const model = readFileSync(join(import.meta.dir, "..", "..", "lib", "network", "model.ts"), "utf8");
    expect(model).not.toMatch(/from "@\/lib\/signals/);
  });
});
