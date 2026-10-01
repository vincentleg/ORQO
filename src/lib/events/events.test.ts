/**
 * Phase 8 — Events: pure, deterministic behavior (no database, no provider).
 * Fictional fixtures only.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AGENT_REGISTRY, CAPABILITIES } from "@/lib/agents/registry";
import { TOOLS } from "@/lib/agents/tools";
import { featureAccess } from "@/lib/entitlements/plans";
import { FOLLOW_UP_ORIGINS, NETWORK_ORIGINS, followUpOrigin, nextBestAction, type ContactView, type FollowUpView, type InteractionView } from "@/lib/network/model";
import { eventAgentDecision } from "./access";
import { eventExternalRef, resolveEventCompany, type KnownCompany } from "./identity";
import {
  canRemoveTarget,
  canTransitionTarget,
  eventAttention,
  eventPhase,
  groupEvents,
  missedTargets,
  prepareTarget,
  reviewCounts,
  reviewItems,
  suggestPriority,
  validEventDates,
  type EventActivity,
  type EventSummary,
  type EventTargetView,
  type EventView,
  type TargetContext,
} from "./model";

const ORG_COMPANY = (id: string, name: string, website: string | null, isOwnCompany = false): KnownCompany => ({ id, name, website, isOwnCompany });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const EVENT: EventView = {
  id: id(900),
  name: "Fictional Infrastructure Summit",
  description: "",
  startsOn: "2026-11-10",
  endsOn: "2026-11-12",
  location: "Lisbon",
  website: "https://summit-fictional.example",
  objectiveKind: "technology_partners",
  objective: "Find technology companies that may need a European integration partner.",
  topics: ["infrastructure"],
  archivedAt: null,
  createdAt: "2026-09-01T10:00:00Z",
};

function target(n: number, over: Partial<EventTargetView> = {}): EventTargetView {
  return {
    id: id(100 + n),
    eventId: EVENT.id,
    companyId: id(200 + n),
    companyName: `Fictional Co ${n}`,
    companyWebsite: null,
    companyStage: null,
    status: "targeted",
    priority: "medium",
    attendance: "unknown",
    why: "",
    prepNotes: "",
    reviewedAt: null,
    statusChangedAt: null,
    createdAt: "2026-09-02T10:00:00Z",
    ...over,
  };
}

function interaction(n: number, companyId: string, over: Partial<InteractionView> = {}): InteractionView {
  return { id: id(300 + n), companyId, contactId: null, kind: "event", occurredAt: "2026-11-11T10:00:00Z", title: "Met at the summit", summary: "", outcome: "", nextStep: "", createdAt: "2026-11-11T10:05:00Z", eventId: EVENT.id, ...over };
}

function followUp(n: number, companyId: string, over: Partial<FollowUpView> = {}): FollowUpView {
  return {
    id: id(400 + n),
    companyId,
    contactId: null,
    interactionId: null,
    title: "Send the integration brief",
    description: "",
    dueOn: null,
    status: "open",
    priority: "normal",
    origin: "event",
    assignedTo: null,
    closedAt: null,
    createdAt: "2026-11-13T09:00:00Z",
    eventId: EVENT.id,
    ...over,
  };
}

const CONTACT: ContactView = { id: id(500), name: "Alex Fictional", role: "CTO", email: null, phone: null, profileUrl: null, notes: "private note text", isPrimary: true, createdAt: "2026-09-01T00:00:00Z" };

const EMPTY_CTX: TargetContext = { stage: null, opportunities: 0, contacts: [], interactions: [], followUps: [], openSignals: [], validationQuestions: [], hasPublicAnalysis: false };

describe("event phase is derived from calendar dates", () => {
  test("upcoming / active (inclusive) / past, one-day events, undated", () => {
    expect(eventPhase(EVENT, "2026-11-09")).toBe("upcoming");
    expect(eventPhase(EVENT, "2026-11-10")).toBe("active");
    expect(eventPhase(EVENT, "2026-11-12")).toBe("active");
    expect(eventPhase(EVENT, "2026-11-13")).toBe("past");
    expect(eventPhase({ startsOn: "2026-11-10", endsOn: null }, "2026-11-10")).toBe("active");
    expect(eventPhase({ startsOn: "2026-11-10", endsOn: null }, "2026-11-11")).toBe("past");
    expect(eventPhase({ startsOn: null, endsOn: null }, "2026-11-11")).toBe("undated");
  });

  test("invalid dates are handled honestly, never repaired into a guess", () => {
    expect(eventPhase({ startsOn: "2026-02-30", endsOn: null }, "2026-11-11")).toBe("undated");
    expect(validEventDates(null, null)).toBe(true);
    expect(validEventDates("2026-11-10", null)).toBe(true);
    expect(validEventDates(null, "2026-11-10")).toBe(false);
    expect(validEventDates("2026-11-10", "2026-11-09")).toBe(false);
    expect(validEventDates("2026-13-01", null)).toBe(false);
  });

  test("landing groups: active, upcoming soonest first, past most recent first", () => {
    const s = (n: number, startsOn: string | null, endsOn: string | null): EventSummary => ({ event: { ...EVENT, id: id(n), startsOn, endsOn }, phase: eventPhase({ startsOn, endsOn }, "2026-11-11"), targets: 0, met: 0, missedHigh: 0, notRecorded: 0, openFollowUps: 0 });
    const g = groupEvents([s(1, "2026-12-01", null), s(2, "2026-11-20", null), s(3, "2026-10-01", null), s(4, "2026-11-01", null), s(5, null, null), s(6, "2026-11-10", "2026-11-12")]);
    expect(g.active.map((x) => x.event.id)).toEqual([id(6)]);
    expect(g.upcoming.map((x) => x.event.id)).toEqual([id(2), id(1)]);
    expect(g.past.map((x) => x.event.id)).toEqual([id(4), id(3)]);
    expect(g.undated.map((x) => x.event.id)).toEqual([id(5)]);
  });
});

describe("target lifecycle", () => {
  test("planned/targeted → met / missed / skipped; missed can still be met; reset to targeted always allowed", () => {
    expect(canTransitionTarget("planned", "targeted")).toBe(true);
    expect(canTransitionTarget("targeted", "met")).toBe(true);
    expect(canTransitionTarget("targeted", "missed")).toBe(true);
    expect(canTransitionTarget("targeted", "skipped")).toBe(true);
    expect(canTransitionTarget("missed", "met")).toBe(true);
    expect(canTransitionTarget("met", "missed")).toBe(false);
    expect(canTransitionTarget("met", "targeted")).toBe(true);
    expect(canTransitionTarget("met", "met")).toBe(false);
  });

  test("a target with recorded activity, or already met/missed, cannot be removed", () => {
    expect(canRemoveTarget({ status: "targeted" }, 0)).toBe(true);
    expect(canRemoveTarget({ status: "targeted" }, 1)).toBe(false);
    expect(canRemoveTarget({ status: "missed" }, 0)).toBe(false);
    expect(canRemoveTarget({ status: "met" }, 0)).toBe(false);
  });
});

describe("company identity: reuse, never duplicate", () => {
  const known = [ORG_COMPANY(id(1), "Fictional Rover Co", "https://www.rover-fictional.example"), ORG_COMPANY(id(2), "Quill Fictional", null), ORG_COMPANY(id(3), "My Own Fictional Co", "https://own-fictional.example", true)];

  test("reuses a known company by website domain, whatever name was typed", () => {
    expect(resolveEventCompany({ name: "Rover", website: "https://rover-fictional.example/about" }, known)).toEqual({ kind: "existing", companyId: id(1) });
  });

  test("reuses a known company by name (accents and case folded)", () => {
    expect(resolveEventCompany({ name: "quill  FICTIONAL", website: null }, known)).toEqual({ kind: "existing", companyId: id(2) });
  });

  test("the same name under a different website is ambiguous — not merged silently", () => {
    expect(resolveEventCompany({ name: "Fictional Rover Co", website: "https://other-rover.example" }, known)).toEqual({ kind: "ambiguous", companyId: id(1), name: "Fictional Rover Co" });
  });

  test("the organization's own company is never an event target", () => {
    expect(resolveEventCompany({ name: "Anything", website: "https://own-fictional.example" }, known)).toEqual({ kind: "own_company" });
  });

  test("an unknown company is created (provenance key unique per event and company)", () => {
    const r = resolveEventCompany({ name: "New Fictional Ltd", website: "https://new-fictional.example" }, known);
    expect(r).toEqual({ kind: "create", name: "New Fictional Ltd", website: "https://new-fictional.example", domain: "new-fictional.example" });
    expect(eventExternalRef(EVENT.id, { name: "New Fictional Ltd", domain: "new-fictional.example" })).toBe(`event:${EVENT.id}:new-fictional.example`);
    expect(eventExternalRef(EVENT.id, { name: "Société Fictive", domain: null })).toBe(`event:${EVENT.id}:name:societe-fictive`);
  });

  test("the same company added at a second event resolves to the same canonical record", () => {
    const afterFirstEvent = [...known, ORG_COMPANY(id(4), "New Fictional Ltd", "https://new-fictional.example")];
    expect(resolveEventCompany({ name: "New Fictional", website: "https://new-fictional.example" }, afterFirstEvent)).toEqual({ kind: "existing", companyId: id(4) });
  });
});

describe("provenance and follow-up origins", () => {
  test("Event is a Network origin; existing origins are kept", () => {
    expect([...NETWORK_ORIGINS]).toEqual(["search", "discover", "event", "manual", "referral", "existing"]);
  });

  test("follow-up origin 'event' is added without changing manual / interaction / signal", () => {
    expect([...FOLLOW_UP_ORIGINS]).toEqual(["manual", "interaction", "next_action", "signal", "event"]);
    expect(followUpOrigin({})).toBe("manual");
    expect(followUpOrigin({ interactionId: id(1), eventId: EVENT.id })).toBe("interaction");
    expect(followUpOrigin({ fromSignal: true })).toBe("signal");
    expect(followUpOrigin({ eventId: EVENT.id })).toBe("event");
  });

  test("an existing company is reused without any write that could overwrite its origin", () => {
    // The repository only CREATES with origin "event"; resolution of a known company yields its id and nothing else.
    const r = resolveEventCompany({ name: "Fictional Rover Co", website: null }, [ORG_COMPANY(id(1), "Fictional Rover Co", "https://rover-fictional.example")]);
    expect(r).toEqual({ kind: "existing", companyId: id(1) });
    const src = readFileSync(join(import.meta.dir, "..", "server", "repositories", "events.ts"), "utf8");
    expect(src).not.toMatch(/network_origin/);
    expect(src).not.toMatch(/from\("companies"\)\s*\.update/);
    expect(src).toMatch(/networkOrigin: "event", originEventId: eventId/);
  });

  test("the database keeps the first event provenance (never re-pointed)", () => {
    const sql = readFileSync(join(import.meta.dir, "..", "..", "..", "supabase", "migrations", "20261005090000_phase8_events.sql"), "utf8");
    expect(sql).toMatch(/new\.origin_event_id is not null and new\.origin_event_id is distinct from old\.origin_event_id[\s\S]*new\.origin_event_id := old\.origin_event_id/);
    expect(sql).toContain("check (origin in ('manual', 'interaction', 'next_action', 'signal', 'event'))");
  });
});

describe("explainable priority (no score)", () => {
  test("no recorded context → medium, said explicitly", () => {
    expect(suggestPriority(EMPTY_CTX, "")).toEqual({ priority: "medium", factors: ["no_context"] });
  });

  test("an active opportunity or a relevant open signal → high, with the factual reasons", () => {
    expect(suggestPriority({ ...EMPTY_CTX, opportunities: 1 }, "")).toEqual({ priority: "high", factors: ["active_opportunity"] });
    const s = suggestPriority({ ...EMPTY_CTX, openSignals: [{ headline: "Opens a European office", relevant: true }], hasPublicAnalysis: true }, "Integration partner fit");
    expect(s.priority).toBe("high");
    expect(s.factors).toEqual(["relevant_signal", "stated_reason", "public_analysis"]);
  });

  test("an open signal not assessed relevant does not raise priority", () => {
    expect(suggestPriority({ ...EMPTY_CTX, openSignals: [{ headline: "New product page", relevant: false }] }, "").priority).toBe("medium");
  });

  test("a company the team marked not relevant → low", () => {
    expect(suggestPriority({ ...EMPTY_CTX, stage: "not_relevant", opportunities: 1 }, "x")).toEqual({ priority: "low", factors: ["not_relevant"] });
  });
});

describe("deterministic preparation", () => {
  test("no known contact → identify who to meet; unknowns are explicit, attendance never assumed", () => {
    const p = prepareTarget({ why: "", attendance: "unknown" }, EMPTY_CTX);
    expect(p.questions).toEqual([{ kind: "identify_contact" }]);
    expect(p.unknowns).toEqual(["no_public_analysis", "no_contact", "attendance_unconfirmed", "no_reason", "no_history"]);
  });

  test("questions are grounded in recorded facts only (Company B scenario)", () => {
    const companyB = id(202);
    const p = prepareTarget(
      { why: "May need a European deployment partner", attendance: "meeting_booked" },
      {
        ...EMPTY_CTX,
        stage: "conversation",
        contacts: [CONTACT],
        interactions: [interaction(1, companyB, { kind: "call", eventId: null, nextStep: "Share deployment references" })],
        followUps: [followUp(1, companyB, { origin: "manual", eventId: null, title: "Send the integration brief" })],
        openSignals: [{ headline: "Announces a new office in Rotterdam", relevant: true }],
        validationQuestions: ["Do they integrate in-house or with partners?"],
        hasPublicAnalysis: true,
      },
    );
    expect(p.questions).toEqual([
      { kind: "meet_contact", name: "Alex Fictional", role: "CTO" },
      { kind: "open_follow_up", title: "Send the integration brief" },
      { kind: "signal", headline: "Announces a new office in Rotterdam" },
      { kind: "validate", question: "Do they integrate in-house or with partners?" },
    ]);
    expect(p.unknowns).toEqual([]);
    // The private contact note is never turned into a question or a public statement.
    expect(JSON.stringify(p.questions)).not.toContain("private note text");
  });

  test("a previous next step is offered when no follow-up is open", () => {
    const p = prepareTarget({ why: "x", attendance: "expected" }, { ...EMPTY_CTX, contacts: [CONTACT], interactions: [interaction(2, id(203), { nextStep: "Ask for the RFP timeline" })] });
    expect(p.questions).toContainEqual({ kind: "previous_next_step", step: "Ask for the RFP timeline" });
  });
});

describe("review: factual counts, durable missed targets", () => {
  const met = target(1, { status: "met", priority: "high" });
  const missedHigh = target(2, { status: "missed", priority: "high" });
  const missedLow = target(3, { status: "missed", priority: "low" });
  const unrecorded = target(4, { status: "targeted" });
  const skipped = target(5, { status: "skipped" });
  const i1 = interaction(1, met.companyId, { contactId: CONTACT.id, nextStep: "Send the integration brief" });
  const base: EventActivity = { targets: [met, missedHigh, missedLow, unrecorded, skipped], interactions: [i1], contactsAdded: 1, followUps: [], newCompanies: 2 };

  test("counts are what was recorded, nothing more", () => {
    expect(reviewCounts(base)).toEqual({ targets: 5, met: 1, missed: 2, skipped: 1, notRecorded: 1, companiesMet: 1, newCompanies: 2, contactsAdded: 1, interactions: 1, openFollowUps: 0, completedFollowUps: 0 });
  });

  test("after the event: next step without follow-up, missed targets (high first), unrecorded outcomes; no follow-up is created", () => {
    const items = reviewItems(base, "past");
    expect(items.map((x) => [x.reason, x.companyId])).toEqual([
      ["missed_high_priority", missedHigh.companyId],
      ["next_step_without_follow_up", met.companyId],
      ["missed", missedLow.companyId],
      ["outcome_not_recorded", unrecorded.companyId],
    ]);
    expect(base.followUps).toHaveLength(0);
  });

  test("before the event ends, a targeted company is not reported as 'no outcome'", () => {
    expect(reviewItems(base, "active").some((x) => x.reason === "outcome_not_recorded")).toBe(false);
  });

  test("an explicit follow-up resolves the review item; a reviewed missed target leaves the queue but stays visible", () => {
    const withFollowUp: EventActivity = { ...base, followUps: [followUp(1, met.companyId, { interactionId: i1.id, origin: "interaction" }), followUp(2, missedHigh.companyId)] };
    const items = reviewItems(withFollowUp, "past");
    expect(items.some((x) => x.reason === "next_step_without_follow_up")).toBe(false);
    expect(items.some((x) => x.companyId === missedHigh.companyId)).toBe(false);
    const reviewed: EventActivity = { ...base, targets: base.targets.map((x) => (x.id === missedLow.id ? { ...x, reviewedAt: "2026-11-14T00:00:00Z" } : x)) };
    expect(reviewItems(reviewed, "past").some((x) => x.companyId === missedLow.companyId)).toBe(false);
    expect(missedTargets(reviewed.targets).map((x) => x.id)).toEqual([missedHigh.id, missedLow.id]);
    expect(reviewCounts(reviewed).missed).toBe(2);
  });

  test("landing attention: upcoming without targets, missed high priority, past with open follow-ups or unrecorded outcomes", () => {
    const sum = (over: Partial<EventSummary>): EventSummary => ({ event: EVENT, phase: "upcoming", targets: 0, met: 0, missedHigh: 0, notRecorded: 0, openFollowUps: 0, ...over });
    expect(eventAttention([sum({})]).map((x) => x.reason)).toEqual(["upcoming_without_targets"]);
    expect(eventAttention([sum({ phase: "past", targets: 3, missedHigh: 1, openFollowUps: 2, notRecorded: 1 })]).map((x) => x.reason)).toEqual(["missed_high_priority", "past_open_follow_ups", "outcome_not_recorded"]);
    expect(eventAttention([sum({ event: { ...EVENT, archivedAt: "2026-12-01T00:00:00Z" } })])).toEqual([]);
  });
});

describe("Next Best Action stays canonical", () => {
  test("an open follow-up created from an event becomes the NBA through the unchanged Phase 6 rules", () => {
    const c = id(210);
    const a = nextBestAction({ stage: "conversation", contacts: [CONTACT], interactions: [interaction(9, c, { nextStep: "Send the brief" })], followUps: [followUp(9, c, { origin: "event" })], validationQuestion: "Q?", today: "2026-11-14" });
    expect(a.kind).toBe("follow_up");
  });

  test("without a follow-up, the event interaction's next step is offered (not created)", () => {
    const c = id(211);
    const i = interaction(10, c, { nextStep: "Send the brief" });
    expect(nextBestAction({ stage: null, contacts: [CONTACT], interactions: [i], followUps: [], validationQuestion: null, today: "2026-11-14" })).toEqual({ kind: "interaction_next_step", interaction: i });
  });
});

describe("Event Agent, entitlements and cost", () => {
  test("the Events workspace is Free; automated event work is not unlocked", () => {
    expect(featureAccess("free", "events.workspace").state).toBe("available");
    expect(featureAccess("free", "events.automation").state).toBe("locked");
    expect(featureAccess("pro", "events.automation").state).toBe("coming_soon");
    expect(featureAccess("free", "agents.event").state).toBe("locked");
  });

  test("the existing Event Agent is reused and stays coming soon, with no execution budget", () => {
    expect(AGENT_REGISTRY.event.status).toBe("coming_soon");
    expect(AGENT_REGISTRY.event.missionTypes).toEqual([]);
    expect(AGENT_REGISTRY.event.limits.maxModelCalls).toBe(0);
    expect(AGENT_REGISTRY.event.limits.maxExternalRequests).toBe(0);
    expect(Object.keys(AGENT_REGISTRY).filter((k) => k.toLowerCase().includes("event"))).toEqual(["event"]);
  });

  test("autonomous event work is refused on Free, on Business and in operator preview while the agent is not built", () => {
    expect(eventAgentDecision({ entitledPlan: "free", preview: false })).toEqual({ ok: false, reason: "agent_unavailable" });
    expect(eventAgentDecision({ entitledPlan: "free", preview: true })).toEqual({ ok: false, reason: "agent_unavailable" });
    expect(eventAgentDecision({ entitledPlan: "business", preview: false })).toEqual({ ok: false, reason: "agent_unavailable" });
  });

  test("the event_analysis seam is read-only, internal and free", () => {
    expect(CAPABILITIES.event_analysis.tools).toContain("read_event_context");
    for (const toolId of CAPABILITIES.event_analysis.tools) {
      const tool = TOOLS[toolId];
      expect(tool.risk).toBe("read");
      expect(tool.externalNetwork).toBe(false);
      expect(tool.variableCost).toBe(false);
      expect(tool.limits.maxModelCalls).toBe(0);
      expect(tool.limits.maxExternalRequests).toBe(0);
    }
  });

  test("no Events code path can reach a provider, a model, the fetcher, a URL fetch or an outbound message", () => {
    const root = join(import.meta.dir, "..", "..");
    const files = [
      ...readdirSync(join(root, "lib/events")).map((f) => join(root, "lib/events", f)),
      join(root, "lib/server/repositories/events.ts"),
      join(root, "app/actions/events.ts"),
      join(root, "components/orqo/events.tsx"),
      join(root, "components/orqo/event-forms.tsx"),
      join(root, "app/workspace/events/page.tsx"),
      join(root, "app/workspace/events/[eventId]/page.tsx"),
      join(root, "app/workspace/events/[eventId]/targets/[targetId]/page.tsx"),
    ].filter((f) => statSync(f).isFile() && !f.endsWith(".test.ts"));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/research\/(providers|brave|fetcher|service|execute)|ai\/openrouter|configuredProviders|createPageFetcher|\bfetch\(|nylas|sendMail|mailto:|runPreparedResearch|startMission/i);
    }
  });
});
