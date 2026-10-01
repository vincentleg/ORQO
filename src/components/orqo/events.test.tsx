/**
 * Phase 8 Events UI: static render (no browser, no database, no provider).
 * Private event context stays labeled private and never appears as public
 * evidence; FR and EN render; event dates reuse the Safari-safe optional-day
 * field (no date is shown or submitted unless picked); fast capture offers
 * no outreach. Fictional fixtures only.
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { prepareTarget, suggestPriority, type EventSummary, type EventView, type TargetContext } from "@/lib/events/model";
import type { ContactView, FollowUpView } from "@/lib/network/model";

// Static render only: the server actions are never invoked, so they are stubbed (they import server-only modules).
const noop = async () => ({});
mock.module("@/app/actions/events", () => ({
  addEventTargetAction: noop,
  captureEncounterAction: noop,
  createEventAction: noop,
  createEventFollowUpAction: noop,
  removeEventTargetAction: noop,
  setEventArchivedAction: noop,
  setTargetReviewedAction: noop,
  setTargetStatusAction: noop,
  updateEventAction: noop,
  updateEventTargetAction: noop,
}));
mock.module("@/app/actions/network", () => ({ addSearchedCompanyAction: noop, updateRelationshipAction: noop, saveContactAction: noop, recordInteractionAction: noop, createFollowUpAction: noop, setFollowUpStatusAction: noop }));
const { CaptureForm, TargetStatusButtons } = await import("./event-forms");
const { EventCard, PreparationView } = await import("./events");
const { DueDateField } = await import("./follow-up-fields");
const { FollowUpItem } = await import("./network");

/** renderToStaticMarkup escapes apostrophes; compare against readable text. */
const text = (html: string) => html.replaceAll("&#x27;", "'");
const read = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "..", rel), "utf8");

const EVENT: EventView = {
  id: "00000000-0000-4000-8000-000000000900",
  name: "Fictional Infrastructure Summit",
  description: "",
  startsOn: "2026-11-10",
  endsOn: "2026-11-12",
  location: "Lisbon",
  website: null,
  objectiveKind: "technology_partners",
  objective: "Find technology companies that may need a European integration partner.",
  topics: [],
  archivedAt: null,
  createdAt: "2026-09-01T10:00:00Z",
};

const PRIVATE_NOTE = "Confidential: budget mentioned over dinner";
const CONTACT: ContactView = { id: "00000000-0000-4000-8000-000000000500", name: "Alex Fictional", role: "CTO", email: "alex@fictional.example", phone: null, profileUrl: null, notes: PRIVATE_NOTE, isPrimary: true, createdAt: "2026-09-01T00:00:00Z" };
const CTX: TargetContext = {
  stage: "conversation",
  opportunities: 0,
  contacts: [CONTACT],
  interactions: [],
  followUps: [],
  openSignals: [{ headline: "Announces a new office in Rotterdam", relevant: true }],
  validationQuestions: ["Do they integrate in-house or with partners?"],
  hasPublicAnalysis: true,
};

function prepHtml(locale: "en" | "fr") {
  const prep = prepareTarget({ why: "May need a European deployment partner", attendance: "unknown" }, CTX);
  return renderToStaticMarkup(<PreparationView locale={locale} prep={prep} suggestion={suggestPriority(CTX, prep.why)} priority="medium" />);
}

describe("preparation view", () => {
  test("EN: private reason labeled private; each question names its basis; unknowns explicit; private notes never shown", () => {
    const html = prepHtml("en");
    expect(html).toMatch(/data-testid="prep-why"[\s\S]*Private[\s\S]*May need a European deployment partner/);
    expect(html).toContain("Plan to meet Alex Fictional (CTO).");
    expect(html).toContain("Ask how this public change affects their plans: “Announces a new office in Rotterdam”");
    expect(html).toContain("Validate: Do they integrate in-house or with partners?");
    expect(html).toContain("Inference to validate");
    expect(html).toContain("Whether they attend — ORQO never assumes it.");
    expect(html).toContain("Suggested priority: High priority");
    expect(html).toContain("Your priority: Medium priority");
    expect(html).not.toContain(PRIVATE_NOTE);
    expect(html).not.toContain("alex@fictional.example");
  });

  test("FR renders the same preparation", () => {
    const html = text(prepHtml("fr"));
    expect(html).toContain("Pourquoi les rencontrer");
    expect(html).toContain("Privé");
    expect(html).toContain("Prévoyez de rencontrer Alex Fictional (CTO).");
    expect(html).toContain("À valider : Do they integrate in-house or with partners?");
    expect(html).toContain("S'ils seront présents — ORQO ne le suppose jamais.");
    expect(html).not.toContain(PRIVATE_NOTE);
  });

  test("the target page keeps private memory and public context in separately labeled cards", () => {
    const page = read("src/app/workspace/events/[eventId]/targets/[targetId]/page.tsx");
    expect(page).toMatch(/data-testid="target-known"[\s\S]*<PrivateLabel/);
    expect(page).toMatch(/data-testid="target-public"[\s\S]*<PublicLabel/);
    // Contact channels and notes are not rendered on the preparation page.
    expect(page).not.toMatch(/c\.email|c\.phone|c\.notes|profileUrl/);
  });
});

describe("event dates reuse the Safari-safe optional day", () => {
  test("an empty start date shows 'No date', submits nothing and renders no native date input", () => {
    const html = renderToStaticMarkup(<DueDateField locale="en" name="startsOn" label="Start date" emptyLabel="No date" />);
    expect(html).toContain('name="startsOn" value=""');
    expect(html).toContain("No date");
    expect(html).not.toContain('type="date"');
    expect(html).not.toMatch(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
  });

  test("a recorded date is shown as that exact day, with Clear", () => {
    const html = renderToStaticMarkup(<DueDateField locale="fr" name="endsOn" label="Date de fin" emptyLabel="Sans date" defaultValue="2026-11-12" />);
    expect(html).toMatch(/type="date"[^>]*name="endsOn"[^>]*value="2026-11-12"|name="endsOn"[^>]*value="2026-11-12"/);
    expect(html).toContain('data-testid="due-date-clear"');
  });

  test("the follow-up due date keeps its Phase 6 defaults", () => {
    const html = renderToStaticMarkup(<DueDateField locale="fr" />);
    expect(html).toContain('name="dueOn" value=""');
    expect(html).toContain("Sans échéance");
  });

  test("event forms submit dates only through normalizeDueOn (empty → not set, never today)", () => {
    const actions = read("src/app/actions/events.ts");
    expect(actions).toContain('startsOn: normalizeDueOn(form.get("startsOn"))');
    expect(actions).toContain('endsOn: normalizeDueOn(form.get("endsOn"))');
    expect(read("src/components/orqo/event-forms.tsx")).not.toMatch(/type="date"/);
  });
});

describe("fast capture", () => {
  const html = renderToStaticMarkup(
    <CaptureForm
      locale="en"
      organizationId="00000000-0000-4000-8000-0000000000a1"
      event={{ id: EVENT.id, name: EVENT.name }}
      targets={[{ id: "00000000-0000-4000-8000-000000000201", name: "Fictional Co B" }]}
      companies={[
        { id: "00000000-0000-4000-8000-000000000201", name: "Fictional Co B" },
        { id: "00000000-0000-4000-8000-000000000202", name: "Fictional Co C" },
      ]}
      contacts={[]}
      initiallyOpen
    />,
  );

  test("one compact form: company, contact, what happened, outcome, next step", () => {
    for (const name of ['name="companyId"', 'name="contactId"', 'name="summary"', 'name="outcome"', 'name="nextStep"', 'name="title"']) expect(html).toContain(name);
    expect(html).toContain('value="Met at Fictional Infrastructure Summit"');
    expect(html).toMatch(/<optgroup label="Targets">[\s\S]*Fictional Co B[\s\S]*<optgroup label="Your Network">[\s\S]*Fictional Co C/);
  });

  test("no outreach and no automatic follow-up", () => {
    expect(html).toContain("ORQO never looks people up or contacts anyone.");
    expect(html).toContain("You decide later whether it becomes a follow-up.");
    expect(html).not.toMatch(/send (an )?(email|message)|linkedin|mailto:/i);
    expect(html).not.toContain('name="dueOn"');
  });

  test("FR renders", () => {
    const fr = text(renderToStaticMarkup(<CaptureForm locale="fr" organizationId="o" event={{ id: EVENT.id, name: EVENT.name }} targets={[]} companies={[]} contacts={[]} initiallyOpen />));
    expect(fr).toContain("Rencontre à Fictional Infrastructure Summit");
    expect(fr).toContain("Ce qui s'est passé");
  });
});

describe("landing, statuses and follow-up provenance", () => {
  const summary: EventSummary = { event: EVENT, phase: "upcoming", targets: 12, met: 7, missedHigh: 1, notRecorded: 0, openFollowUps: 3 };

  test("event cards show factual counts in EN and FR — no score", () => {
    const en = renderToStaticMarkup(<EventCard locale="en" summary={summary} />);
    expect(en).toContain("12 targets · 7 met · 3 open follow-ups");
    expect(en).toContain("Find technology partners");
    expect(en).not.toMatch(/%|score/i);
    expect(renderToStaticMarkup(<EventCard locale="fr" summary={summary} />)).toContain("12 cibles · 7 rencontrées · 3 relances ouvertes");
  });

  test("status actions only offer allowed moves", () => {
    const met = renderToStaticMarkup(<TargetStatusButtons locale="en" organizationId="o" target={{ id: "t", status: "met" }} />);
    expect(met).toContain("Reset to targeted");
    expect(met).not.toContain(">Missed<");
    const targeted = renderToStaticMarkup(<TargetStatusButtons locale="en" organizationId="o" target={{ id: "t", status: "targeted" }} />);
    for (const s of ["Met", "Missed", "Skipped", "Planned"]) expect(targeted).toContain(`>${s}<`);
  });

  test("a follow-up created from an event says so, in EN and FR", () => {
    const f: FollowUpView = { id: "f1", companyId: "c1", contactId: null, interactionId: null, title: "Send the brief", description: "", dueOn: null, status: "open", priority: "normal", origin: "event", assignedTo: null, closedAt: null, createdAt: "2026-11-13T00:00:00Z", eventId: EVENT.id };
    expect(renderToStaticMarkup(<FollowUpItem locale="en" followUp={f} today="2026-11-14" organizationId="o" canWrite={false} currentUserId="u" />)).toContain("From an event");
    expect(text(renderToStaticMarkup(<FollowUpItem locale="fr" followUp={f} today="2026-11-14" organizationId="o" canWrite={false} currentUserId="u" />))).toContain("Issue d'un événement");
  });
});
