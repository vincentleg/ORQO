/**
 * Events (Phase 8) against the real database, as signed-in users under RLS:
 * tenant isolation of events and event targets, company reuse across events,
 * event provenance that never overwrites an older origin, fast capture into
 * the canonical Network contact / interaction model, explicit event
 * follow-ups that the canonical Next Best Action picks up, durable missed
 * targets and archived (never deleted) events.
 * Synthetic organizations only (created by this run's test users); no
 * provider is called. Refused by the safety guard unless a dedicated test
 * project is configured.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { nextBestAction, isoDay } from "@/lib/network/model";
import { createCompany, listCompanies } from "@/lib/server/repositories/companies";
import {
  addEventTarget,
  captureEncounter,
  createEvent,
  getEventDetail,
  listEventTargets,
  readEventContext,
  setEventArchived,
  setTargetReviewed,
  setTargetStatus,
} from "@/lib/server/repositories/events";
import { createFollowUp, getCompanyMemory, getNetworkCompany } from "@/lib/server/repositories/network-memory";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { addMember, cleanupTestData, createTestUser, type TestUser } from "../support/supabase";

let A: TestUser;
let V: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;
let eventA: string;
let eventA2: string;
let eventB: string;
let discovered: string;

beforeAll(async () => {
  await cleanupTestData();
  [A, V, B] = await Promise.all([createTestUser("p8-a"), createTestUser("p8-v"), createTestUser("p8-b")]);
  orgA = await createOrganization(A.db, { name: "P8 Org A" });
  orgB = await createOrganization(B.db, { name: "P8 Org B" });
  await addMember(orgA, V.id, "viewer");
  eventA = await createEvent(A.db, orgA, { name: "Fictional Summit", startsOn: "2026-11-10", endsOn: "2026-11-12", objective: "Find integration partners" });
  eventA2 = await createEvent(A.db, orgA, { name: "Fictional Expo", startsOn: "2027-03-01" });
  eventB = await createEvent(B.db, orgB, { name: "B Secret Event" });
  discovered = (await createCompany(A.db, orgA, { name: "Discovered Fictional", website: "https://discovered-fictional.example", networkOrigin: "discover", externalRef: "discover:00000000-0000-4000-8000-000000000001:discovered-fictional.example" })).id;
});
afterAll(cleanupTestData);

describe("tenant isolation", () => {
  test("B cannot read, target or capture into A's event", async () => {
    expect(await getEventDetail(B.db, orgA, eventA)).toBeNull();
    expect(await getEventDetail(B.db, orgB, eventA)).toBeNull();
    await expect(addEventTarget(B.db, orgB, eventA, { name: "X", website: "https://x-fictional.example" })).rejects.toThrow();
    await expect(addEventTarget(B.db, orgB, eventB, { companyId: discovered })).rejects.toThrow();
  });

  test("a viewer reads but cannot write", async () => {
    expect(await getEventDetail(V.db, orgA, eventA)).not.toBeNull();
    await expect(createEvent(V.db, orgA, { name: "Viewer event" })).rejects.toThrow();
  });
});

describe("company identity and provenance", () => {
  test("a new company created through an event records origin Event and that event", async () => {
    const r = await addEventTarget(A.db, orgA, eventA, { name: "New Fictional Ltd", website: "https://new-fictional.example" }, { priority: "high", why: "Integration fit" });
    expect(r.companyCreated).toBe(true);
    const c = await getNetworkCompany(A.db, orgA, r.companyId);
    expect(c?.origin).toBe("event");
    expect(c?.originEventId).toBe(eventA);
  });

  test("the same company at a second event is reused, and keeps its first event provenance", async () => {
    const r = await addEventTarget(A.db, orgA, eventA2, { name: "New Fictional", website: "https://www.new-fictional.example/" });
    expect(r.companyCreated).toBe(false);
    const c = await getNetworkCompany(A.db, orgA, r.companyId);
    expect(c?.originEventId).toBe(eventA);
    expect((await listCompanies(A.db, orgA)).filter((x) => x.website?.includes("new-fictional")).length).toBe(1);
  });

  test("an existing Discover company met at an event keeps origin Discover", async () => {
    await captureEncounter(A.db, orgA, eventA, { company: { companyId: discovered }, interaction: { occurredAt: new Date().toISOString(), title: "Met at the summit" } });
    const c = await getNetworkCompany(A.db, orgA, discovered);
    expect(c?.origin).toBe("discover");
    expect(c?.originEventId).toBeNull();
  });
});

describe("fast capture, follow-ups and NBA", () => {
  test("capture creates a canonical contact + interaction with the event, marks the target met, and creates no follow-up", async () => {
    const r = await captureEncounter(A.db, orgA, eventA, {
      company: { name: "Capture Fictional", website: "https://capture-fictional.example" },
      newContact: { name: "Alex Fictional", role: "CTO" },
      interaction: { occurredAt: new Date().toISOString(), title: "Met at the summit", summary: "Talked about EU rollout", outcome: "Interested", nextStep: "Send the brief" },
    });
    const memory = await getCompanyMemory(A.db, orgA, r.companyId);
    expect(memory.contacts.map((c) => c.name)).toEqual(["Alex Fictional"]);
    expect(memory.interactions[0]?.kind).toBe("event");
    expect(memory.interactions[0]?.eventId).toBe(eventA);
    expect(memory.followUps).toHaveLength(0);
    expect((await listEventTargets(A.db, orgA, { eventId: eventA })).find((t) => t.companyId === r.companyId)?.status).toBe("met");

    const followUpId = await createFollowUp(A.db, orgA, r.companyId, { title: "Send the brief", interactionId: r.interactionId }, { eventId: eventA });
    const after = await getCompanyMemory(A.db, orgA, r.companyId);
    const f = after.followUps.find((x) => x.id === followUpId);
    expect(f?.origin).toBe("interaction");
    expect(f?.eventId).toBe(eventA);
    const nba = nextBestAction({ stage: null, contacts: after.contacts, interactions: after.interactions, followUps: after.followUps, validationQuestion: null, today: isoDay(new Date()) });
    expect(nba.kind).toBe("follow_up");
  });

  test("missed targets stay after review; review counts are factual; the agent seam omits private notes", async () => {
    const r = await addEventTarget(A.db, orgA, eventA, { name: "Missed Fictional" }, { priority: "high", why: "secret why", prepNotes: "secret prep" });
    await setTargetStatus(A.db, orgA, r.targetId, "missed");
    await setTargetReviewed(A.db, orgA, r.targetId, true);
    const d = await getEventDetail(A.db, orgA, eventA);
    expect(d?.targets.find((t) => t.id === r.targetId)?.status).toBe("missed");
    const ctx = await readEventContext(A.db, orgA, eventA);
    expect(ctx?.review.missed).toBe(1);
    expect(JSON.stringify(ctx)).not.toMatch(/secret why|secret prep|Talked about EU rollout/);
  });

  test("an archived event is read-only and is not deleted", async () => {
    await setEventArchived(A.db, orgA, eventA2, true);
    await expect(addEventTarget(A.db, orgA, eventA2, { name: "Late Fictional" })).rejects.toThrow();
    expect((await getEventDetail(A.db, orgA, eventA2))?.event.archivedAt).not.toBeNull();
  });
});
