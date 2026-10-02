/**
 * Phase 17A governance against the isolated ORQO Test database, as signed-in users under RLS:
 * authority set once and immutable; spend reserved only for a running run whose authority allows it, within
 * per-call, per-run and organization caps; parallel reservations cannot overspend; settlement once, by the
 * reserving user, conservative when cost is unknown; tripwire audit; tenant isolation; no anon or service_role.
 * Synthetic organizations only. No provider is called.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { buildAuthority, type AuthorityContract } from "@/lib/governance/authority";
import { resolveEntitlementFrom } from "@/lib/governance/entitlement";
import { createMission } from "@/lib/server/agents/repository";
import { getRunAuthority, recordTripwire, ReservationRefused, reserveSpend, setRunAuthority, settleSpend, spendSummary } from "@/lib/server/governance/ledger";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { startResearchRun } from "@/lib/server/research/repository";
import { addMember, anonClient, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

let A: TestUser;
let V: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;

/** The error a statement raised, or null. (Bun's lazy SQL queries are awaited explicitly, not passed to expect().) */
async function failure(run: () => PromiseLike<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (e) {
    return e;
  }
}

const ENV = (org: string) => ({ ORQO_INTERNAL_ORGS: org, ORQO_INTERNAL_BUDGET_USD: "1" });

async function newRun(user: TestUser, org: string, maxCostUsd = 0.5, maxProviderCalls?: number): Promise<{ runId: string; authority: AuthorityContract }> {
  const m = await createMission(user.db, org, { agentId: "research", missionType: "analyze_company", capability: "company_research", objective: "governance test", input: { target: { query: "example.com" }, mode: "deep", refresh: false }, autonomy: 2, limits: AGENT_REGISTRY.research.limits, idempotencyKey: crypto.randomUUID() });
  const authority = buildAuthority({ principal: { organizationId: org, userId: user.id }, entitlement: resolveEntitlementFrom(org, "free", ENV(org)), agent: AGENT_REGISTRY.research, capability: "company_research", autonomy: 2, envelope: { maxCostUsd, maxProviderCalls }, ids: { missionId: m.missionId, runId: m.runId } });
  return { runId: m.runId, authority };
}
async function startRun(user: TestUser, org: string, runId: string) {
  const { error } = await user.db.from("agent_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("organization_id", org).eq("id", runId);
  if (error) throw error;
}
async function finish(user: TestUser, org: string, runId: string) {
  await user.db.from("agent_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_code: "internal" }).eq("organization_id", org).eq("id", runId);
}
const reserve = (user: TestUser, org: string, runId: string | null, over: Partial<Parameters<typeof reserveSpend>[1]> = {}) =>
  reserveSpend(user.db, { organizationId: org, agentRunId: runId, researchRunId: null, provider: "openrouter", task: "extraction", model: "google/gemini-3.8-flash", amountUsd: 0.02, ceilingUsd: 1, idempotencyKey: crypto.randomUUID(), ...over });

beforeAll(async () => {
  await cleanupTestData();
  [A, V, B] = await Promise.all([createTestUser("p17-a"), createTestUser("p17-v"), createTestUser("p17-b")]);
  orgA = await createOrganization(A.db, { name: "P17 Org A" });
  orgB = await createOrganization(B.db, { name: "P17 Org B" });
  await addMember(orgA, V.id, "viewer");
});
afterAll(cleanupTestData);

describe("authority snapshot", () => {
  test("set once while queued, read back exactly, then immutable for everyone", async () => {
    const { runId, authority } = await newRun(A, orgA);
    await setRunAuthority(A.db, orgA, runId, authority);
    expect(await getRunAuthority(A.db, orgA, runId)).toEqual(authority);
    // A second set, a direct update (no column grant) and even a privileged update are refused.
    await expect(setRunAuthority(A.db, orgA, runId, { ...authority, limits: { ...authority.limits, maxCostUsd: 100 } })).rejects.toThrow();
    await A.db.from("agent_runs").update({ authority: { ...authority, tools: [] } } as never).eq("id", runId);
    expect(String(await failure(() => sql`update public.agent_runs set authority = jsonb_set(authority, '{limits,maxCostUsd}', '999') where id = ${runId}`))).toMatch(/immutable/);
    expect(await failure(() => sql`update public.agent_runs set depth = 1 where id = ${runId}`)).not.toBeNull();
    expect(await getRunAuthority(A.db, orgA, runId)).toEqual(authority);
    await finish(A, orgA, runId);
  });

  test("the database refuses an authority for another run, organization or user", async () => {
    const { runId, authority } = await newRun(A, orgA);
    await expect(setRunAuthority(A.db, orgA, runId, { ...authority, runId: crypto.randomUUID() })).rejects.toThrow();
    await expect(setRunAuthority(A.db, orgA, runId, { ...authority, userId: B.id })).rejects.toThrow();
    await expect(setRunAuthority(B.db, orgA, runId, authority)).rejects.toThrow(); // not a member
    await expect(setRunAuthority(V.db, orgA, runId, authority)).rejects.toThrow(); // viewer
    await expect(setRunAuthority(A.db, orgA, runId, { ...authority, killSwitch: "off" } as never)).rejects.toThrow();
    expect(await getRunAuthority(A.db, orgA, runId)).toBeNull();
    await finish(A, orgA, runId);
  });

  test("a child authority can never hold more money or children than its parent", async () => {
    const parent = await newRun(A, orgA);
    const parentAuthority = { ...parent.authority, limits: { ...parent.authority.limits, maxChildRuns: 1 } };
    await setRunAuthority(A.db, orgA, parent.runId, parentAuthority);
    await finish(A, orgA, parent.runId);
    const child = await newRun(A, orgA, 0.1);
    const childAuthority = { ...child.authority, parentRunId: parent.runId, depth: 1, limits: { ...child.authority.limits, maxChildRuns: 0 } };
    await expect(setRunAuthority(A.db, orgA, child.runId, { ...childAuthority, limits: { ...childAuthority.limits, maxCostUsd: 0.9 } }, parent.runId)).rejects.toMatchObject({ code: "forbidden" });
    await setRunAuthority(A.db, orgA, child.runId, childAuthority, parent.runId);
    const [row] = await sql`select parent_run_id, depth from public.agent_runs where id = ${child.runId}`;
    expect(row).toMatchObject({ parent_run_id: parent.runId, depth: 1 });
    await finish(A, orgA, child.runId);
    // The parent's single child run is used up.
    const second = await newRun(A, orgA, 0.1);
    await expect(setRunAuthority(A.db, orgA, second.runId, { ...second.authority, parentRunId: parent.runId, depth: 1, limits: { ...second.authority.limits, maxChildRuns: 0 } }, parent.runId)).rejects.toMatchObject({ code: "forbidden" });
    await finish(A, orgA, second.runId);
  });
});

describe("spend reservation", () => {
  test("only for a RUNNING run whose authority allows the provider and task", async () => {
    const { runId, authority } = await newRun(A, orgA);
    await expect(reserve(A, orgA, runId)).rejects.toMatchObject({ refusal: "outside_authority" }); // no authority yet
    await setRunAuthority(A.db, orgA, runId, authority);
    await expect(reserve(A, orgA, runId)).rejects.toMatchObject({ refusal: "outside_authority" }); // still queued
    await startRun(A, orgA, runId);
    await expect(reserve(A, orgA, runId, { task: "critique" })).rejects.toMatchObject({ refusal: "outside_authority" });
    await expect(reserve(A, orgA, runId, { amountUsd: 6 })).rejects.toMatchObject({ refusal: "invalid" }); // per-call cap
    const id = await reserve(A, orgA, runId);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await settleSpend(A.db, orgA, id, "succeeded", 0.004);
    await finish(A, orgA, runId);
  });

  test("run cost and provider-call limits come from the frozen authority", async () => {
    const { runId, authority } = await newRun(A, orgA, 0.05, 2);
    await setRunAuthority(A.db, orgA, runId, authority);
    await startRun(A, orgA, runId);
    await reserve(A, orgA, runId, { amountUsd: 0.03 });
    await expect(reserve(A, orgA, runId, { amountUsd: 0.03 })).rejects.toMatchObject({ refusal: "run_cost" });
    await reserve(A, orgA, runId, { amountUsd: 0.01 });
    await expect(reserve(A, orgA, runId, { amountUsd: 0.001 })).rejects.toMatchObject({ refusal: "run_calls" });
    await finish(A, orgA, runId);
  });

  test("idempotent: the same key returns the reservation as reused, never a second row", async () => {
    const { runId, authority } = await newRun(A, orgA);
    await setRunAuthority(A.db, orgA, runId, authority);
    await startRun(A, orgA, runId);
    const key = crypto.randomUUID();
    await reserve(A, orgA, runId, { idempotencyKey: key });
    await expect(reserve(A, orgA, runId, { idempotencyKey: key })).rejects.toMatchObject({ refusal: "duplicate" });
    const [n] = await sql`select count(*)::int as n from public.provider_spend where idempotency_key = ${key}`;
    expect(n.n).toBe(1);
    await finish(A, orgA, runId);
  });

  test("CONCURRENCY: parallel reservations never exceed the rolling ceiling", async () => {
    const org = await createOrganization(A.db, { name: "P17 Race" });
    const run = await startResearchRun(A.db, org, "deep", "race.example", "race.example");
    // 20 parallel calls of $0.10 against a $0.55 ceiling: exactly 5 may succeed.
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserveSpend(A.db, { organizationId: org, agentRunId: null, researchRunId: run, provider: "brave", task: "web_search", model: null, amountUsd: 0.1, ceilingUsd: 0.55, idempotencyKey: crypto.randomUUID() })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected" && (r.reason as ReservationRefused).refusal === "ceiling").length;
    expect(ok).toBe(5);
    expect(refused).toBe(15);
    const [s] = await sql`select sum(reserved_usd)::float as total from public.provider_spend where organization_id = ${org}`;
    expect(s.total).toBeLessThanOrEqual(0.55);
  });

  test("exact ceiling: a call that fits exactly is allowed, one cent more is refused", async () => {
    const org = await createOrganization(A.db, { name: "P17 Exact" });
    const run = await startResearchRun(A.db, org, "deep", "exact.example", "exact.example");
    const r = (amountUsd: number) => reserveSpend(A.db, { organizationId: org, agentRunId: null, researchRunId: run, provider: "brave", task: "web_search", model: null, amountUsd, ceilingUsd: 0.3, idempotencyKey: crypto.randomUUID() });
    await r(0.3);
    await expect(r(0.01)).rejects.toMatchObject({ refusal: "ceiling" });
  });
});

describe("settlement", () => {
  test("once, by the reserving user; unknown cost keeps the full reservation; not_sent releases", async () => {
    const org = await createOrganization(A.db, { name: "P17 Settle" });
    await addMember(org, V.id, "viewer");
    const run = await startResearchRun(A.db, org, "deep", "settle.example", "settle.example");
    const r = (amountUsd: number) => reserveSpend(A.db, { organizationId: org, agentRunId: null, researchRunId: run, provider: "openrouter", task: "extraction", model: "m/x", amountUsd, ceilingUsd: 1000, idempotencyKey: crypto.randomUUID() });
    const known = await r(0.02);
    const unknown = await r(0.02);
    const unsent = await r(0.02);
    await expect(settleSpend(V.db, org, known, "succeeded", 0.001)).rejects.toThrow(); // viewer
    await expect(settleSpend(B.db, org, known, "succeeded", 0.001)).rejects.toThrow(); // outsider
    await settleSpend(A.db, org, known, "succeeded", 0.001);
    await settleSpend(A.db, org, unknown, "failed", null);
    await settleSpend(A.db, org, unsent, "not_sent", null);
    await expect(settleSpend(A.db, org, known, "succeeded", 0)).rejects.toMatchObject({ code: "forbidden" });
    const rows = await sql`select id, status, settled_usd::float as s, cost_known from public.provider_spend where id in ${sql([known, unknown, unsent])}`;
    const by = Object.fromEntries(rows.map((x: { id: string }) => [x.id, x]));
    expect(by[known]).toMatchObject({ status: "settled", s: 0.001, cost_known: true });
    expect(by[unknown]).toMatchObject({ status: "settled", s: 0.02, cost_known: false });
    expect(by[unsent]).toMatchObject({ status: "released", s: 0 });
    const summary = await spendSummary(A.db, org);
    expect(summary).toMatchObject({ unknownCostCalls: 1, calls: 3 });
    expect(summary.committedUsd).toBeCloseTo(0.021, 6);
  });

  test("usage links to its reservation, within the organization only", async () => {
    const org = await createOrganization(A.db, { name: "P17 Usage" });
    const run = await startResearchRun(A.db, org, "deep", "usage.example", "usage.example");
    const id = await reserveSpend(A.db, { organizationId: org, agentRunId: null, researchRunId: run, provider: "brave", task: "web_search", model: null, amountUsd: 0.01, ceilingUsd: 1000, idempotencyKey: crypto.randomUUID() });
    const { error } = await A.db.from("usage_events").insert({ organization_id: org, research_run_id: run, reservation_id: id, duration_ms: 12, provider: "brave", service: "web/search", operation: "web_search", succeeded: true, units: { queries: 1 } });
    expect(error).toBeNull();
    const { error: cross } = await B.db.from("usage_events").insert({ organization_id: orgB, reservation_id: id, provider: "brave", service: "web/search", operation: "web_search", succeeded: true, units: {} });
    expect(cross).not.toBeNull();
  });
});

describe("tenant isolation, roles and grants", () => {
  test("another organization cannot read, reserve or settle A's spend", async () => {
    const { data } = await B.db.from("provider_spend").select("id").eq("organization_id", orgA);
    expect(data).toEqual([]);
    const iso = await createOrganization(A.db, { name: "P17 Iso" });
    const run = await startResearchRun(A.db, iso, "deep", "iso.example", "iso.example");
    await expect(reserveSpend(B.db, { organizationId: iso, agentRunId: null, researchRunId: run, provider: "brave", task: "web_search", model: null, amountUsd: 0.01, ceilingUsd: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    // B's own organization cannot spend against A's research run either.
    await expect(reserveSpend(B.db, { organizationId: orgB, agentRunId: null, researchRunId: run, provider: "brave", task: "web_search", model: null, amountUsd: 0.01, ceilingUsd: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    expect((await spendSummary(B.db, orgA)).calls).toBe(0);
  });

  test("nobody can write the ledger directly; anon and service_role hold nothing", async () => {
    const { error } = await A.db.from("provider_spend").insert({ organization_id: orgA, provider: "brave", task: "web_search", idempotency_key: crypto.randomUUID(), reserved_usd: 0.01 } as never);
    expect(error).not.toBeNull();
    const { error: upd } = await A.db.from("provider_spend").update({ settled_usd: 0 } as never).eq("organization_id", orgA);
    const [still] = await sql`select count(*)::int as n from public.provider_spend where organization_id = ${orgA} and settled_usd = 0 and status = 'settled'`;
    expect(upd === null ? still.n : 0).toBe(0);
    const { data: anonRows } = await anonClient().from("provider_spend").select("id");
    expect(anonRows ?? []).toEqual([]);
    const grants = await sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'provider_spend' and grantee in ('anon', 'authenticated', 'service_role') order by 1, 2`;
    expect(grants.map((r: { grantee: string; privilege_type: string }) => `${r.grantee}:${r.privilege_type}`)).toEqual(["authenticated:SELECT"]);
    const fn = await sql`select p.proname, array_to_string(p.proacl, ',') as acl, array_to_string(p.proconfig, ',') as cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('reserve_provider_spend', 'settle_provider_spend', 'set_agent_run_authority', 'record_governance_event') order by 1`;
    expect(fn).toHaveLength(4);
    for (const f of fn as { proname: string; acl: string; cfg: string }[]) {
      expect(f.cfg).toBe('search_path=""');
      expect(f.acl).toContain("authenticated=X");
      expect(f.acl).not.toMatch(/(^|,)anon=|(^|,)=X\//);
    }
  });
});

describe("tripwire audit", () => {
  test("recorded for the caller's organization, fixed vocabulary only, members only", async () => {
    const before = (await sql`select count(*)::int as n from public.audit_events where organization_id = ${orgA} and action like 'governance.tripwire.%'`)[0].n;
    await recordTripwire(A.db, orgA, "unauthorized_tool", null, "search_web_candidates");
    const rows = await sql`select action, metadata from public.audit_events where organization_id = ${orgA} and action like 'governance.tripwire.%' order by occurred_at desc limit 1`;
    expect(rows[0]).toMatchObject({ action: "governance.tripwire.unauthorized_tool", metadata: { detail: "search_web_candidates" } });
    const { error } = await A.db.rpc("record_governance_event", { p_organization_id: orgA, p_tripwire: "anything_goes", p_agent_run_id: null, p_detail: null });
    expect(error).not.toBeNull();
    const { error: outsider } = await B.db.rpc("record_governance_event", { p_organization_id: orgA, p_tripwire: "cost_limit", p_agent_run_id: null, p_detail: null });
    expect(outsider).not.toBeNull();
    const after = (await sql`select count(*)::int as n from public.audit_events where organization_id = ${orgA} and action like 'governance.tripwire.%'`)[0].n;
    expect(after).toBe(before + 1);
  });
});
