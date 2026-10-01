/**
 * Network relationship memory (Phase 6) against the real database, as
 * signed-in users under RLS: relationship metadata and history, contacts,
 * interactions, follow-ups, tenant isolation, viewer read-only access,
 * append-only history, and Search → Add to Network without duplicates.
 * Synthetic organizations only (created by this run's test users); no
 * provider is called.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { STRONG } from "@/lib/discovery/fixtures";
import { nextBestAction } from "@/lib/network/model";
import { addSearchedCompany } from "@/lib/server/network/search";
import { createCompany, listCompanies } from "@/lib/server/repositories/companies";
import {
  createFollowUp,
  createNetworkContact,
  getCompanyMemory,
  getNetworkCompany,
  readRelationshipContext,
  recordInteraction,
  setFollowUpStatus,
  updateNetworkContact,
  updateRelationship,
} from "@/lib/server/repositories/network-memory";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { addMember, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

let A: TestUser;
let V: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;
let companyA: string;
let companyB: string;
let contactA: string;

beforeAll(async () => {
  await cleanupTestData();
  [A, V, B] = await Promise.all([createTestUser("p6-a"), createTestUser("p6-v"), createTestUser("p6-b")]);
  orgA = await createOrganization(A.db, { name: "P6 Org A" });
  orgB = await createOrganization(B.db, { name: "P6 Org B" });
  await addMember(orgA, V.id, "viewer");
  companyA = (await createCompany(A.db, orgA, { name: "Acme Fictional", website: "https://acme-fictional.example" })).id;
  companyB = (await createCompany(B.db, orgB, { name: "B Secret Co", website: "https://b-secret.example" })).id;
});
afterAll(cleanupTestData);

describe("existing companies", () => {
  test("a company created without Phase 6 data renders with unknown stage/origin and no fabricated history", async () => {
    const c = await getNetworkCompany(A.db, orgA, companyA);
    expect(c).toMatchObject({ stage: null, origin: null, reason: "" });
    const memory = await getCompanyMemory(A.db, orgA, companyA);
    expect(memory).toEqual({ contacts: [], interactions: [], followUps: [], events: [] });
  });
});

describe("contacts", () => {
  test("add and edit a contact; one primary per company", async () => {
    contactA = await createNetworkContact(A.db, orgA, companyA, { name: "Ada Fictional", role: "CTO", email: "ada@acme-fictional.example", isPrimary: true });
    const second = await createNetworkContact(A.db, orgA, companyA, { name: "Bob Fictional", isPrimary: true });
    await updateNetworkContact(A.db, orgA, companyA, contactA, { name: "Ada Fictional", role: "Chief Technology Officer", notes: "Met at a fictional fair" });
    const { contacts, events } = await getCompanyMemory(A.db, orgA, companyA);
    expect(contacts.map((c) => [c.name, c.role, c.isPrimary])).toEqual([
      ["Ada Fictional", "Chief Technology Officer", false],
      ["Bob Fictional", "", true],
    ]);
    expect(contacts[0].email).toBe("ada@acme-fictional.example");
    expect(events.filter((e) => e.kind === "contact_added").map((e) => e.subjectId).sort()).toEqual([contactA, second].sort());
  });

  test("invalid email / profile URL are rejected", async () => {
    await expect(createNetworkContact(A.db, orgA, companyA, { name: "X", email: "not-an-email" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createNetworkContact(A.db, orgA, companyA, { name: "X", profileUrl: "javascript:alert(1)" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("tenant isolation: B can neither read, add to, nor edit A's contacts", async () => {
    expect((await B.db.from("contacts").select("id").eq("id", contactA)).data).toEqual([]);
    await expect(createNetworkContact(B.db, orgA, companyA, { name: "Injected" })).rejects.toMatchObject({ code: "not_found" });
    await expect(updateNetworkContact(B.db, orgB, companyB, contactA, { name: "Hijacked" })).rejects.toMatchObject({ code: "not_found" });
    // Direct insert into A's organization is refused by RLS.
    const { error } = await B.db.from("contacts").insert({ organization_id: orgA, company_id: companyA, name: "Injected" });
    expect(error).not.toBeNull();
    const [row] = await sql`select name from public.contacts where id = ${contactA}`;
    expect(row.name).toBe("Ada Fictional");
  });

  test("viewers read but cannot write", async () => {
    expect((await getCompanyMemory(V.db, orgA, companyA)).contacts.length).toBe(2);
    const { error } = await V.db.from("contacts").insert({ organization_id: orgA, company_id: companyA, name: "Viewer" });
    expect(error).not.toBeNull();
  });
});

describe("relationship stage, interactions, follow-ups", () => {
  test("stage change is recorded in the history", async () => {
    await updateRelationship(A.db, orgA, companyA, { stage: "identified", origin: "event", reason: "Fictional reason" });
    await updateRelationship(A.db, orgA, companyA, { stage: "contacted", origin: "event", reason: "Fictional reason" });
    const c = await getNetworkCompany(A.db, orgA, companyA);
    expect(c).toMatchObject({ stage: "contacted", origin: "event", originRecorded: true, reason: "Fictional reason" });
    const stages = (await getCompanyMemory(A.db, orgA, companyA)).events.filter((e) => e.kind === "stage_changed").map((e) => [e.from, e.to]);
    expect(stages).toContainEqual([null, "identified"]);
    expect(stages).toContainEqual(["identified", "contacted"]);
  });

  test("interaction → next step → follow-up → done; history and next action follow", async () => {
    const i = await recordInteraction(A.db, orgA, companyA, { kind: "call", occurredAt: "2026-10-02T09:00:00Z", contactId: contactA, title: "Intro call", nextStep: "Send the brief" });
    let m = await getCompanyMemory(A.db, orgA, companyA);
    expect(m.interactions.map((x) => x.title)).toEqual(["Intro call"]);
    expect(nextBestAction({ stage: "contacted", ...m, validationQuestion: null, today: "2026-10-03" }).kind).toBe("interaction_next_step");

    const f = await createFollowUp(A.db, orgA, companyA, { title: "Send the brief", dueOn: "2026-10-03", interactionId: i, assignedTo: A.id });
    m = await getCompanyMemory(A.db, orgA, companyA);
    expect(m.followUps[0]).toMatchObject({ id: f, status: "open", origin: "interaction", closedAt: null, assignedTo: A.id });
    const nba = nextBestAction({ stage: "contacted", ...m, validationQuestion: null, today: "2026-10-03" });
    expect(nba.kind === "follow_up" && nba.bucket).toBe("today");

    await setFollowUpStatus(A.db, orgA, f, "done");
    m = await getCompanyMemory(A.db, orgA, companyA);
    expect(m.followUps[0].status).toBe("done");
    expect(m.followUps[0].closedAt).not.toBeNull();
    expect(m.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["follow_up_created", "follow_up_done"]));
    expect(nextBestAction({ stage: "contacted", ...m, validationQuestion: null, today: "2026-10-03" }).kind).toBe("none");
  });

  test("follow-ups and interactions cannot reference another company's or tenant's rows", async () => {
    await expect(recordInteraction(A.db, orgA, companyA, { kind: "note", occurredAt: "2026-10-02T09:00:00Z", title: "x", contactId: crypto.randomUUID() })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createFollowUp(B.db, orgB, companyB, { title: "x", contactId: contactA })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createFollowUp(A.db, orgA, companyA, { title: "x", assignedTo: B.id })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createFollowUp(A.db, orgA, companyA, { title: "x", dueOn: "2026-02-30" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("tenant isolation: B sees none of A's interactions, follow-ups or history, and cannot change them", async () => {
    for (const table of ["interactions", "follow_ups", "network_events"]) {
      expect({ table, rows: (await B.db.from(table).select("id").eq("organization_id", orgA)).data }).toEqual({ table, rows: [] });
    }
    const [f] = await sql`select id from public.follow_ups where organization_id = ${orgA} limit 1`;
    await expect(setFollowUpStatus(B.db, orgA, f.id, "open")).rejects.toMatchObject({ code: "not_found" });
    await expect(setFollowUpStatus(B.db, orgB, f.id, "open")).rejects.toMatchObject({ code: "not_found" });
    expect(await readRelationshipContext(B.db, orgB, companyA)).toBeNull();
    expect(await getCompanyMemory(B.db, orgB, companyA)).toEqual({ contacts: [], interactions: [], followUps: [], events: [] });
  });

  test("history is append-only for users (triggers write it)", async () => {
    const insert = await A.db.from("network_events").insert({ organization_id: orgA, company_id: companyA, kind: "stage_changed" });
    expect(insert.error).not.toBeNull();
    await A.db.from("network_events").delete().eq("organization_id", orgA);
    const [{ n }] = await sql`select count(*)::int as n from public.network_events where organization_id = ${orgA}`;
    expect(n).toBeGreaterThan(0);
  });

  test("agent seam is data-minimized: no email, phone, profile or notes", async () => {
    const ctx = await readRelationshipContext(A.db, orgA, companyA);
    expect(ctx?.provenance).toBe("private_relationship_memory");
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("@acme-fictional.example");
    expect(json).not.toContain("fictional fair");
  });
});

describe("Search → Add to Network", () => {
  test("derives the company from stored research, records origin, and never duplicates", async () => {
    const rr = await startResearchRun(A.db, orgA, "basic", STRONG.domain, STRONG.domain);
    await saveIntelligence(A.db, orgA, rr, "basic", STRONG, []);
    await finishRun(A.db, orgA, rr, { ok: true, domain: STRONG.domain, counters: {} });

    const first = await addSearchedCompany(A.db, orgA, STRONG.domain);
    const again = await addSearchedCompany(A.db, orgA, `https://www.${STRONG.domain}/about`);
    expect(first.created).toBe(true);
    expect(again).toEqual({ companyId: first.companyId, created: false });
    const c = await getNetworkCompany(A.db, orgA, first.companyId);
    expect(c).toMatchObject({ name: STRONG.name, origin: "search", originRecorded: true });
    expect((await listCompanies(A.db, orgA)).filter((x) => x.website?.includes(STRONG.domain)).length).toBe(1);
    // An existing company with the same domain is reused.
    expect((await addSearchedCompany(A.db, orgA, "acme-fictional.example")).companyId).toBe(companyA);
  });

  test("viewers cannot add; another tenant's stored research is never used", async () => {
    await expect(addSearchedCompany(V.db, orgA, "viewer-add.example")).rejects.toBeDefined();
    const b = await addSearchedCompany(B.db, orgB, STRONG.domain);
    const c = await getNetworkCompany(B.db, orgB, b.companyId);
    // B has no stored research: the name is the bare domain, not A's analyzed name.
    expect(c?.name).toBe(STRONG.domain);
  });
});
