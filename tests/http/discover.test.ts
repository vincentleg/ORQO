/**
 * Discover / Prospecting Agent over HTTP against a running server (BASE_URL,
 * default http://localhost:3100). No provider is configured or called.
 *
 * The preview block runs only when TEST_PREVIEW_ORG is set to a SYNTHETIC id
 * (reserved 7e570000- namespace, never a real preview org) and the server was
 * started with ORQO_AGENT_PREVIEW_ORGS=<that id> (and without research preview):
 * it runs discover_companies end to end over stored research only. The suite
 * creates that organization itself and removes it only after proving ownership.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PEER_FIXTURE, SERVICES_OWN, STRONG } from "@/lib/discovery/fixtures";
import type { TargetProfile } from "@/lib/intelligence/types";
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

const url = (org: string) => `${BASE}/api/v1/organizations/${org}/agents/missions`;
function post(org: string, body: unknown, token?: string, headers: Record<string, string> = {}) {
  const h = new Headers({ "content-type": "application/json", ...headers });
  if (token) h.set("authorization", `Bearer ${token}`);
  return fetch(url(org), { method: "POST", headers: h, body: JSON.stringify(body), redirect: "manual" });
}
const discover = (over: Record<string, unknown> = {}) => ({ agentId: "prospecting", missionType: "discover_companies", input: { intent: "customers" }, idempotencyKey: crypto.randomUUID(), ...over });
const count = async (table: string, org: string) => (await sql`select count(*)::int as n from ${sql(`public.${table}`)} where organization_id = ${org}`)[0].n as number;
async function ndjson(res: Response): Promise<Record<string, unknown>[]> {
  return (await res.text())
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

beforeAll(async () => {
  const up = await fetch(`${BASE}/api/status`).catch(() => null);
  if (!up?.ok) throw new Error(`ORQO server not reachable at ${BASE}; start it first (bun run build && bun run start -p 3100).`);
  await cleanupTestData();
  [A, B, V] = await Promise.all([createTestUser("p5http-a"), createTestUser("p5http-b"), createTestUser("p5http-v")]);
  orgA = await createOrganization(A.db, { name: "P5 HTTP A" });
  await addMember(orgA, V.id, "viewer");
});
afterAll(cleanupTestData);

describe("discover mission: refusals before anything executes", () => {
  test("anonymous 401 · other organization 404 · viewer 403 · CSRF refused", async () => {
    expect((await post(orgA, discover())).status).toBe(401);
    expect((await post(orgA, discover(), B.accessToken)).status).toBe(404);
    const viewer = await post(orgA, discover(), V.accessToken);
    expect(viewer.status).toBe(403);
    expect((await viewer.json()).error.reason).toBe("role");
    expect((await post(orgA, discover(), A.accessToken, { origin: "https://evil.example" })).status).toBe(403);
    expect(await count("agent_missions", orgA)).toBe(0);
  });

  test("Free → 403 plan_required (Pro) for workspace AND web sources; nothing created, no provider reached", async () => {
    for (const input of [{ intent: "customers" }, { intent: "customers", source: "web_search" }]) {
      const res = await post(orgA, discover({ input, autonomy: 2 }), A.accessToken);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { reason: "plan_required", requiredPlan: "pro" } });
    }
    expect(await count("agent_missions", orgA)).toBe(0);
    expect(await count("usage_events", orgA)).toBe(0);
  });

  test("forged plan, budget, tools, organization or approval at the top level → 400", async () => {
    for (const forged of [{ plan: "pro" }, { budget: { maxExternalRequests: 999 } }, { tools: ["search_web_candidates"] }, { organizationId: crypto.randomUUID() }, { approved: true }, { preview: true }])
      expect((await post(orgA, discover(forged), A.accessToken)).status).toBe(400);
    expect(await count("agent_missions", orgA)).toBe(0);
  });
});

describe.skipIf(!PREVIEW_ORG)("operator preview: discover_companies end to end over stored research", () => {
  let owner: TestUser;
  const store = async (p: TargetProfile) => {
    const rr = await startResearchRun(owner.db, PREVIEW_ORG, "basic", p.domain, p.domain);
    await saveIntelligence(owner.db, PREVIEW_ORG, rr, "basic", p, []);
    await finishRun(owner.db, PREVIEW_ORG, rr, { ok: true, domain: p.domain, counters: {} });
  };
  beforeAll(async () => {
    owner = await createTestUser("p5http-preview");
    await createSyntheticPreviewOrg(owner, "P5 Preview");
    await createCompany(owner.db, PREVIEW_ORG, { name: "Own Co", website: "https://own.example", isOwnCompany: true });
    await updateOwnCompanyProfile(owner.db, PREVIEW_ORG, { ...SERVICES_OWN, website: "https://own.example" });
    await store(STRONG);
    await store(PEER_FIXTURE);
    await createCompany(owner.db, PREVIEW_ORG, { name: "Strong Systems", website: "https://strong.example" });
  });

  test("streams real steps, qualifies from stored evidence, marks the Network company, spends nothing; replay never runs twice", async () => {
    const body = discover();
    const events = await ndjson(await post(PREVIEW_ORG, body, owner.accessToken));
    expect(events[0]).toMatchObject({ type: "accepted", reused: false });
    expect(events.filter((e) => e.type === "step" && e.status !== "running").map((e) => `${e.key}:${e.status}`)).toEqual([
      "load_workspace_context:completed",
      "build_discovery_plan:completed",
      "read_existing_knowledge:completed",
      "find_candidates:completed",
      "deduplicate_candidates:completed",
      "verify_candidates:completed",
      "qualify_candidates:completed",
      "apply_critic:completed",
      "produce_result:completed",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed" });
    const runId = events[0].runId as string;
    const detail = await (await fetch(`${BASE}/api/v1/organizations/${PREVIEW_ORG}/agents/runs/${runId}`, { headers: { authorization: `Bearer ${owner.accessToken}` } })).json();
    expect(detail.run.result).toMatchObject({ kind: "company_discovery", source: { id: "workspace_knowledge", live: false } });
    const strong = detail.run.result.companies.find((c: { domain: string }) => c.domain === "strong.example");
    expect(strong.network).not.toBeNull();
    expect(detail.run.result.rejected.map((r: { domain: string }) => r.domain)).toContain("peer.example");
    expect(detail.toolCalls.map((c: { toolId: string }) => c.toolId)).not.toContain("official_site_research");
    expect(await count("usage_events", PREVIEW_ORG)).toBe(0);

    const replay = await ndjson(await post(PREVIEW_ORG, body, owner.accessToken));
    expect(replay[0]).toMatchObject({ type: "accepted", reused: true, runId });
    expect(replay.at(-1)).toMatchObject({ type: "done", status: "reused" });
  });

  test("forged mission input (plan, tools, budget, limits, unknown source) → 400, nothing created", async () => {
    const before = await count("agent_missions", PREVIEW_ORG);
    for (const input of [{ intent: "customers", plan: { mechanisms: ["build_for"] } }, { tools: ["deep_company_research"] }, { budget: { maxToolCalls: 99 } }, { maxResults: 99 }, { source: "exa" }, { intent: "everything" }])
      expect((await post(PREVIEW_ORG, discover({ input }), owner.accessToken)).status).toBe(400);
    expect(await count("agent_missions", PREVIEW_ORG)).toBe(before);
  });

  test("autonomy 3 refused; paid web search refused before approval or provider (agent preview grants no paid spend)", async () => {
    const three = await post(PREVIEW_ORG, discover({ autonomy: 3 }), owner.accessToken);
    expect(three.status).toBe(400);
    expect((await three.json()).error.reason).toBe("autonomy_not_allowed");
    const low = await ndjson(await post(PREVIEW_ORG, discover({ input: { source: "web_search" }, autonomy: 1 }), owner.accessToken));
    expect(low.at(-1)).toMatchObject({ status: "failed", error: "tool_denied" });
    const web = await ndjson(await post(PREVIEW_ORG, discover({ input: { source: "web_search" }, autonomy: 2 }), owner.accessToken));
    expect(web.at(-1)).toMatchObject({ status: "failed", error: expect.stringMatching(/^(search_not_permitted|provider_not_configured)$/) });
    expect(await count("agent_approvals", PREVIEW_ORG)).toBe(0);
    expect(await count("usage_events", PREVIEW_ORG)).toBe(0);
  });
});
