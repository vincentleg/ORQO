/**
 * Phase 16A dossier UI: static render (no browser, no database, no provider).
 * - "No credible new opportunity" reads as a confident, useful result, in English and French;
 * - weak ideas appear only as considered, never with a Track action;
 * - Track appears only on credible scenarios, and only when actions are allowed;
 * - the relationship question appears once, for a remembered company.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { understandCompany } from "@/lib/understanding";
import { companyDossier } from "@/lib/understanding/dossier";
import * as F from "@/lib/understanding/fixtures";
import type { Validation } from "@/lib/understanding/types";

// Static render only: the server actions are never invoked, so they are stubbed (they import server-only modules).
const noop = async () => ({});
mock.module("@/app/actions/opportunities", () => ({ trackOpportunityAction: noop, setTrackedStatusAction: noop, answerRelationshipAction: noop }));
mock.module("@/app/actions/workspace", () => ({ validateUnderstandingAction: noop }));
const { DossierView } = await import("./dossier");

type Fx = ReturnType<typeof F.fixtureProfile>;
const party = (fx: Fx) => ({ name: fx.profile.name, understanding: understandCompany({ companyName: fx.profile.name, website: fx.profile.website, intelligence: fx, validations: [] }) });
const said = (value: string): Validation => ({ kind: "answer", facet: "relationship_role", itemKey: null, value, createdAt: "2026-10-02T00:00:00.000Z" });
const actions = (over: Partial<Parameters<typeof DossierView>[0]["actions"] & object> = {}) => ({
  organizationId: "00000000-0000-4000-8000-000000000001",
  companyId: "00000000-0000-4000-8000-000000000002",
  q: null,
  tracked: {},
  canWrite: true,
  locale: "en" as const,
  ...over,
});

describe("No credible new opportunity", () => {
  test.each([
    ["en", "No credible new opportunity", "Why Kestrel Compute still matters", "What would change this", "Your relationship today", "Kestrel Compute supplies Arvenor Systems"],
    [
      "fr",
      "Pas de nouvelle opportunité crédible",
      "Pourquoi Kestrel Compute compte quand même",
      "Ce qui changerait cette conclusion",
      "Votre relation aujourd'hui",
      "Kestrel Compute fournit Arvenor Systems",
    ],
  ] as const)("%s: confident, explained, with what would change it", (locale, title, matters, change, rel, supplies) => {
    const d = companyDossier(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER));
    const html = renderToStaticMarkup(<DossierView dossier={d} locale={locale} reportHref={null} actions={actions({ locale })} />);
    expect(html).toContain('data-testid="dossier-negative"');
    for (const s of [title, matters, change, rel, supplies]) expect(html).toContain(s.replaceAll("'", "&#x27;"));
    expect(html).toContain('data-testid="negative-reasons"');
    // Not an error, not an empty state, not a failed generation.
    expect(html).not.toContain('role="alert"');
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/error|erreur|failed|échec/i);
    // Said once, not repeated in the executive summary.
    expect(html.split(title.replaceAll("'", "&#x27;")).length - 1).toBe(2); // the verdict line and the result's heading
    expect(text.split(locale === "en" ? "useful answer" : "réponse utile").length - 1).toBe(1);
    // Weak ideas are only considered, never trackable.
    expect(html).toContain('data-testid="dossier-considered"');
    expect(html).not.toContain('data-testid="track-opportunity"');
    expect(html).not.toContain('data-testid="dossier-scenarios"');
  });
});

describe("Track and the relationship question", () => {
  test("Track appears on credible scenarios only, and only when the user may write", () => {
    const d = companyDossier(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER_OUTSOURCING));
    expect(d.verdict).toBe("opportunity");
    const html = renderToStaticMarkup(<DossierView dossier={d} locale="en" reportHref={null} actions={actions()} />);
    expect(html.match(/data-testid="track-opportunity"/g)?.length).toBe(d.scenarios.length + d.novel.length);
    expect(html).toContain("Why this is new");
    expect(renderToStaticMarkup(<DossierView dossier={d} locale="en" reportHref={null} actions={actions({ canWrite: false })} />)).not.toContain("track-opportunity");
    expect(renderToStaticMarkup(<DossierView dossier={d} locale="en" reportHref={null} />)).not.toContain("track-opportunity"); // the report
    const tracked = renderToStaticMarkup(
      <DossierView dossier={d} locale="en" reportHref={null} actions={actions({ tracked: { "contract_production:own": "00000000-0000-4000-8000-000000000003" } })} />,
    );
    expect(tracked).toContain('href="/workspace/opportunities/00000000-0000-4000-8000-000000000003"');
  });

  test("the relationship question is shown once for a remembered company, then never again", () => {
    const ask = companyDossier(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER));
    expect(renderToStaticMarkup(<DossierView dossier={ask} locale="en" reportHref={null} actions={actions()} />)).toContain('data-testid="relationship-question"');
    expect(renderToStaticMarkup(<DossierView dossier={ask} locale="en" reportHref={null} actions={actions({ companyId: null, q: "kestrel.example" })} />)).not.toContain("relationship-question");
    const answered = companyDossier(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER), { validations: [said("supplier")], networkStage: null });
    const html = renderToStaticMarkup(<DossierView dossier={answered} locale="fr" reportHref={null} actions={actions({ locale: "fr" })} />);
    expect(html).not.toContain("relationship-question");
    expect(html).toContain("Indiqué par vous");
  });
});
