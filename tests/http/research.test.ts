/**
 * The research route's server-side gate, over HTTP against a running server
 * (BASE_URL, default http://localhost:3100). No paid provider is configured
 * or called: refusals happen before any provider, and the one executed run
 * targets a public name that resolves to 127.0.0.1 (SSRF check).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extractTargetProfile } from "@/lib/intelligence/extract";
import { FIXTURE_HOME } from "@/lib/intelligence/fixtures";
import { parseHtml } from "@/lib/intelligence/html";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { RESEARCH_QUOTAS } from "@/lib/server/research/config";
import { addMember, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
let A: TestUser;
let B: TestUser;
let V: TestUser;
let orgA: string;
let orgB: string;

const path = (org: string) => `/api/v1/organizations/${org}/research`;
function post(org: string, body: unknown, opts: { token?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ "content-type": "application/json", ...opts.headers });
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  return fetch(`${BASE}${path(org)}`, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
}
const runCount = async (org: string) => (await sql`select count(*)::int as n from public.research_runs where organization_id = ${org}`)[0].n as number;

beforeAll(async () => {
  const up = await fetch(`${BASE}/api/status`).catch(() => null);
  if (!up?.ok) throw new Error(`ORQO server not reachable at ${BASE}; start it first (bun run build && bun run start -p 3100).`);
  await cleanupTestData();
  [A, B, V] = await Promise.all([createTestUser("p3http-a"), createTestUser("p3http-b"), createTestUser("p3http-v")]);
  orgA = await createOrganization(A.db, { name: "P3 HTTP A" });
  orgB = await createOrganization(B.db, { name: "P3 HTTP B" });
  await addMember(orgA, V.id, "viewer");
});
afterAll(cleanupTestData);

describe("research route: refusals before any provider call", () => {
  test("anonymous → 401", async () => {
    const res = await post(orgA, { query: "example.com" });
    expect(res.status).toBe(401);
    expect(await runCount(orgA)).toBe(0);
  });

  test("CSRF: non-JSON content type → 400; foreign Origin → 403", async () => {
    const form = await fetch(`${BASE}${path(orgA)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Bearer ${A.accessToken}` }, body: "query=example.com" });
    expect(form.status).toBe(400);
    const foreign = await post(orgA, { query: "example.com" }, { token: A.accessToken, headers: { origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    expect(await runCount(orgA)).toBe(0);
  });

  test("another organization's workspace → 404 (no enumeration)", async () => {
    const res = await post(orgA, { query: "example.com" }, { token: B.accessToken });
    expect(res.status).toBe(404);
  });

  test("viewer → 403 role", async () => {
    const res = await post(orgA, { query: "example.com" }, { token: V.accessToken });
    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("role");
  });

  test("Free workspace → deep research refused server-side (plan_required)", async () => {
    const res = await post(orgA, { query: "example.com", mode: "deep" }, { token: A.accessToken });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { reason: "plan_required", requiredPlan: "pro" } });
    expect(await runCount(orgA)).toBe(0);
  });

  test("invalid input → 400", async () => {
    for (const body of [{ query: "!!!" }, { query: "" }, { query: "a".repeat(300) }, { query: "x.com", mode: "unlimited" }]) {
      expect((await post(orgA, body, { token: A.accessToken })).status).toBe(400);
    }
  });

  test("quota exhausted → 429, nothing runs", async () => {
    const n = RESEARCH_QUOTAS.basic.maxRunsPerOrg;
    await sql`insert into public.research_runs (organization_id, mode, query, status, finished_at) select ${orgB}, 'basic', 'seed', 'succeeded', now() from generate_series(1, ${n})`;
    const res = await post(orgB, { query: "example.com" }, { token: B.accessToken });
    expect(res.status).toBe(429);
    expect((await res.json()).error.reason).toBe("quota_exhausted");
    expect(await runCount(orgB)).toBe(n);
  });
});

describe("research route: cache and execution", () => {
  test("a fresh stored analysis is reused without a new run; early refresh is refused", async () => {
    const now = new Date().toISOString();
    const profile = extractTargetProfile({
      nameHint: null,
      domain: "nimbusfabric.example",
      website: "https://nimbusfabric.example",
      resolution: { method: "url", confidence: "strong" },
      pages: [{ doc: parseHtml(FIXTURE_HOME, "https://nimbusfabric.example/"), source: { key: "s0", url: "https://nimbusfabric.example/", title: "Home", authority: "official", pageType: "home", retrievedAt: now } }],
      now: new Date(),
    });
    const run = await startResearchRun(A.db, orgA, "basic", "seed", profile.domain);
    await saveIntelligence(A.db, orgA, run, "basic", profile, []);
    await finishRun(A.db, orgA, run, { ok: true, domain: profile.domain, counters: {} });
    const before = await runCount(orgA);

    const cached = await post(orgA, { query: "https://www.nimbusfabric.example/about" }, { token: A.accessToken });
    expect(cached.status).toBe(200);
    expect(await cached.json()).toEqual({ status: "cached", domain: "nimbusfabric.example" });
    const refresh = await post(orgA, { query: "nimbusfabric.example", refresh: true }, { token: A.accessToken });
    expect(refresh.status).toBe(409);
    expect((await refresh.json()).error.reason).toBe("refresh_too_soon");
    expect(await runCount(orgA)).toBe(before);
  });

  test("SSRF end-to-end: a public name resolving to 127.0.0.1 is refused and the run is recorded as failed", async () => {
    const res = await post(orgA, { query: "localtest.me" }, { token: A.accessToken });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("ndjson");
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events[0]).toEqual({ type: "stage", stage: "resolving" });
    expect(events.at(-1)).toMatchObject({ type: "error", code: "site_blocked" });
    const [run] = await sql`select status, error_code from public.research_runs where organization_id = ${orgA} and query = 'localtest.me'`;
    expect(run).toEqual({ status: "failed", error_code: "site_blocked" });
    const [{ n }] = await sql`select count(*)::int as n from public.usage_events where organization_id = ${orgA}`;
    expect(n).toBe(0); // no paid provider was reached
  });
});
