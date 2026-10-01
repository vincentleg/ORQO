/**
 * Agent mission/run routes over HTTP against a running server (BASE_URL,
 * default http://localhost:3100). No paid provider is configured or called.
 *
 * The preview block needs the server started with
 *   ORQO_AGENT_PREVIEW_ORGS=<AGENT_PREVIEW_ORG>
 * and the same AGENT_PREVIEW_ORG in the test environment; it then runs the
 * Research Agent end to end over stored research (no network fetch).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extractTargetProfile } from "@/lib/intelligence/extract";
import { FIXTURE_ABOUT, FIXTURE_HOME } from "@/lib/intelligence/fixtures";
import { parseHtml } from "@/lib/intelligence/html";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { addMember, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PREVIEW_ORG = process.env.AGENT_PREVIEW_ORG ?? "";
const DOMAIN = "nimbusfabric.example";
let A: TestUser;
let B: TestUser;
let V: TestUser;
let orgA: string;
let orgB: string;

const api = (org: string, path: string) => `${BASE}/api/v1/organizations/${org}/agents/${path}`;
function post(url: string, body: unknown, opts: { token?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ "content-type": "application/json", ...opts.headers });
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
}
const get = (url: string, token?: string) => fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: "manual" });
const mission = (over: Record<string, unknown> = {}) => ({ missionType: "analyze_company", input: { target: { query: DOMAIN } }, idempotencyKey: crypto.randomUUID(), ...over });
const missions = async (org: string) => (await sql`select count(*)::int as n from public.agent_missions where organization_id = ${org}`)[0].n as number;

async function ndjson(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

beforeAll(async () => {
  const up = await fetch(`${BASE}/api/status`).catch(() => null);
  if (!up?.ok) throw new Error(`ORQO server not reachable at ${BASE}; start it first (bun run build && bun run start -p 3100).`);
  await cleanupTestData();
  [A, B, V] = await Promise.all([createTestUser("p4http-a"), createTestUser("p4http-b"), createTestUser("p4http-v")]);
  orgA = await createOrganization(A.db, { name: "P4 HTTP A" });
  orgB = await createOrganization(B.db, { name: "P4 HTTP B" });
  await addMember(orgA, V.id, "viewer");
});
afterAll(cleanupTestData);

describe("mission route: refusals before anything executes", () => {
  test("anonymous → 401 (create and read)", async () => {
    expect((await post(api(orgA, "missions"), mission())).status).toBe(401);
    expect((await get(api(orgA, "runs"))).status).toBe(401);
    expect(await missions(orgA)).toBe(0);
  });

  test("CSRF: non-JSON → 400; foreign Origin → 403", async () => {
    const form = await fetch(api(orgA, "missions"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Bearer ${A.accessToken}` }, body: "missionType=analyze_company" });
    expect(form.status).toBe(400);
    expect((await post(api(orgA, "missions"), mission(), { token: A.accessToken, headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  test("another organization → 404 (create, list, run detail)", async () => {
    expect((await post(api(orgA, "missions"), mission(), { token: B.accessToken })).status).toBe(404);
    expect((await get(api(orgA, "runs"), B.accessToken)).status).toBe(404);
  });

  test("viewer → 403 role", async () => {
    const res = await post(api(orgA, "missions"), mission(), { token: V.accessToken });
    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("role");
  });

  test("Free workspace → 403 plan_required for every executable agent; nothing created", async () => {
    const research = await post(api(orgA, "missions"), mission(), { token: A.accessToken });
    expect(research.status).toBe(403);
    expect(await research.json()).toMatchObject({ error: { reason: "plan_required", requiredPlan: "pro" } });
    const partner = await post(api(orgA, "missions"), mission({ missionType: "explain_opportunities" }), { token: A.accessToken });
    expect(await partner.json()).toMatchObject({ error: { reason: "plan_required", requiredPlan: "business" } });
    expect(await missions(orgA)).toBe(0);
  });

  test("forged fields are rejected: plan, budget, tools, organization, approval, unknown mission/agent, autonomy out of range", async () => {
    for (const body of [
      mission({ plan: "business" }),
      mission({ budget: { maxToolCalls: 1000 } }),
      mission({ tools: ["deep_company_research"] }),
      mission({ organizationId: orgB }),
      mission({ approved: true }),
      mission({ missionType: "send_email" }),
      mission({ autonomy: 7 }),
      mission({ idempotencyKey: "not-a-uuid" }),
    ])
      expect((await post(api(orgA, "missions"), body, { token: A.accessToken })).status).toBe(400);
    const unknown = await post(api(orgA, "missions"), mission({ agentId: "superAgent" }), { token: A.accessToken });
    expect(await unknown.json()).toMatchObject({ error: { reason: "unknown_agent" } });
    const soon = await post(api(orgA, "missions"), mission({ agentId: "prospecting" }), { token: A.accessToken });
    expect(await soon.json()).toMatchObject({ error: { reason: "agent_unavailable" } });
    expect(await missions(orgA)).toBe(0);
  });
});

describe("run reads, cancel and approvals", () => {
  let runId: string;
  beforeAll(async () => {
    // A direct RPC call creates a queued run but can never execute it (execution happens only in the route).
    const { data } = await A.db.rpc("create_agent_mission", { p_organization_id: orgA, p_agent_id: "research", p_mission_type: "analyze_company", p_capability: "company_research", p_objective: "x", p_input: { target: { query: DOMAIN } }, p_autonomy: 1, p_limits: {}, p_idempotency_key: crypto.randomUUID(), p_max_runs: 30, p_window_hours: 24, p_stale_after_seconds: 180 });
    runId = (data as { run_id: string }).run_id;
  });

  test("members and viewers read their runs; other organizations cannot", async () => {
    const list = await get(api(orgA, "runs"), V.accessToken);
    expect(list.status).toBe(200);
    expect((await list.json()).runs.map((r: { id: string }) => r.id)).toContain(runId);
    expect((await get(api(orgA, `runs/${runId}`), A.accessToken)).status).toBe(200);
    expect((await get(api(orgA, `runs/${runId}`), B.accessToken)).status).toBe(404);
    expect((await get(api(orgB, `runs/${runId}`), B.accessToken)).status).toBe(404);
  });

  test("cancel: viewer refused, starter cancels a queued run once", async () => {
    expect((await post(api(orgA, `runs/${runId}/cancel`), {}, { token: V.accessToken })).status).toBe(403);
    expect((await post(api(orgA, `runs/${runId}/cancel`), {}, { token: A.accessToken })).status).toBe(200);
    expect((await post(api(orgA, `runs/${runId}/cancel`), {}, { token: A.accessToken })).status).toBe(409);
  });

  test("approval decisions: non-admin 403, other organization 404, unknown approval 404", async () => {
    const fake = crypto.randomUUID();
    expect((await post(api(orgA, `approvals/${fake}`), { decision: "approve" }, { token: V.accessToken })).status).toBe(403);
    expect((await post(api(orgA, `approvals/${fake}`), { decision: "approve" }, { token: B.accessToken })).status).toBe(404);
    expect((await post(api(orgA, `approvals/${fake}`), { decision: "approve" }, { token: A.accessToken })).status).toBe(404);
    expect((await post(api(orgA, `approvals/${fake}`), { decision: "approve", force: true }, { token: A.accessToken })).status).toBe(400);
  });
});

describe.skipIf(!PREVIEW_ORG)("operator preview: Research Agent end to end over stored research", () => {
  let owner: TestUser;
  beforeAll(async () => {
    owner = await createTestUser("p4http-preview");
    await sql`delete from public.organizations where id = ${PREVIEW_ORG}`;
    await sql`insert into public.organizations (id, name, created_by) values (${PREVIEW_ORG}, 'P4 Preview', ${owner.id})`;
    await addMember(PREVIEW_ORG, owner.id, "owner");
    const now = new Date();
    const src = (key: string, url: string, pageType: "home" | "about") => ({ key, url, title: url, authority: "official" as const, pageType, retrievedAt: now.toISOString() });
    const profile = extractTargetProfile({ nameHint: null, domain: DOMAIN, website: `https://${DOMAIN}`, resolution: { method: "url", confidence: "strong" }, pages: [{ doc: parseHtml(FIXTURE_HOME, `https://${DOMAIN}/`), source: src("s0", `https://${DOMAIN}/`, "home") }, { doc: parseHtml(FIXTURE_ABOUT, `https://${DOMAIN}/about`), source: src("s1", `https://${DOMAIN}/about`, "about") }], now });
    const rr = await startResearchRun(owner.db, PREVIEW_ORG, "basic", DOMAIN, DOMAIN);
    await saveIntelligence(owner.db, PREVIEW_ORG, rr, "basic", profile, []);
    await finishRun(owner.db, PREVIEW_ORG, rr, { ok: true, domain: DOMAIN, counters: {} });
  });

  test("mission streams real steps, reuses stored research, and a replayed key never runs twice", async () => {
    const body = mission();
    const res = await post(api(PREVIEW_ORG, "missions"), body, { token: owner.accessToken });
    expect(res.headers.get("content-type")).toContain("ndjson");
    const events = await ndjson(res);
    expect(events[0]).toMatchObject({ type: "accepted", reused: false });
    expect(events.filter((e) => e.type === "step" && e.status !== "running").map((e) => `${e.key}:${e.status}`)).toEqual([
      "load_workspace_context:completed",
      "resolve_target:completed",
      "retrieve_existing_research:completed",
      "run_research:skipped",
      "evaluate_relevance:completed",
      "produce_result:completed",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed" });
    const runId = events[0].runId as string;

    const replay = await ndjson(await post(api(PREVIEW_ORG, "missions"), body, { token: owner.accessToken }));
    expect(replay[0]).toMatchObject({ type: "accepted", reused: true, runId });
    expect(replay.at(-1)).toMatchObject({ type: "done", status: "reused" });
    expect((await sql`select count(*)::int as n from public.agent_runs where organization_id = ${PREVIEW_ORG}`)[0].n).toBe(1);

    const detail = await (await get(api(PREVIEW_ORG, `runs/${runId}`), owner.accessToken)).json();
    expect(detail.run).toMatchObject({ status: "completed", result: { kind: "company_analysis", reusedResearch: true } });
    expect(detail.toolCalls.map((c: { toolId: string }) => c.toolId)).toEqual(["read_workspace_company", "read_stored_research", "evaluate_business_relevance"]);
  });

  test("autonomy above the agent's range is refused even with preview", async () => {
    const res = await post(api(PREVIEW_ORG, "missions"), mission({ autonomy: 3 }), { token: owner.accessToken });
    expect(res.status).toBe(400);
    expect((await res.json()).error.reason).toBe("autonomy_not_allowed");
  });

  test("deep research: preview grants no deep entitlement — refused before any approval or provider call", async () => {
    const events = await ndjson(await post(api(PREVIEW_ORG, "missions"), mission({ input: { target: { query: "other.example" }, depth: "deep" }, autonomy: 2 }), { token: owner.accessToken }));
    expect(events.at(-1)).toMatchObject({ type: "done", status: "failed", error: "research_refused" });
    expect((await sql`select count(*)::int as n from public.agent_approvals where organization_id = ${PREVIEW_ORG}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from public.usage_events where organization_id = ${PREVIEW_ORG}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from public.research_runs where organization_id = ${PREVIEW_ORG} and mode = 'deep'`)[0].n).toBe(0);
  });

  test("Observe with nothing stored fails safely without touching the web", async () => {
    const events = await ndjson(await post(api(PREVIEW_ORG, "missions"), mission({ input: { target: { query: "unknown-target.example" } }, autonomy: 0 }), { token: owner.accessToken }));
    expect(events.at(-1)).toMatchObject({ status: "failed", error: "research_not_permitted" });
  });

  test("Partnership Manager explains stored analysis; without it, research_required", async () => {
    const ok = await ndjson(await post(api(PREVIEW_ORG, "missions"), mission({ missionType: "explain_opportunities", input: { target: { query: DOMAIN } } }), { token: owner.accessToken }));
    expect(ok.at(-1)).toMatchObject({ status: "completed" });
    const none = await ndjson(await post(api(PREVIEW_ORG, "missions"), mission({ missionType: "explain_opportunities", input: { target: { query: "nothing.example" } } }), { token: owner.accessToken }));
    expect(none.at(-1)).toMatchObject({ status: "failed", error: "research_required" });
  });
});
