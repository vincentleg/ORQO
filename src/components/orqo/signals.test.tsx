/**
 * Phase 7 signal card: static render (no browser, no database, no provider).
 * Public evidence and private context stay visibly separate; an unknown
 * publication date reads as unknown; FR and EN both render; the record form
 * never uses a native empty date input (Safari paints today's date in it).
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnCompanyContext } from "@/lib/intelligence/types";
import type { SignalView } from "@/lib/signals/model";
import { assessSignal, reevaluate, type RelationshipMemory } from "@/lib/signals/relevance";

// Static render only: the server actions are never invoked, so they are stubbed (they import server-only modules).
const noop = async () => ({});
mock.module("@/app/actions/signals", () => ({ recordSignalAction: noop, setSignalStatusAction: noop, createFollowUpFromSignalAction: noop }));
mock.module("@/app/actions/network", () => ({ addSearchedCompanyAction: noop, updateRelationshipAction: noop, saveContactAction: noop, recordInteractionAction: noop, createFollowUpAction: noop, setFollowUpStatusAction: noop }));
const { RecordSignalForm } = await import("./signal-forms");
const { SignalCard } = await import("./signals");

const S: SignalView = {
  id: "00000000-0000-4000-8000-000000000001",
  companyId: "00000000-0000-4000-8000-0000000000c1",
  kind: "geographic_expansion",
  origin: "manual",
  headline: "Fictional Rover Co announces a new office in Rotterdam",
  detail: "",
  excerpt: null,
  field: null,
  concepts: ["europe"],
  epistemic: "fact",
  evidenceQuality: "moderate",
  sourceUrl: "https://rover-fictional.example/news/rotterdam",
  sourceLabel: "rover-fictional.example",
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
const OWN: OwnCompanyContext = { name: "Atelier Fictif", website: null, summary: "System integration", offerings: ["System integration"], customerSegments: [], markets: [], geographies: ["Europe"], soughtCapabilities: [], partnershipGoals: [] };
const PRIVATE_NOTE = "They might consider international expansion in 1–2 years.";
const MEMORY: RelationshipMemory = {
  stage: "conversation",
  reason: "",
  interactions: [{ id: "00000000-0000-4000-8000-0000000000a1", companyId: S.companyId, contactId: null, kind: "meeting", occurredAt: "2026-02-10T14:00:00.000Z", title: "Intro meeting", summary: PRIVATE_NOTE, outcome: "", nextStep: "", createdAt: "2026-02-10T15:00:00.000Z" }],
  followUps: [],
};

function render(locale: "en" | "fr", memory: RelationshipMemory | null) {
  const a = assessSignal(S, OWN, memory);
  return renderToStaticMarkup(
    <SignalCard locale={locale} signal={S} assessment={a} reevaluation={reevaluate(S, a, memory)} company={{ id: S.companyId, name: "Fictional Rover Co" }} ownName="Atelier Fictif" stageLabel="Conversation" canWrite organizationId="00000000-0000-4000-8000-0000000000aa" contacts={[]} today="2026-10-01" showCompany />,
  );
}

describe("signal card", () => {
  test("EN: public headline, source link, unknown date, explicit unknowns, private context labeled and never quoted", () => {
    const html = render("en", MEMORY);
    expect(html).toContain("Fictional Rover Co announces a new office in Rotterdam");
    expect(html).toContain('href="https://rover-fictional.example/news/rotterdam"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("Publication date unknown");
    expect(html).toContain("Recorded by your team from a public source");
    expect(html).toContain("a change alone does not establish a need");
    expect(html).toContain('data-testid="signal-private-context"');
    expect(html).toContain("Intro meeting");
    // The private note's text is never shown as evidence.
    expect(html).not.toContain("international expansion in 1–2 years");
    expect(html).toContain("This relationship may deserve attention earlier than planned.");
    expect(html).toContain("ORQO never contacts anyone");
  });

  test("without private memory there is no private section", () => {
    expect(render("en", null)).not.toContain('data-testid="signal-private-context"');
  });

  test("FR renders", () => {
    const html = render("fr", MEMORY);
    expect(html).toContain("Date de publication inconnue");
    expect(html).toContain("Contexte privé");
    expect(html).toContain("Expansion géographique");
  });

  test("record form: the publication date is plain optional text, never a native date input", () => {
    // The form opens on click; render its source-level guarantee instead.
    const src = readFileSync(join(import.meta.dir, "signal-forms.tsx"), "utf8");
    expect(src).toMatch(/name="publishedOn" type="text"/);
    expect(src).not.toMatch(/name="publishedOn"[^>]*type="date"/);
    expect(renderToStaticMarkup(<RecordSignalForm locale="en" organizationId="o" companyId="c" />)).toContain("Record a public change");
  });
});
