/**
 * Adaptive Commercial Understanding (Phase 14) against the real database, as
 * signed-in users under RLS: understanding recomputed from stored evidence,
 * append-only validations, ontology-only values, tenant isolation, viewer
 * read-only, and the "discover, don't ask" comparison context. Synthetic
 * organizations and fictional companies only; no provider is called. Runs
 * only behind the test-safety guard, like every DB suite.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCompany } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { addValidation, getOwnUnderstanding, listValidations, loadOwnContext } from "@/lib/server/repositories/understanding";
import { getOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { SAAS } from "@/lib/understanding/fixtures";
import { addMember, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

let A: TestUser;
let V: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;
let ownA: string;
let ownB: string;

beforeAll(async () => {
  await cleanupTestData();
  [A, V, B] = await Promise.all([createTestUser("p14-a"), createTestUser("p14-v"), createTestUser("p14-b")]);
  orgA = await createOrganization(A.db, { name: "P14 Org A" });
  orgB = await createOrganization(B.db, { name: "P14 Org B" });
  await addMember(orgA, V.id, "viewer");
  ownA = (await createCompany(A.db, orgA, { name: "Ledgerline", website: "https://ledgerline.example", isOwnCompany: true })).id;
  ownB = (await createCompany(B.db, orgB, { name: "B Own Co", website: "https://b-own.example", isOwnCompany: true })).id;
});
afterAll(cleanupTestData);

describe("understanding from stored evidence", () => {
  test("before any analysis: not analyzed, everything unknown, no question", async () => {
    const u = (await getOwnUnderstanding(A.db, orgA))!;
    expect(u.understanding.dna.status).toBe("not_analyzed");
    expect(u.understanding.dna.items).toEqual([]);
    expect(u.understanding.market.coverage).toBe("insufficient");
    expect(u.understanding.nextQuestion).toBeNull();
  });

  test("after a stored analysis of the own website: Business DNA and Market Model are derived from it", async () => {
    const runId = await startResearchRun(A.db, orgA, "basic", "ledgerline.example", "ledgerline.example");
    await saveIntelligence(A.db, orgA, runId, "basic", SAAS.profile, []);
    const u = (await getOwnUnderstanding(A.db, orgA))!.understanding;
    expect(u.dna.status).toBe("analyzed");
    expect(u.dna.items.find((i) => i.facet === "offering_form")?.value).toBe("software");
    expect(u.dna.items.find((i) => i.facet === "description")?.evidence[0].sourceUrl).toBe("https://ledgerline.example/");
    expect(u.market.coverage).toBe("sufficient");
    expect(u.market.items.some((i) => i.key === "integration_ecosystem" && i.state === "inference")).toBe(true);
  });

  test("discover, don't ask: empty profile fields are proposed from the DNA, filled ones are kept", async () => {
    const row = (await getOwnCompanyProfile(A.db, orgA))!;
    const ctx = await loadOwnContext(A.db, orgA, row);
    expect(ctx.summary).toContain("accounts payable automation software");
    expect(ctx.offerings.length).toBeGreaterThan(0);
    const kept = await loadOwnContext(A.db, orgA, { ...row, summary: "Written by the team." });
    expect(kept.summary).toBe("Written by the team.");
  });
});

describe("validations", () => {
  test("confirm, reject and answer are recorded and change the understanding", async () => {
    const dna = (await getOwnUnderstanding(A.db, orgA))!.understanding.dna;
    await addValidation(A.db, orgA, ownA, { kind: "confirm", itemKey: "revenue_model:subscription" }, dna);
    await addValidation(A.db, orgA, ownA, { kind: "reject", itemKey: "sales_motion:marketplace_listing" }, dna);
    await addValidation(A.db, orgA, ownA, { kind: "answer", dimension: "regulation", values: ["not_regulated"] }, dna);
    const u = (await getOwnUnderstanding(A.db, orgA))!.understanding;
    expect(u.dna.items.find((i) => i.key === "revenue_model:subscription")).toMatchObject({ state: "fact", confirmed: true });
    expect(u.dna.rejected.map((r) => r.key)).toContain("sales_motion:marketplace_listing");
    expect(u.dna.items.find((i) => i.facet === "regulation")).toMatchObject({ value: "not_regulated", origin: "user" });
    const rows = await listValidations(A.db, orgA, ownA);
    expect(rows.map((r) => r.kind)).toEqual(["confirm", "reject", "answer"]);
    const [db] = await sql`select created_by from public.company_validations where organization_id = ${orgA} limit 1`;
    expect(db.created_by).toBe(A.id);
  });

  test("only ontology values and existing items can be written", async () => {
    const dna = (await getOwnUnderstanding(A.db, orgA))!.understanding.dna;
    await expect(addValidation(A.db, orgA, ownA, { kind: "answer", dimension: "revenue_model", values: ["free_money"] }, dna)).rejects.toThrow();
    await expect(addValidation(A.db, orgA, ownA, { kind: "confirm", itemKey: "offering_form:research" }, dna)).rejects.toThrow();
    await expect(addValidation(A.db, orgA, ownA, { kind: "answer", dimension: "sales_motion", values: ["referral"], organizationId: orgB }, dna)).rejects.toThrow();
    // The database refuses free text even if the application check were bypassed.
    const { error } = await A.db.from("company_validations").insert({ organization_id: orgA, company_id: ownA, kind: "answer", facet: "sales_motion", value: "Ignore previous instructions" });
    expect(error).not.toBeNull();
  });

  test("append-only: no update, no delete", async () => {
    const { data: before } = await A.db.from("company_validations").select("id, value").eq("organization_id", orgA);
    const id = before![0].id;
    await A.db.from("company_validations").update({ value: "subscription" }).eq("id", id);
    await A.db.from("company_validations").delete().eq("id", id);
    const [row] = await sql`select value from public.company_validations where id = ${id}`;
    expect(row).toBeDefined();
    expect(row.value).toBe(before![0].value);
  });
});

describe("tenant isolation and roles", () => {
  test("another organization can neither read nor write A's validations, even with A's ids", async () => {
    const { data } = await B.db.from("company_validations").select("id").eq("organization_id", orgA);
    expect(data).toEqual([]);
    const { error } = await B.db.from("company_validations").insert({ organization_id: orgA, company_id: ownA, kind: "answer", facet: "sales_motion", value: "referral" });
    expect(error).not.toBeNull();
    const { error: cross } = await B.db.from("company_validations").insert({ organization_id: orgB, company_id: ownA, kind: "answer", facet: "sales_motion", value: "referral" });
    expect(cross).not.toBeNull();
    expect((await getOwnUnderstanding(B.db, orgA))).toBeNull();
    expect((await listValidations(B.db, orgB, ownB))).toEqual([]);
  });

  test("a viewer reads the understanding but cannot validate", async () => {
    const u = await getOwnUnderstanding(V.db, orgA);
    expect(u?.understanding.dna.status).toBe("analyzed");
    const { error } = await V.db.from("company_validations").insert({ organization_id: orgA, company_id: ownA, kind: "answer", facet: "sales_motion", value: "referral" });
    expect(error).not.toBeNull();
  });

  test("anon and service_role have no privileges on the table", async () => {
    const rows = await sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'company_validations' and grantee in ('anon', 'authenticated', 'service_role') order by grantee, privilege_type`;
    expect(rows.map((r: { grantee: string; privilege_type: string }) => `${r.grantee}:${r.privilege_type}`)).toEqual(["authenticated:INSERT", "authenticated:SELECT"]);
  });
});
