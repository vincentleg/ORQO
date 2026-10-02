/**
 * Phase 16A over HTTP, against a running ORQO server (BASE_URL, default http://localhost:3100) connected to the
 * isolated ORQO Test project. API callers authenticate with `Authorization: Bearer`.
 * - tracked opportunities: sign-in required, membership enforced, ids are lookup keys only, the server
 *   recomputes before tracking, only credible opportunities, status-only changes;
 * - the relationship answer: stored once, the question then closed;
 * - the Opportunities pages sit behind sign-in.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCompany } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import type { Db } from "@/lib/server/supabase/types";
import { APPLIANCE_INTEGRATOR, SERVER_MAKER, SERVER_MAKER_OUTSOURCING, fixtureProfile } from "@/lib/understanding/fixtures";
import { addMember, cleanupTestData, createTestUser, type TestUser } from "../support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
let A: TestUser;
let B: TestUser;
let V: TestUser;
let orgA: string;
let orgB: string;
let positive: string;
let negative: string;
let companyB: string;
let tracked: string;

const SUPPLIER = fixtureProfile("Kestrel Storage", "kestrel-storage.example", SERVER_MAKER.profile.claims.map((c) => [c.field, c.statement.replaceAll("Kestrel Compute", "Kestrel Storage"), c.epistemic] as [typeof c.field, string, typeof c.epistemic]));

function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  return fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual", body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
}

async function research(db: Db, org: string, fx: { profile: typeof SERVER_MAKER.profile }) {
  const runId = await startResearchRun(db, org, "basic", fx.profile.domain, fx.profile.domain);
  await saveIntelligence(db, org, runId, "basic", fx.profile, []);
  await finishRun(db, org, runId, { ok: true, domain: fx.profile.domain, counters: {} });
}

const opps = (org: string) => `/api/v1/organizations/${org}/opportunities`;

beforeAll(async () => {
  const up = await fetch(`${BASE}/api/status`).catch(() => null);
  if (!up?.ok) throw new Error(`ORQO server not reachable at ${BASE}; start it first.`);
  await cleanupTestData();
  [A, B, V] = await Promise.all([createTestUser("p16h-a"), createTestUser("p16h-b"), createTestUser("p16h-v")]);
  orgA = await createOrganization(A.db, { name: "P16 HTTP Org A" });
  orgB = await createOrganization(B.db, { name: "P16 HTTP Org B" });
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

describe("sign-in is required", () => {
  test.each([
    ["GET", `/api/v1/organizations/${crypto.randomUUID()}/opportunities`],
    ["POST", `/api/v1/organizations/${crypto.randomUUID()}/opportunities`],
    ["GET", `/api/v1/organizations/${crypto.randomUUID()}/opportunities/${crypto.randomUUID()}`],
    ["PATCH", `/api/v1/organizations/${crypto.randomUUID()}/opportunities/${crypto.randomUUID()}`],
    ["GET", `/api/v1/organizations/${crypto.randomUUID()}/companies/${crypto.randomUUID()}/relationship`],
    ["POST", `/api/v1/organizations/${crypto.randomUUID()}/companies/${crypto.randomUUID()}/relationship`],
  ])("%s %s → 401", async (method, path) => {
    const res = await call(path, { method, json: method === "GET" ? undefined : {} });
    expect(res.status).toBe(401);
  });

  test.each(["/workspace/opportunities", `/workspace/opportunities/${crypto.randomUUID()}`, `/workspace?ask=${encodeURIComponent("What could we do with Kestrel Compute?")}`, "/workspace/companies", "/workspace/companies?q=kestrel.example", `/workspace/companies/${crypto.randomUUID()}`, `/workspace/network/${crypto.randomUUID()}`])("%s redirects signed-out users to sign-in", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("tracking over HTTP", () => {
  test("a credible opportunity is tracked (201), then idempotent (200)", async () => {
    const res = await call(opps(orgA), { method: "POST", token: A.accessToken, json: { targetCompanyId: positive, scenarioKey: "contract_production:own" } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    tracked = body.id;
    const again = await call(opps(orgA), { method: "POST", token: A.accessToken, json: { targetCompanyId: positive, scenarioKey: "contract_production:own" } });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id: tracked, created: false });
  });

  test("the browser cannot supply the snapshot, a weak idea, or another organization's company", async () => {
    const forged = await call(opps(orgA), { method: "POST", token: A.accessToken, json: { targetCompanyId: positive, scenarioKey: "contract_production:own", snapshot: { scenario: { verdict: "credible" } } } });
    expect(forged.status).toBe(400);
    const weak = await call(opps(orgA), { method: "POST", token: A.accessToken, json: { targetCompanyId: negative, scenarioKey: "contract_production:own" } });
    expect(weak.status).toBe(409);
    const foreign = await call(opps(orgA), { method: "POST", token: A.accessToken, json: { targetCompanyId: companyB, scenarioKey: "contract_production:own" } });
    expect(foreign.status).toBe(404);
    const list = await (await call(opps(orgA), { token: A.accessToken })).json();
    expect(list.opportunities.map((o: { id: string }) => o.id)).toEqual([tracked]);
  });

  test("membership is enforced: another organization and a viewer", async () => {
    // Non-members get 404: ORQO does not reveal that another organization exists.
    expect((await call(opps(orgA), { token: B.accessToken })).status).toBe(404);
    expect((await call(`${opps(orgA)}/${tracked}`, { token: B.accessToken })).status).toBe(404);
    expect((await call(`${opps(orgB)}/${tracked}`, { token: B.accessToken })).status).toBe(404);
    expect((await call(opps(orgB), { method: "POST", token: B.accessToken, json: { targetCompanyId: positive, scenarioKey: "contract_production:own" } })).status).toBe(404);
    expect((await call(`${opps(orgB)}/${tracked}`, { method: "PATCH", token: B.accessToken, json: { status: "closed" } })).status).toBe(404);
    expect((await call(opps(orgA), { token: V.accessToken })).status).toBe(200);
    expect((await call(opps(orgA), { method: "POST", token: V.accessToken, json: { targetCompanyId: positive, scenarioKey: "contract_production:own" } })).status).toBe(403);
    expect((await call(`${opps(orgA)}/${tracked}`, { method: "PATCH", token: V.accessToken, json: { status: "closed" } })).status).toBe(403);
  });

  test("status changes: allowed values only, nothing else", async () => {
    const bad = await call(`${opps(orgA)}/${tracked}`, { method: "PATCH", token: A.accessToken, json: { status: "won" } });
    expect(bad.status).toBe(400);
    const extra = await call(`${opps(orgA)}/${tracked}`, { method: "PATCH", token: A.accessToken, json: { status: "paused", mechanism: "referral" } });
    expect(extra.status).toBe(400);
    const ok = await call(`${opps(orgA)}/${tracked}`, { method: "PATCH", token: A.accessToken, json: { status: "validated" } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).opportunity).toMatchObject({ id: tracked, status: "validated", mechanism: "contract_production" });
  });

  test("a cross-site write is refused", async () => {
    const res = await call(opps(orgA), { method: "POST", token: A.accessToken, json: { targetCompanyId: positive, scenarioKey: "contract_production:own" }, headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});

describe("the relationship question over HTTP", () => {
  test("open, answered once, then closed; organization-scoped", async () => {
    const path = `/api/v1/organizations/${orgA}/companies/${negative}/relationship`;
    const before = await (await call(path, { token: A.accessToken })).json();
    expect(before).toMatchObject({ askRelationship: true, verdict: "no_credible_opportunity" });
    expect((await call(path, { method: "POST", token: A.accessToken, json: { values: ["friend"] } })).status).toBe(400);
    expect((await call(path, { method: "POST", token: B.accessToken, json: { values: ["supplier"] } })).status).toBe(404);
    expect((await call(`/api/v1/organizations/${orgB}/companies/${negative}/relationship`, { method: "POST", token: B.accessToken, json: { values: ["supplier"] } })).status).toBe(404);
    expect((await call(path, { method: "POST", token: A.accessToken, json: { values: ["supplier"] } })).status).toBe(201);
    const after = await (await call(path, { token: A.accessToken })).json();
    expect(after.askRelationship).toBe(false);
    expect(after.relationship.links[0]).toMatchObject({ role: "supplier", source: "user", state: "fact" });
  });
});
