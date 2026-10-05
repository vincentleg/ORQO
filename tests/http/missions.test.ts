/**
 * Phase 17B mission routes over HTTP against the isolated server (BASE_URL, default http://localhost:3100):
 * authentication, CSRF, tenancy, role, entitlement and strict bodies on every route; then, on the synthetic
 * Internal preview organization, the golden missions end to end through the API (create → execute slices
 * until terminal → inspect steps and findings), idempotent creation, cancellation and a deterministic failure.
 * The server runs with the kill switch on and no provider keys. Only stored research is used: nothing is
 * fetched from the web.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GOLDEN_MISSIONS, GOLDEN_WORLD, stepLine } from "@/lib/missions/golden";
import { createCompany, updateOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { addMember, cleanupTestData, createSyntheticPreviewOrg, createTestUser, sql, testPreviewOrgId, type TestUser } from "../support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PREVIEW_ORG = process.env.TEST_PREVIEW_ORG ? testPreviewOrgId() : "";
let A: TestUser;
let B: TestUser;
let V: TestUser;
let orgA: string;
let orgB: string;

const api = (org: string, path = "") => `${BASE}/api/v1/organizations/${org}/missions${path}`;
function post(url: string, body: unknown, opts: { token?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ "content-type": "application/json", ...opts.headers });
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
}
const get = (url: string, token?: string) => fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: "manual" });
const mission = (over: Record<string, unknown> = {}) => ({ template: "research_company", input: { target: { query: "strong.example" } }, idempotencyKey: crypto.randomUUID(), ...over });
const count = async (org: string) => (await sql`select count(*)::int as n from public.missions where organization_id = ${org}`)[0].n as number;

beforeAll(async () => {
  const up = await fetch(`${BASE}/api/status`).catch(() => null);
  if (!up?.ok) throw new Error(`ORQO server not reachable at ${BASE}; start it first (bun run build && bun run start -p 3100).`);
  await cleanupTestData();
  [A, B, V] = await Promise.all([createTestUser("p17bhttp-a"), createTestUser("p17bhttp-b"), createTestUser("p17bhttp-v")]);
  orgA = await createOrganization(A.db, { name: "P17B HTTP A" });
  orgB = await createOrganization(B.db, { name: "P17B HTTP B" });
  await addMember(orgA, V.id, "viewer");
});
afterAll(cleanupTestData);

describe("mission routes: refusals before anything is planned or executed", () => {
  const someId = crypto.randomUUID();
  test("anonymous → 401 on every route", async () => {
    expect((await post(api(orgA), mission())).status).toBe(401);
    expect((await get(api(orgA))).status).toBe(401);
    expect((await get(api(orgA, `/${someId}`))).status).toBe(401);
    expect((await post(api(orgA, `/${someId}/execute`), {})).status).toBe(401);
    expect((await post(api(orgA, `/${someId}/cancel`), {})).status).toBe(401);
  });

  test("CSRF: non-JSON → 400 and foreign Origin → 403 on every mutation", async () => {
    for (const path of ["", `/${someId}/execute`, `/${someId}/cancel`]) {
      const form = await fetch(api(orgA, path), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Bearer ${A.accessToken}` }, body: "template=research_company" });
      expect(form.status).toBe(400);
      expect((await post(api(orgA, path), mission(), { token: A.accessToken, headers: { origin: "https://evil.example" } })).status).toBe(403);
    }
  });

  test("another organization → 404; viewer → 403 role; Free workspace → 403 plan_required; nothing created", async () => {
    expect((await post(api(orgA), mission(), { token: B.accessToken })).status).toBe(404);
    expect((await get(api(orgA), B.accessToken)).status).toBe(404);
    const viewer = await post(api(orgA), mission(), { token: V.accessToken });
    expect(viewer.status).toBe(403);
    expect((await viewer.json()).error.reason).toBe("role");
    const free = await post(api(orgA), mission(), { token: A.accessToken });
    expect(free.status).toBe(403);
    expect(await free.json()).toMatchObject({ error: { reason: "plan_required", requiredPlan: "pro" } });
    expect(await count(orgA)).toBe(0);
  });

  test("forged fields and non-free inputs are rejected: steps, contract, envelope, organization, unknown template, deep, web search", async () => {
    for (const body of [
      mission({ steps: [] }),
      mission({ contract: { envelope: { maxCostUsd: 5 } } }),
      mission({ envelope: { maxCostUsd: 5 } }),
      mission({ organizationId: orgB }),
      mission({ template: "deep_research" }),
      mission({ template: "web_search" }),
      mission({ idempotencyKey: "not-a-uuid" }),
    ])
      expect((await post(api(orgA), body, { token: A.accessToken })).status).toBe(400);
    expect(await count(orgA)).toBe(0);
  });

  test("unknown or foreign mission ids → 404 (no enumeration)", async () => {
    expect((await get(api(orgA, `/${someId}`), A.accessToken)).status).toBe(404);
    expect((await get(api(orgA, "/not-a-uuid"), A.accessToken)).status).toBe(404);
    expect((await post(api(orgA, `/${someId}/execute`), {}, { token: A.accessToken })).status).toBe(404);
    expect((await post(api(orgA, `/${someId}/cancel`), {}, { token: A.accessToken })).status).toBe(404);
    expect((await post(api(orgA, `/${someId}/execute`), {}, { token: V.accessToken })).status).toBe(403);
  });
});

describe.skipIf(!PREVIEW_ORG)("golden missions over HTTP (synthetic Internal preview organization)", () => {
  let owner: TestUser;
  let viewer: TestUser;
  beforeAll(async () => {
    [owner, viewer] = await Promise.all([createTestUser("p17bhttp-owner"), createTestUser("p17bhttp-viewer")]);
    await createSyntheticPreviewOrg(owner, "P17B HTTP Preview");
    await addMember(PREVIEW_ORG, viewer.id, "viewer");
    await createCompany(owner.db, PREVIEW_ORG, { name: "Own Co", website: GOLDEN_WORLD.ownWebsite, isOwnCompany: true });
    await updateOwnCompanyProfile(owner.db, PREVIEW_ORG, { ...GOLDEN_WORLD.own, website: GOLDEN_WORLD.ownWebsite });
    for (const p of GOLDEN_WORLD.stored) {
      const rr = await startResearchRun(owner.db, PREVIEW_ORG, "basic", p.domain, p.domain);
      await saveIntelligence(owner.db, PREVIEW_ORG, rr, "basic", p, []);
      await finishRun(owner.db, PREVIEW_ORG, rr, { ok: true, domain: p.domain, counters: {} });
    }
  });

  async function runToEnd(id: string) {
    const states: string[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await post(api(PREVIEW_ORG, `/${id}/execute`), {}, { token: owner.accessToken });
      expect(res.status).toBe(200);
      const body = await res.json();
      states.push(body.state);
      if (["completed", "failed", "cancelled"].includes(body.state)) return { states, body };
    }
    throw new Error(`mission did not finish: ${states.join(",")}`);
  }

  // Stored-research scenarios only: the server's research gateway is real, so a web fetch is never triggered here.
  for (const g of GOLDEN_MISSIONS.filter((x) => x.expect.status === "completed"))
    test(g.name, async () => {
      const body = { template: g.template, input: g.input, idempotencyKey: crypto.randomUUID() };
      const created = await post(api(PREVIEW_ORG), body, { token: owner.accessToken });
      expect(created.status).toBe(201);
      const { mission: m } = await created.json();
      expect(m).toMatchObject({ status: "planned", reused: false });
      // Replay: the same mission, never a second one.
      const replay = await post(api(PREVIEW_ORG), body, { token: owner.accessToken });
      expect(replay.status).toBe(200);
      expect((await replay.json()).mission).toEqual({ id: m.id, status: "planned", reused: true });

      const { states, body: end } = await runToEnd(m.id);
      expect(states.at(-1)).toBe(g.expect.status);
      // One child run per slice: every slice before the last yields.
      expect(states.slice(0, -1).every((s) => s === "yielded")).toBe(true);
      expect(end.steps.map((s: { key: string; status: string; error: string | null }) => stepLine(s))).toEqual(g.expect.steps);

      const detail = await get(api(PREVIEW_ORG, `/${m.id}`), viewer.accessToken);
      expect(detail.status).toBe(200);
      const d = await detail.json();
      expect(d.mission).toMatchObject({ id: m.id, template: g.template, status: "completed", failureReason: null });
      expect(d.progress).toMatchObject({ total: g.expect.steps.length, pending: 0, leased: 0 });
      const keys = d.findings.map((f: { key: string }) => f.key);
      for (const k of g.expect.findings) expect(keys).toContain(k);
      for (const dom of g.expect.notProspects) expect(keys).not.toContain(`prospect:${dom}`);
      expect(JSON.stringify(d)).not.toContain("contract");
      // Phase 17C detail fields: the founder's input, each research step's subject, the free authority and the
      // spend actually recorded in the provider ledger for the mission's child runs ($0: free missions).
      expect(d.mission.input).toMatchObject(g.input);
      for (const s of d.steps) if (s.kind === "child_run" && s.key !== "prospect") expect(s.subject).toEqual({ query: expect.stringMatching(/\.example$/) });
      expect(d.authority).toEqual({ maxCostUsd: 0, paidProviders: false, webSearch: false, deepResearch: false });
      expect(d.spend).toEqual({ committedUsd: 0, settledUsd: 0, calls: 0 });
      expect(JSON.stringify(d)).not.toContain("lease_owner");
      // Another organization cannot see it.
      expect((await get(api(PREVIEW_ORG, `/${m.id}`), B.accessToken)).status).toBe(404);
      // A finished mission is inert.
      const again = await (await post(api(PREVIEW_ORG, `/${m.id}/execute`), {}, { token: owner.accessToken })).json();
      expect(again).toMatchObject({ state: "completed", executed: [] });
    });

  test("a deterministic child failure fails the mission (required step), nothing after it runs", async () => {
    const created = await (await post(api(PREVIEW_ORG), mission({ input: { target: { companyId: crypto.randomUUID() } } }), { token: owner.accessToken })).json();
    const { body } = await runToEnd(created.mission.id);
    expect(body.mission).toMatchObject({ status: "failed", failureReason: "step_failed" });
    expect(body.steps.map((s: { key: string; status: string; error: string | null }) => stepLine(s))).toEqual(["research:failed:target_not_found", "compile:skipped"]);
    expect(body.findings).toEqual([]);
  });

  test("cancel: viewer refused; owner cancels; executing a cancelled mission does nothing; a second cancel conflicts", async () => {
    const created = await (await post(api(PREVIEW_ORG), mission({ template: "prospect_and_research", input: { intent: "customers", researchTop: 2 } }), { token: owner.accessToken })).json();
    const id = created.mission.id;
    const first = await (await post(api(PREVIEW_ORG, `/${id}/execute`), {}, { token: owner.accessToken })).json();
    expect(first.state).toBe("yielded");
    expect((await post(api(PREVIEW_ORG, `/${id}/cancel`), {}, { token: viewer.accessToken })).status).toBe(403);
    const cancelled = await post(api(PREVIEW_ORG, `/${id}/cancel`), {}, { token: owner.accessToken });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ status: "cancelled", cancelledSteps: 3, cancelledRuns: 0, runningRuns: 0 });
    expect((await post(api(PREVIEW_ORG, `/${id}/cancel`), {}, { token: owner.accessToken })).status).toBe(409);
    const after = await (await post(api(PREVIEW_ORG, `/${id}/execute`), {}, { token: owner.accessToken })).json();
    expect(after).toMatchObject({ state: "cancelled", executed: [], mission: { status: "cancelled" } });
  });

  test("the list shows the workspace's missions to viewers; no provider spend or usage was recorded", async () => {
    const list = await (await get(api(PREVIEW_ORG), viewer.accessToken)).json();
    expect(list.missions.length).toBeGreaterThanOrEqual(5);
    expect((await sql`select count(*)::int as n from public.provider_spend where organization_id = ${PREVIEW_ORG}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from public.usage_events where organization_id = ${PREVIEW_ORG}`)[0].n).toBe(0);
  });
});
