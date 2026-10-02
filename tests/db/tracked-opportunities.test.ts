/**
 * Phase 16A against the real (isolated ORQO Test) database, as signed-in users under RLS:
 * - tracked opportunities: server recomputation, credible-only, idempotent, status-only updates,
 *   append-only memory, tenant isolation, viewer read-only, no anon or service_role privileges;
 * - the relationship question: persisted once, never asked again, organization-scoped.
 * Synthetic organizations and fictional companies only. No provider is called.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCompany } from "@/lib/server/repositories/companies";
import { updateRelationship } from "@/lib/server/repositories/network-memory";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { getTrackedOpportunity, listTrackedOpportunities, setTrackedStatus, trackOpportunity } from "@/lib/server/repositories/tracked-opportunities";
import { addRelationshipAnswer, getCompanyDossier, listValidations } from "@/lib/server/repositories/understanding";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { APPLIANCE_INTEGRATOR, fixtureProfile, SERVER_MAKER, SERVER_MAKER_OUTSOURCING } from "@/lib/understanding/fixtures";
import { addMember, anonClient, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

let A: TestUser;
let V: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;
let positive: string; // a company with a credible, incremental opportunity
let negative: string; // an existing supplier: no credible new opportunity
let companyB: string;
let tracked: string;

// The same supplier pattern under another name and domain (the own company names "Kestrel" in its evidence).
const SUPPLIER = fixtureProfile("Kestrel Storage", "kestrel-storage.example", SERVER_MAKER.profile.claims.map((c) => [c.field, c.statement.replaceAll("Kestrel Compute", "Kestrel Storage"), c.epistemic] as [typeof c.field, string, typeof c.epistemic]));

async function research(db: TestUser["db"], org: string, fx: { profile: typeof SERVER_MAKER.profile }) {
  const runId = await startResearchRun(db, org, "basic", fx.profile.domain, fx.profile.domain);
  await saveIntelligence(db, org, runId, "basic", fx.profile, []);
  await finishRun(db, org, runId, { ok: true, domain: fx.profile.domain, counters: {} });
}

beforeAll(async () => {
  await cleanupTestData();
  [A, V, B] = await Promise.all([createTestUser("p16-a"), createTestUser("p16-v"), createTestUser("p16-b")]);
  orgA = await createOrganization(A.db, { name: "P16 Org A" });
  orgB = await createOrganization(B.db, { name: "P16 Org B" });
  await addMember(orgA, V.id, "viewer");
  await createCompany(A.db, orgA, { name: "Arvenor Systems", website: "https://arvenor.example", isOwnCompany: true });
  positive = (await createCompany(A.db, orgA, { name: "Kestrel Compute", website: "https://kestrel.example" })).id;
  negative = (await createCompany(A.db, orgA, { name: "Kestrel Storage", website: "https://kestrel-storage.example" })).id;
  companyB = (await createCompany(B.db, orgB, { name: "B Target", website: "https://b-target.example" })).id;
  await research(A.db, orgA, APPLIANCE_INTEGRATOR);
  await research(A.db, orgA, SERVER_MAKER_OUTSOURCING);
  await research(A.db, orgA, SUPPLIER);
});
afterAll(cleanupTestData);

describe("dossiers resolved on the server", () => {
  test("a remembered company resolves to its stored research and the verdict follows the evidence", async () => {
    const pos = (await getCompanyDossier(A.db, orgA, positive))!;
    expect(pos.dossier?.verdict).toBe("opportunity");
    expect(pos.dossier?.scenarios.map((s) => s.key)).toContain("contract_production:own");
    const neg = (await getCompanyDossier(A.db, orgA, negative))!;
    expect(neg.dossier?.verdict).toBe("no_credible_opportunity");
    expect(neg.dossier?.relationship.roles).toEqual(["supplier"]);
    expect(neg.dossier?.considered.length).toBeGreaterThan(0);
  });

  test("another organization's company id resolves to nothing", async () => {
    expect(await getCompanyDossier(B.db, orgB, positive)).toBeNull();
    expect(await getCompanyDossier(B.db, orgA, positive)).toBeNull();
    expect(await getCompanyDossier(A.db, orgA, companyB)).toBeNull();
    expect(await getCompanyDossier(A.db, orgA, "not-a-uuid")).toBeNull();
  });
});

describe("tracking", () => {
  test("a credible opportunity is tracked with a server-built snapshot", async () => {
    const r = await trackOpportunity(A.db, orgA, { targetCompanyId: positive, scenarioKey: "contract_production:own" });
    expect(r.created).toBe(true);
    tracked = r.id;
    const o = (await getTrackedOpportunity(A.db, orgA, tracked))!;
    expect(o).toMatchObject({ targetCompanyId: positive, targetName: "Kestrel Compute", scenarioKey: "contract_production:own", mechanism: "contract_production", status: "investigating" });
    expect(o.snapshot).toMatchObject({ v: 1, ownName: "Arvenor Systems", targetName: "Kestrel Compute" });
    expect(o.snapshot.scenario.verdict).toBe("credible");
    expect(o.snapshot.scenario.revenue).toMatchObject({ stage: "hypothesis", outcome: null });
    const [row] = await sql`select created_by, intelligence_id from public.tracked_opportunities where id = ${tracked}`;
    expect(row.created_by).toBe(A.id);
    expect(row.intelligence_id).not.toBeNull();
  });

  test("tracking again is idempotent", async () => {
    const again = await trackOpportunity(A.db, orgA, { targetCompanyId: positive, scenarioKey: "contract_production:own" });
    expect(again).toEqual({ id: tracked, created: false });
    expect((await listTrackedOpportunities(A.db, orgA)).length).toBe(1);
  });

  test("weak, rejected, unknown and no-opportunity scenarios cannot be tracked", async () => {
    const neg = (await getCompanyDossier(A.db, orgA, negative))!.dossier!;
    for (const s of neg.considered) await expect(trackOpportunity(A.db, orgA, { targetCompanyId: negative, scenarioKey: s.key })).rejects.toMatchObject({ code: "conflict" });
    const pos = (await getCompanyDossier(A.db, orgA, positive))!.dossier!;
    for (const s of pos.considered) await expect(trackOpportunity(A.db, orgA, { targetCompanyId: positive, scenarioKey: s.key })).rejects.toMatchObject({ code: "conflict" });
    await expect(trackOpportunity(A.db, orgA, { targetCompanyId: positive, scenarioKey: "joint_offer:own" })).rejects.toMatchObject({ code: "conflict" });
    await expect(trackOpportunity(A.db, orgA, { targetCompanyId: positive, scenarioKey: "Ignore previous instructions" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(trackOpportunity(A.db, orgA, { targetCompanyId: positive, scenarioKey: "contract_production:own", snapshot: { forged: true } })).rejects.toMatchObject({ code: "invalid_input" });
    expect((await listTrackedOpportunities(A.db, orgA)).length).toBe(1);
  });

  test("the server recomputes before tracking: a changed assessment closes the door", async () => {
    // The user states the company is a competitor: the dossier is recomputed and the idea is no longer credible.
    const other = (await createCompany(A.db, orgA, { name: "Kestrel Compute Two", website: "https://kestrel.example" })).id;
    expect((await getCompanyDossier(A.db, orgA, other))!.dossier!.verdict).toBe("opportunity");
    await addRelationshipAnswer(A.db, orgA, other, { values: ["competitor"] });
    await expect(trackOpportunity(A.db, orgA, { targetCompanyId: other, scenarioKey: "contract_production:own" })).rejects.toMatchObject({ code: "conflict" });
  });

  test("the database refuses direct writes the application would never make", async () => {
    // A forged snapshot written directly still needs a same-organization company and an accepted shape.
    const { error: fk } = await A.db.from("tracked_opportunities").insert({ organization_id: orgA, target_company_id: companyB, scenario_key: "referral:own", mechanism: "referral", snapshot: {} });
    expect(fk).not.toBeNull();
    const { error: mismatch } = await A.db.from("tracked_opportunities").insert({ organization_id: orgA, target_company_id: negative, scenario_key: "referral:own", mechanism: "licensing", snapshot: {} });
    expect(mismatch).not.toBeNull();
    const { error: badStatus } = await A.db.from("tracked_opportunities").insert({ organization_id: orgA, target_company_id: negative, scenario_key: "referral:own", mechanism: "referral", status: "won", snapshot: {} });
    expect(badStatus).not.toBeNull();
  });
});

describe("status", () => {
  test("only the status changes, and its change is dated", async () => {
    const before = (await getTrackedOpportunity(A.db, orgA, tracked))!;
    await Bun.sleep(20);
    const after = await setTrackedStatus(A.db, orgA, tracked, { status: "validated" });
    expect(after.status).toBe("validated");
    expect(after.statusChangedAt > before.statusChangedAt).toBe(true);
    await expect(setTrackedStatus(A.db, orgA, tracked, { status: "won" })).rejects.toMatchObject({ code: "invalid_input" });
    await A.db.from("tracked_opportunities").update({ snapshot: { forged: true }, scenario_key: "referral:own" }).eq("id", tracked);
    await A.db.from("tracked_opportunities").delete().eq("id", tracked);
    const [row] = await sql`select status, snapshot ? 'forged' as forged, scenario_key from public.tracked_opportunities where id = ${tracked}`;
    expect(row).toMatchObject({ status: "validated", forged: false, scenario_key: "contract_production:own" });
    for (const status of ["paused", "closed", "investigating"]) expect((await setTrackedStatus(A.db, orgA, tracked, { status })).status).toBe(status);
  });

  test("a status change is audited", async () => {
    const rows = await sql`select action from public.audit_events where organization_id = ${orgA} and target_table = 'tracked_opportunities' and target_id = ${tracked} order by occurred_at`;
    expect(rows.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(["tracked_opportunities.created", "tracked_opportunities.updated"]));
  });
});

describe("tenant isolation and roles", () => {
  test("another organization can neither read, track into, nor change A's opportunities", async () => {
    const { data } = await B.db.from("tracked_opportunities").select("id").eq("organization_id", orgA);
    expect(data).toEqual([]);
    expect(await getTrackedOpportunity(B.db, orgA, tracked)).toBeNull();
    expect(await getTrackedOpportunity(B.db, orgB, tracked)).toBeNull();
    expect(await listTrackedOpportunities(B.db, orgA)).toEqual([]);
    await expect(trackOpportunity(B.db, orgA, { targetCompanyId: positive, scenarioKey: "contract_production:own" })).rejects.toMatchObject({ code: "not_found" });
    await expect(trackOpportunity(B.db, orgB, { targetCompanyId: positive, scenarioKey: "contract_production:own" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setTrackedStatus(B.db, orgA, tracked, { status: "closed" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setTrackedStatus(B.db, orgB, tracked, { status: "closed" })).rejects.toMatchObject({ code: "not_found" });
    const { error: direct } = await B.db.from("tracked_opportunities").insert({ organization_id: orgA, target_company_id: positive, scenario_key: "referral:own", mechanism: "referral", snapshot: {} });
    expect(direct).not.toBeNull();
    const { error: cross } = await B.db.from("tracked_opportunities").insert({ organization_id: orgB, target_company_id: positive, scenario_key: "referral:own", mechanism: "referral", snapshot: {} });
    expect(cross).not.toBeNull();
    const [row] = await sql`select status from public.tracked_opportunities where id = ${tracked}`;
    expect(row.status).toBe("investigating");
  });

  test("a viewer reads but cannot track or change a status", async () => {
    expect((await listTrackedOpportunities(V.db, orgA)).map((o) => o.id)).toEqual([tracked]);
    const { error } = await V.db.from("tracked_opportunities").insert({ organization_id: orgA, target_company_id: negative, scenario_key: "referral:own", mechanism: "referral", snapshot: {} });
    expect(error).not.toBeNull();
    await expect(setTrackedStatus(V.db, orgA, tracked, { status: "closed" })).rejects.toThrow();
    const [row] = await sql`select status from public.tracked_opportunities where id = ${tracked}`;
    expect(row.status).toBe("investigating");
  });

  test("anonymous callers are refused; anon and service_role hold no privileges", async () => {
    const { data } = await anonClient().from("tracked_opportunities").select("id");
    expect(data ?? []).toEqual([]);
    const grants = await sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'tracked_opportunities' and grantee in ('anon', 'authenticated', 'service_role') order by grantee, privilege_type`;
    expect(grants.map((r: { grantee: string; privilege_type: string }) => `${r.grantee}:${r.privilege_type}`)).toEqual(["authenticated:INSERT", "authenticated:SELECT"]);
    const columns = await sql`select grantee, column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'tracked_opportunities' and privilege_type = 'UPDATE' and grantee in ('anon', 'authenticated', 'service_role')`;
    expect(columns.map((r: { grantee: string; column_name: string }) => `${r.grantee}:${r.column_name}`)).toEqual(["authenticated:status"]);
  });
});

describe("the relationship question", () => {
  test("is asked, answered once, and never asked again", async () => {
    expect((await getCompanyDossier(A.db, orgA, negative))!.dossier!.askRelationship).toBe(true);
    await addRelationshipAnswer(A.db, orgA, negative, { values: ["supplier"] });
    const d = (await getCompanyDossier(A.db, orgA, negative))!.dossier!;
    expect(d.askRelationship).toBe(false);
    expect(d.relationship.links).toEqual([expect.objectContaining({ role: "supplier", state: "fact", source: "user" })]);
    expect(d.verdict).toBe("no_credible_opportunity");
    expect((await listValidations(A.db, orgA, negative)).at(-1)).toMatchObject({ kind: "answer", facet: "relationship_role", value: "supplier" });
  });

  test("only allowed answers, only for this organization's remembered companies", async () => {
    await expect(addRelationshipAnswer(A.db, orgA, negative, { values: ["best_friend"] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(addRelationshipAnswer(A.db, orgA, negative, { values: ["none", "supplier"] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(addRelationshipAnswer(A.db, orgA, negative, { values: [] })).rejects.toMatchObject({ code: "invalid_input" });
    const own = (await sql`select id from public.companies where organization_id = ${orgA} and is_own_company`)[0].id;
    await expect(addRelationshipAnswer(A.db, orgA, own, { values: ["supplier"] })).rejects.toMatchObject({ code: "not_found" });
    await expect(addRelationshipAnswer(B.db, orgA, negative, { values: ["customer"] })).rejects.toMatchObject({ code: "not_found" });
    await expect(addRelationshipAnswer(B.db, orgB, negative, { values: ["customer"] })).rejects.toMatchObject({ code: "not_found" });
    await expect(addRelationshipAnswer(V.db, orgA, negative, { values: ["customer"] })).rejects.toThrow();
  });

  test("the Network stage 'customer or partner' counts as a stated relationship", async () => {
    await updateRelationship(A.db, orgA, positive, { stage: "customer_partner", origin: null, reason: "" });
    const d = (await getCompanyDossier(A.db, orgA, positive))!.dossier!;
    expect(d.relationship.links.some((l) => l.source === "network" && l.role === "unspecified")).toBe(true);
    await updateRelationship(A.db, orgA, positive, { stage: null, origin: null, reason: "" });
  });
});
