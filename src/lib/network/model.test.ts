import { describe, expect, test } from "bun:test";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { TOOLS } from "@/lib/agents/tools";
import {
  addDays,
  buildTimeline,
  discoverRunId,
  effectiveOrigin,
  followUpBucket,
  groupFollowUps,
  isIsoDay,
  isoDay,
  nextBestAction,
  primaryContact,
  type ContactView,
  type FollowUpView,
  type InteractionView,
  type NetworkEventView,
} from "./model";

const TODAY = "2026-10-03";
const RUN = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

const contact = (over: Partial<ContactView> = {}): ContactView => ({ id: "c1", name: "Ada Example", role: "CTO", email: null, phone: null, profileUrl: null, notes: "", isPrimary: false, createdAt: "2026-10-01T10:00:00.000Z", ...over });
const interaction = (over: Partial<InteractionView> = {}): InteractionView => ({
  id: "i1",
  companyId: "co",
  contactId: null,
  kind: "call",
  occurredAt: "2026-10-02T09:00:00.000Z",
  title: "Intro call",
  summary: "",
  outcome: "",
  nextStep: "",
  createdAt: "2026-10-02T09:05:00.000Z",
  ...over,
});
const followUp = (over: Partial<FollowUpView> = {}): FollowUpView => ({
  id: "f1",
  companyId: "co",
  contactId: null,
  interactionId: null,
  title: "Send brief",
  description: "",
  dueOn: TODAY,
  status: "open",
  priority: "normal",
  origin: "manual",
  assignedTo: null,
  closedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
const base = { stage: null, contacts: [], interactions: [], followUps: [], validationQuestion: null, today: TODAY } as const;

describe("dates", () => {
  test("calendar days are validated strictly and added without time-zone drift", () => {
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-10-3")).toBe(false);
    expect(addDays("2026-12-29", 6)).toBe("2027-01-04");
    expect(isoDay(new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-03");
    expect(isoDay(new Date("2026-10-03T23:30:00Z"), "Europe/Paris")).toBe("2026-10-04");
  });
});

describe("follow-up buckets", () => {
  test("overdue, today, this week (6 days ahead), later, undated and completed", () => {
    expect(followUpBucket({ status: "open", dueOn: "2026-10-02" }, TODAY)).toBe("overdue");
    expect(followUpBucket({ status: "open", dueOn: TODAY }, TODAY)).toBe("today");
    expect(followUpBucket({ status: "open", dueOn: "2026-10-09" }, TODAY)).toBe("this_week");
    expect(followUpBucket({ status: "open", dueOn: "2026-10-10" }, TODAY)).toBe("later");
    expect(followUpBucket({ status: "open", dueOn: null }, TODAY)).toBe("later");
    expect(followUpBucket({ status: "done", dueOn: "2026-09-01" }, TODAY)).toBe("completed");
    expect(followUpBucket({ status: "dismissed", dueOn: null }, TODAY)).toBe("completed");
  });

  test("groups are ordered by due day, then priority", () => {
    const g = groupFollowUps(
      [followUp({ id: "a", dueOn: "2026-10-05" }), followUp({ id: "b", dueOn: "2026-10-04", priority: "low" }), followUp({ id: "c", dueOn: "2026-10-04", priority: "high" }), followUp({ id: "d", status: "done", closedAt: "2026-10-02T00:00:00.000Z" })],
      TODAY,
    );
    expect(g.this_week.map((f) => f.id)).toEqual(["c", "b", "a"]);
    expect(g.completed.map((f) => f.id)).toEqual(["d"]);
    expect(g.overdue).toEqual([]);
  });
});

describe("origin", () => {
  test("recorded origin wins; Discover/Search provenance is used only when nothing was recorded; otherwise unknown", () => {
    expect(effectiveOrigin("referral", `discover:${RUN}:a.example`)).toBe("referral");
    expect(effectiveOrigin(null, `discover:${RUN}:a.example`)).toBe("discover");
    expect(effectiveOrigin(null, "search:a.example")).toBe("search");
    expect(effectiveOrigin(null, "fixture-42")).toBeNull();
    expect(effectiveOrigin(null, null)).toBeNull();
    expect(discoverRunId(`discover:${RUN}:a.example`)).toBe(RUN);
    expect(discoverRunId("discover:not-a-uuid:a.example")).toBeNull();
    expect(discoverRunId("search:a.example")).toBeNull();
  });
});

describe("next best action (deterministic)", () => {
  test("nothing recorded → identify a contact (never an outreach action)", () => {
    expect(nextBestAction(base).kind).toBe("add_contact");
  });

  test("a contact but no interaction → record the first contact", () => {
    const a = nextBestAction({ ...base, contacts: [contact()] });
    expect(a).toEqual({ kind: "record_first_contact", contact: contact() });
  });

  test("an interaction with a next step surfaces it, until a follow-up tracks it", () => {
    const i = interaction({ nextStep: "Send the technical brief" });
    expect(nextBestAction({ ...base, contacts: [contact()], interactions: [i] }).kind).toBe("interaction_next_step");
    const tracked = followUp({ interactionId: i.id, status: "done", closedAt: "2026-10-02T12:00:00.000Z" });
    expect(nextBestAction({ ...base, contacts: [contact()], interactions: [i], followUps: [tracked] }).kind).toBe("none");
  });

  test("only the LATEST interaction's next step counts", () => {
    const old = interaction({ id: "old", occurredAt: "2026-09-01T00:00:00.000Z", nextStep: "Old step" });
    const recent = interaction({ id: "new", occurredAt: "2026-10-02T00:00:00.000Z", nextStep: "" });
    expect(nextBestAction({ ...base, contacts: [contact()], interactions: [old, recent] }).kind).toBe("none");
  });

  test("an open follow-up wins, nearest due first; completing it updates the action", () => {
    const later = followUp({ id: "later", dueOn: "2026-10-20" });
    const soon = followUp({ id: "soon", dueOn: "2026-10-01" });
    const a = nextBestAction({ ...base, contacts: [contact()], followUps: [later, soon] });
    expect(a.kind === "follow_up" && a.followUp.id).toBe("soon");
    expect(a.kind === "follow_up" && a.bucket).toBe("overdue");
    const b = nextBestAction({ ...base, contacts: [contact()], followUps: [later, { ...soon, status: "done", closedAt: "2026-10-03T08:00:00.000Z" }] });
    expect(b.kind === "follow_up" && b.followUp.id).toBe("later");
    const c = nextBestAction({ ...base, contacts: [contact()], interactions: [interaction()], followUps: [{ ...later, status: "done", closedAt: "x" }, { ...soon, status: "dismissed", closedAt: "y" }] });
    expect(c.kind).toBe("none");
  });

  test("an unresolved public-analysis question is surfaced before qualification only", () => {
    expect(nextBestAction({ ...base, validationQuestion: "Do they outsource assembly?" })).toEqual({ kind: "validate", question: "Do they outsource assembly?" });
    expect(nextBestAction({ ...base, stage: "qualified", validationQuestion: "Do they outsource assembly?" }).kind).toBe("add_contact");
  });

  test("dormant / not relevant → no action proposed, unless a person created a follow-up", () => {
    expect(nextBestAction({ ...base, stage: "not_relevant" })).toEqual({ kind: "inactive", stage: "not_relevant" });
    expect(nextBestAction({ ...base, stage: "dormant", followUps: [followUp()] }).kind).toBe("follow_up");
  });

  test("primary contact is preferred, else the earliest", () => {
    const a = contact({ id: "a", createdAt: "2026-10-02T00:00:00.000Z" });
    const b = contact({ id: "b", createdAt: "2026-10-01T00:00:00.000Z" });
    expect(primaryContact([a, b])?.id).toBe("b");
    expect(primaryContact([a, { ...b, isPrimary: false }, { ...a, id: "p", isPrimary: true }])?.id).toBe("p");
    expect(primaryContact([])).toBeNull();
  });
});

describe("timeline", () => {
  test("newest first, from real rows only, with 'added' anchored at the company's creation", () => {
    const ev = (id: string, at: string, kind: NetworkEventView["kind"] = "stage_changed"): NetworkEventView => ({ id, kind, subjectId: null, from: null, to: "contacted", occurredAt: at });
    const entries = buildTimeline({
      addedAt: "2026-09-01T00:00:00.000Z",
      origin: null,
      interactions: [interaction({ occurredAt: "2026-10-02T09:00:00.000Z" })],
      events: [ev("1", "2026-10-03T00:00:00.000Z"), ev("2", "2026-09-15T00:00:00.000Z", "contact_added")],
    });
    expect(entries.map((e) => e.kind)).toEqual(["event", "interaction", "event", "added"]);
    expect(entries.at(-1)).toEqual({ kind: "added", at: "2026-09-01T00:00:00.000Z", origin: null });
  });

  test("a company with no Phase 6 activity has only its real 'added' entry — nothing is reconstructed", () => {
    expect(buildTimeline({ addedAt: "2026-09-01T00:00:00.000Z", origin: "discover", interactions: [], events: [] })).toEqual([{ kind: "added", at: "2026-09-01T00:00:00.000Z", origin: "discover" }]);
  });
});

describe("agent seam", () => {
  test("relationship context is a read-only, internal, free tool, and no agent that holds it is executable", () => {
    const tool = TOOLS.read_relationship_context;
    expect(tool.risk).toBe("read");
    expect(tool.externalNetwork).toBe(false);
    expect(tool.variableCost).toBe(false);
    expect(tool.limits.maxModelCalls).toBe(0);
    expect(AGENT_REGISTRY.relationship.status).toBe("coming_soon");
    expect(AGENT_REGISTRY.followUp.status).toBe("coming_soon");
  });
});
