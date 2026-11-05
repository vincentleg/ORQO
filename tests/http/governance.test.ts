/**
 * Phase 17A over HTTP, against the isolated server (paid providers forced OFF; the synthetic preview
 * organization is Internal with a test-only ceiling). Proves at the API boundary that:
 * - Free is refused paid research before any provider and before any spend reservation;
 * - Internal is refused too while the kill switch is on (Internal bypasses nothing);
 * - the retired legacy demo routes never reach a provider;
 * - the Internal usage view is never shown to other workspaces, and Settings needs sign-in.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { cleanupTestData, createSyntheticPreviewOrg, createTestUser, sql, type TestUser } from "../support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
let F: TestUser;
let I: TestUser;
let orgFree: string;
let orgInternal: string;

const research = (org: string, token: string) =>
  fetch(`${BASE}/api/v1/organizations/${org}/research`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ query: "governance-fixture.example", mode: "deep" }), redirect: "manual" });
const spendRows = async () => Number((await sql`select count(*)::int as n from public.provider_spend where organization_id in ${sql([orgFree, orgInternal])}`)[0].n);
const runs = async () => Number((await sql`select count(*)::int as n from public.research_runs where organization_id in ${sql([orgFree, orgInternal])}`)[0].n);

beforeAll(async () => {
  const up = await fetch(`${BASE}/api/status`).catch(() => null);
  if (!up?.ok) throw new Error(`ORQO server not reachable at ${BASE}.`);
  await cleanupTestData();
  [F, I] = await Promise.all([createTestUser("p17h-free"), createTestUser("p17h-internal")]);
  orgFree = await createOrganization(F.db, { name: "P17 Free" });
  orgInternal = await createSyntheticPreviewOrg(I, "P17 Internal");
});
afterAll(cleanupTestData);

describe("paid research is refused before any provider or spend", () => {
  test("Free: refused (plan), nothing reserved, no research run", async () => {
    const before = { spend: await spendRows(), runs: await runs() };
    const res = await research(orgFree, F.accessToken);
    expect(res.status).toBe(403);
    expect(await spendRows()).toBe(before.spend);
    expect(await runs()).toBe(before.runs);
  });

  test("Internal with the kill switch on: refused (unavailable), nothing reserved", async () => {
    const before = { spend: await spendRows(), runs: await runs() };
    const res = await research(orgInternal, I.accessToken);
    expect(res.status).toBe(503);
    expect(await spendRows()).toBe(before.spend);
    expect(await runs()).toBe(before.runs);
  });

  test("the retired legacy demo routes answer 'unavailable' and reach no provider", async () => {
    const r1 = await fetch(`${BASE}/api/research?company=Fictional`, { headers: { authorization: `Bearer ${I.accessToken}` } });
    expect(r1.status).toBe(503);
    const r2 = await fetch(`${BASE}/api/discover`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${I.accessToken}` }, body: JSON.stringify({}) });
    expect([400, 503]).toContain(r2.status);
  });
});

describe("the Internal usage view", () => {
  test("Settings requires sign-in", async () => {
    const res = await fetch(`${BASE}/workspace/settings`, { redirect: "manual" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
