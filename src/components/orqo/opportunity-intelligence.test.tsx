/**
 * Phase 11 Opportunity Intelligence brief: static render (no browser, no
 * database, no provider). FR and EN; fit, timing and relationship render in
 * separate sections; private context never leaks; the weak state is truthful.
 * Fictional data only.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { findOpportunityCandidates } from "@/lib/graph/opportunity/candidates";
import { snapshot } from "@/lib/graph/opportunity/fixtures";
import { buildProjection } from "@/lib/graph/opportunity/projection";
import { assess, companyIntelligence, fromGraph, relationshipFrom } from "@/lib/opportunity/intelligence";
import { OpportunityBrief, OpportunityIntelligenceCard } from "./opportunity-intelligence";

const candidate = findOpportunityCandidates(buildProjection(snapshot())).candidates.find((c) => c.rule === "capability_need")!;
const seeker = candidate.companies.find((c) => c.role === "seeker")!;

const relationship = relationshipFrom({
  company: { id: seeker.id, name: seeker.name, stage: "conversation" },
  contacts: [{ name: "Alex Example", isPrimary: true, createdAt: "2026-01-01", email: "alex@bright.example", phone: "+33 1 00 00 00 00", notes: "PRIVATE-NOTE" } as never],
  interactions: [{ occurredAt: "2026-09-20T10:00:00Z", summary: "PRIVATE-BODY" } as never],
  followUps: [],
  events: [{ event: { id: "e1", name: "Fictional Expo", startsOn: "2026-10-10" }, target: { status: "met", prepNotes: "PRIVATE-PREP" } as never }],
  today: "2026-09-30",
});
const brief = assess(fromGraph(candidate, "en"), { relationships: [relationship], signals: [{ id: "s9", companyId: seeker.id, companyName: seeker.name, headline: "Fictional expansion headline", kind: "geographic_expansion", publishedOn: "2026-09-12", epistemic: "fact" }] });

function section(html: string, testId: string): string {
  const start = html.indexOf(`data-testid="${testId}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

describe("Opportunity Intelligence brief", () => {
  test("EN: labelled as a connection worth investigating, with every section", () => {
    const html = renderToStaticMarkup(<OpportunityBrief brief={brief} locale="en" open />);
    for (const s of ["Connection worth investigating", "Why this could work", "Qualification", "Why now", "Relationship · private context", "What could break it", "What we don&#x27;t know", "Validate next", "Evidence", "How ORQO challenged it"]) expect(html).toContain(s);
    expect(html).not.toContain("Qualified opportunity");
  });

  test("signals appear under WHY NOW, events under RELATIONSHIP — never under fit", () => {
    const html = renderToStaticMarkup(<OpportunityBrief brief={brief} locale="en" open />);
    expect(section(html, "brief-why-now")).toContain("Fictional expansion headline");
    expect(section(html, "brief-why-fit")).not.toContain("Fictional expansion headline");
    expect(section(html, "brief-evidence")).not.toContain("Fictional expansion headline");
    expect(section(html, "brief-relationship")).toContain("Fictional Expo");
    expect(section(html, "brief-why-fit")).not.toContain("Fictional Expo");
    expect(section(html, "brief-evidence")).not.toContain("Fictional Expo");
  });

  test("private context never leaks; public evidence and private relationship stay apart", () => {
    const html = renderToStaticMarkup(<OpportunityBrief brief={brief} locale="en" open />);
    for (const secret of ["alex@bright.example", "+33", "PRIVATE-"]) expect(html).not.toContain(secret);
    expect(section(html, "brief-evidence")).not.toContain("Alex Example");
    expect(html).not.toMatch(/\d+\s?%|probability|revenue/i);
  });

  test("FR: the same brief is fully translated", () => {
    const fr = assess(fromGraph(candidate, "fr"), { relationships: [relationship], signals: [] });
    const html = renderToStaticMarkup(<OpportunityBrief brief={fr} locale="fr" open />);
    for (const s of ["Connexion à étudier", "Pourquoi cela pourrait fonctionner", "Pourquoi maintenant", "Ce que nous ne savons pas", "À valider ensuite", "Pourquoi maintenant"]) expect(html).toContain(s);
    for (const s of ["Why this could work", "Validate next", "What we don"]) expect(html).not.toContain(s);
  });

  test("weak/empty state: truthful, with what is known and what is missing", () => {
    const intel = companyIntelligence({ drafts: [], context: { relationships: [], signals: [] }, hasAnalysis: false, analysisStatus: null, hasGraphPattern: false });
    for (const locale of ["en", "fr"] as const) {
      const html = renderToStaticMarkup(<OpportunityIntelligenceCard intel={intel} locale={locale} searchHref="/workspace?q=x" profileHref={null} knownFacts={["Stage: Identified"]} />);
      expect(html).toContain('data-testid="intel-empty"');
      expect(html).not.toContain('data-testid="opportunity-brief"');
      expect(html).toContain(locale === "en" ? "not enough evidence yet" : "pas encore assez de preuves");
    }
  });
});
