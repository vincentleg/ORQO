/**
 * Phase 4 persistence: agent missions, runs, steps, tool calls and approvals
 * against the real Supabase development project — RLS isolation, the atomic
 * idempotency/concurrency/quota guard, the database-enforced state machine,
 * approval authority, append-only ledgers, audit events, and the orchestrator
 * end to end over stored research (no network, no provider).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { CompanyAnalysisResult } from "@/lib/agents/contracts";
import { extractTargetProfile } from "@/lib/intelligence/extract";
import { FIXTURE_ABOUT, FIXTURE_HOME } from "@/lib/intelligence/fixtures";
import { parseHtml } from "@/lib/intelligence/html";
import { executeRun } from "@/lib/server/agents/orchestrator";
import { AgentRunRefusedError, cancelRun, createMission, dbRunStore, decideApproval, getRunDetail, listRuns, type NewMission } from "@/lib/server/agents/repository";
import { TOOL_IMPLEMENTATIONS } from "@/lib/server/agents/tools";
import { createCompany, updateOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import type { Db } from "@/lib/server/supabase/types";
import { addMember, anonClient, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

const TABLES = ["agent_missions", "agent_runs", "agent_run_steps", "agent_run_tool_calls", "agent_approvals"];
let A: TestUser; // owner of org A
let M: TestUser; // member of org A
let V: TestUser; // viewer of org A
let B: TestUser; // owner of org B
let orgA: string;
let orgB: string;
const DOMAIN = "nimbusfabric.example";

const mission = (over: Partial<NewMission> = {}): NewMission => ({
  agentId: "research",
  missionType: "analyze_company",
  capability: "company_research",
  objective: `analyze_company · ${DOMAIN}`,
  input: { target: { query: DOMAIN }, depth: "basic", refresh: false },
  autonomy: 1,
  limits: AGENT_REGISTRY.research.limits,
  idempotencyKey: crypto.randomUUID(),
  ...over,
});

/** Moves a run to a terminal state so the org's concurrency guard frees up. */
async function finish(db: Db, org: string, runId: string, missionId: string) {
  const store = dbRunStore(db, org);
  await store.startRun(runId, missionId);
  await store.failRun(runId, missionId, { code: "internal", counters: { toolCalls: 0, modelCalls: 0, externalRequests: 0, costUsd: 0 }, durationMs: 1 });
}

beforeAll(async () => {
  await cleanupTestData();
  [A, M, V, B] = await Promise.all([createTestUser("p4-a"), createTestUser("p4-m"), createTestUser("p4-v"), createTestUser("p4-b")]);
  orgA = await createOrganization(A.db, { name: "P4 Org A" });
  orgB = await createOrganization(B.db, { name: "P4 Org B" });
  await addMember(orgA, M.id, "member");
  await addMember(orgA, V.id, "viewer");
});
afterAll(cleanupTestData);

describe("create_agent_mission", () => {
  test("member creates a queued mission + run; the same idempotency key returns the same run (double click, retry, refresh)", async () => {
    const m = mission();
    const first = await createMission(M.db, orgA, m);
    expect(first).toMatchObject({ status: "queued", reused: false });
    const again = await Promise.all([createMission(M.db, orgA, m), createMission(M.db, orgA, m)]);
    for (const r of again) expect(r).toEqual({ ...first, reused: true });
    const [{ n }] = await sql`select count(*)::int as n from public.agent_runs where organization_id = ${orgA} and mission_id = ${first.missionId}`;
    expect(n).toBe(1);
    await finish(M.db, orgA, first.runId, first.missionId);
  });

  test("viewer, other organization and anon cannot create missions", async () => {
    await expect(createMission(V.db, orgA, mission())).rejects.toMatchObject({ code: "forbidden" });
    await expect(createMission(B.db, orgA, mission())).rejects.toMatchObject({ code: "forbidden" });
    const anon = await anonClient().rpc("create_agent_mission", { p_organization_id: orgA, p_agent_id: "research", p_mission_type: "analyze_company", p_capability: "company_research", p_objective: "x", p_input: {}, p_autonomy: 1, p_limits: {}, p_idempotency_key: crypto.randomUUID(), p_max_runs: 5, p_window_hours: 24, p_stale_after_seconds: 60 });
    expect(anon.error).not.toBeNull();
  });

  test("concurrency: 6 simultaneous different missions → exactly one run", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => createMission(A.db, orgA, mission())));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(AgentRunRefusedError);
    const created = (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createMission>>>).value;
    await finish(A.db, orgA, created.runId, created.missionId);
  });

  test("window quota is enforced atomically (54000)", async () => {
    const used = (await sql`select count(*)::int as n from public.agent_runs where organization_id = ${orgA}`)[0].n as number;
    const call = () => A.db.rpc("create_agent_mission", { p_organization_id: orgA, p_agent_id: "research", p_mission_type: "analyze_company", p_capability: "company_research", p_objective: "q", p_input: {}, p_autonomy: 1, p_limits: {}, p_idempotency_key: crypto.randomUUID(), p_max_runs: used, p_window_hours: 24, p_stale_after_seconds: 60 });
    const r = await call();
    expect(r.error?.code).toBe("54000");
  });
});

describe("state machine and immutability (database-enforced)", () => {
  let runId: string;
  let missionId: string;
  beforeAll(async () => {
    ({ runId, missionId } = await createMission(M.db, orgA, mission()));
  });

  test("queued → completed is refused; members cannot touch autonomy, limits or approval_state", async () => {
    const skip = await M.db.from("agent_runs").update({ status: "completed" }).eq("id", runId);
    expect(skip.error?.code).toBe("23514");
    expect((await M.db.from("agent_runs").update({ autonomy: 3 }).eq("id", runId)).error).not.toBeNull();
    expect((await M.db.from("agent_runs").update({ limits: { maxToolCalls: 9999 } }).eq("id", runId)).error).not.toBeNull();
    expect((await M.db.from("agent_runs").update({ approval_state: "approved" }).eq("id", runId)).error).not.toBeNull();
    expect((await M.db.from("agent_missions").update({ autonomy: 3 }).eq("id", missionId)).error).not.toBeNull();
    expect((await M.db.from("agent_missions").insert({ organization_id: orgA, agent_id: "research", mission_type: "x", capability: "x", objective: "x", input: {}, autonomy: 3, idempotency_key: crypto.randomUUID() })).error).not.toBeNull();
  });

  test("running cannot be cancelled; waiting resumes only after approval; finished runs are final", async () => {
    const store = dbRunStore(M.db, orgA);
    await store.startRun(runId, missionId);
    expect((await M.db.from("agent_runs").update({ status: "cancelled" }).eq("id", runId)).error?.code).toBe("23514");
    await expect(cancelRun(M.db, orgA, runId)).rejects.toMatchObject({ code: "conflict" });
    await store.requestApproval(runId, "deep_company_research", { toolId: "deep_company_research" });
    expect((await M.db.from("agent_runs").update({ status: "running" }).eq("id", runId)).error?.code).toBe("42501");
    // A member cannot approve: no table grant, and the RPC requires admin.
    const [approval] = await sql`select id from public.agent_approvals where run_id = ${runId}`;
    expect((await M.db.from("agent_approvals").update({ state: "approved" }).eq("id", approval.id)).error).not.toBeNull();
    await expect(decideApproval(M.db, orgA, approval.id, "approve")).rejects.toMatchObject({ code: "forbidden" });
    await expect(decideApproval(B.db, orgA, approval.id, "approve")).rejects.toMatchObject({ code: "forbidden" });
    expect(await decideApproval(A.db, orgA, approval.id, "approve")).toBe("approved");
    await expect(decideApproval(A.db, orgA, approval.id, "reject")).rejects.toMatchObject({ code: "conflict" });
    await store.resumeRun(runId, missionId);
    await store.failRun(runId, missionId, { code: "internal", counters: { toolCalls: 0, modelCalls: 0, externalRequests: 0, costUsd: 0 }, durationMs: 5 });
    expect((await M.db.from("agent_runs").update({ status: "running" }).eq("id", runId)).error).not.toBeNull();
    expect((await M.db.from("agent_runs").update({ result: { kind: "forged" } }).eq("id", runId)).error?.code).toBe("42501");
    const [row] = await sql`select status, approval_state, error_code from public.agent_runs where id = ${runId}`;
    expect(row).toEqual({ status: "failed", approval_state: "approved", error_code: "internal" });
  });

  test("rejection cancels; expiry fails; only the starter or an admin can cancel a waiting run", async () => {
    const store = dbRunStore(M.db, orgA);
    const r1 = await createMission(M.db, orgA, mission());
    await store.startRun(r1.runId, r1.missionId);
    const a1 = await store.requestApproval(r1.runId, "deep_company_research", {});
    expect(await decideApproval(A.db, orgA, a1, "reject")).toBe("rejected");
    expect((await sql`select status, error_code from public.agent_runs where id = ${r1.runId}`)[0]).toEqual({ status: "cancelled", error_code: "approval_rejected" });

    const r2 = await createMission(M.db, orgA, mission());
    await store.startRun(r2.runId, r2.missionId);
    const a2 = await store.requestApproval(r2.runId, "deep_company_research", {});
    await sql`update public.agent_approvals set expires_at = now() - interval '1 minute', requested_at = now() - interval '2 minutes' where id = ${a2}`;
    expect(await decideApproval(A.db, orgA, a2, "approve")).toBe("expired");
    expect((await sql`select status, error_code, approval_state from public.agent_runs where id = ${r2.runId}`)[0]).toEqual({ status: "failed", error_code: "approval_expired", approval_state: "expired" });

    const r3 = await createMission(M.db, orgA, mission());
    await store.startRun(r3.runId, r3.missionId);
    await store.requestApproval(r3.runId, "deep_company_research", {});
    await addMember(orgA, B.id, "member");
    await expect(cancelRun(B.db, orgA, r3.runId)).rejects.toMatchObject({ code: "forbidden" });
    await sql`delete from public.organization_memberships where organization_id = ${orgA} and user_id = ${B.id}`;
    await cancelRun(M.db, orgA, r3.runId);
    expect((await sql`select r.status, a.state from public.agent_runs r join public.agent_approvals a on a.run_id = r.id where r.id = ${r3.runId}`)[0]).toEqual({ status: "cancelled", state: "rejected" });
  });
});

describe("orchestrator end to end over stored research (no network)", () => {
  test("Research Agent reuses fresh stored research, persists steps, tool calls, result and audit events", async () => {
    await createCompany(A.db, orgA, { name: "Own A", isOwnCompany: true });
    await updateOwnCompanyProfile(A.db, orgA, { name: "Own A", website: null, summary: "We integrate and test rugged servers", offerings: ["System integration", "Testing and validation", "Rugged servers"], customerSegments: ["Defense"], markets: ["Defense"], geographies: ["France", "Germany"], soughtCapabilities: ["GPU fabric"], partnershipGoals: ["oem", "integration", "supplier"] });
    const now = new Date();
    const src = (key: string, url: string, pageType: "home" | "about") => ({ key, url, title: url, authority: "official" as const, pageType, retrievedAt: now.toISOString() });
    const profile = extractTargetProfile({ nameHint: null, domain: DOMAIN, website: `https://${DOMAIN}`, resolution: { method: "url", confidence: "strong" }, pages: [{ doc: parseHtml(FIXTURE_HOME, `https://${DOMAIN}/`), source: src("s0", `https://${DOMAIN}/`, "home") }, { doc: parseHtml(FIXTURE_ABOUT, `https://${DOMAIN}/about`), source: src("s1", `https://${DOMAIN}/about`, "about") }], now });
    const rr = await startResearchRun(A.db, orgA, "basic", DOMAIN, DOMAIN);
    await saveIntelligence(A.db, orgA, rr, "basic", profile, []);
    await finishRun(A.db, orgA, rr, { ok: true, domain: DOMAIN, counters: {} });
    const researchRunsBefore = (await sql`select count(*)::int as n from public.research_runs where organization_id = ${orgA}`)[0].n;

    const created = await createMission(A.db, orgA, mission());
    const out = await executeRun(
      { store: dbRunStore(A.db, orgA), tools: TOOL_IMPLEMENTATIONS, env: { db: A.db, organizationId: orgA, userId: A.id, locale: "fr", research: null } },
      { runId: created.runId, missionId: created.missionId, agent: AGENT_REGISTRY.research, capability: "company_research", autonomy: 1, missionType: "analyze_company", input: { target: { query: DOMAIN }, depth: "basic", refresh: false }, approvedTools: [], resumed: false },
    );
    expect(out.status).toBe("completed");
    expect((await sql`select count(*)::int as n from public.research_runs where organization_id = ${orgA}`)[0].n).toBe(researchRunsBefore);

    const d = await getRunDetail(A.db, orgA, created.runId);
    expect(d?.run.status).toBe("completed");
    expect(d?.run.duration_ms).toBeGreaterThanOrEqual(0);
    expect(d?.steps.map((s) => [s.step_key, s.status])).toEqual([
      ["load_workspace_context", "completed"],
      ["resolve_target", "completed"],
      ["retrieve_existing_research", "completed"],
      ["run_research", "skipped"],
      ["evaluate_relevance", "completed"],
      ["produce_result", "completed"],
    ]);
    expect(d?.toolCalls.map((c) => c.tool_id)).toEqual(["read_workspace_company", "read_stored_research", "evaluate_business_relevance"]);
    const result = CompanyAnalysisResult.parse(d?.run.result);
    expect(result).toMatchObject({ reusedResearch: true, target: { domain: DOMAIN } });
    expect(result.nextAction?.kind).toBe("validate");
    expect((await listRuns(V.db, orgA, { limit: 5 }))[0].id).toBe(created.runId);

    const audit = (await sql`select action, actor_type from public.audit_events where organization_id = ${orgA} and (target_id = ${created.runId} or target_id = ${created.missionId} or (metadata ->> 'run_id') = ${created.runId}) order by id`).map((r: { action: string }) => r.action);
    expect(audit).toEqual(expect.arrayContaining(["agent_mission.created", "agent_run.queued", "agent_run.started", "agent_tool.called", "agent_run.completed"]));
    const approvalAudit = (await sql`select action from public.audit_events where organization_id = ${orgA} and action like 'agent_approval.%'`).map((r: { action: string }) => r.action);
    expect(approvalAudit).toEqual(expect.arrayContaining(["agent_approval.requested", "agent_approval.approved", "agent_approval.rejected", "agent_approval.expired"]));
    // Audit metadata holds ids and codes only.
    const [meta] = await sql`select metadata from public.audit_events where organization_id = ${orgA} and action = 'agent_run.completed' and target_id = ${created.runId}`;
    expect(Object.keys(meta.metadata).sort()).toEqual(["agent_id", "error_code", "mission_id", "status"]);
  });
});

describe("tenant isolation", () => {
  test("org B cannot read, update or delete org A's agent rows; anon reads nothing", async () => {
    for (const t of TABLES) {
      const [{ n }] = await sql.unsafe(`select count(*)::int as n from public.${t} where organization_id = $1`, [orgA]);
      expect(n).toBeGreaterThan(0);
      expect((await B.db.from(t).select("id").eq("organization_id", orgA)).data).toEqual([]);
      expect((await anonClient().from(t).select("id")).data ?? []).toEqual([]);
      const del = await B.db.from(t).delete().eq("organization_id", orgA).select("id");
      expect(del.data ?? []).toEqual([]);
    }
    const upd = await B.db.from("agent_runs").update({ error_code: "hacked" }).eq("organization_id", orgA).select("id");
    expect(upd.data ?? []).toEqual([]);
  });

  test("B cannot attach steps, tool calls or usage to A's runs (RLS + same-organization foreign keys)", async () => {
    const [run] = await sql`select id from public.agent_runs where organization_id = ${orgA} limit 1`;
    expect((await B.db.from("agent_run_steps").insert({ organization_id: orgA, run_id: run.id, seq: 50, step_key: "x" })).error).not.toBeNull();
    const cross = await B.db.from("agent_run_tool_calls").insert({ organization_id: orgB, run_id: run.id, tool_id: "read_stored_research", outcome: "succeeded", cost_class: "internal", external_network: false });
    expect(cross.error?.code).toBe("23503");
    const usage = await B.db.from("usage_events").insert({ organization_id: orgB, agent_run_id: run.id, provider: "x", service: "x", operation: "extraction", succeeded: true });
    expect(usage.error?.code).toBe("23503");
  });

  test("tool-call ledger is append-only; viewers read runs but cannot write", async () => {
    const [call] = await sql`select id from public.agent_run_tool_calls where organization_id = ${orgA} limit 1`;
    expect((await A.db.from("agent_run_tool_calls").update({ outcome: "succeeded" }).eq("id", call.id)).error).not.toBeNull();
    const del = await A.db.from("agent_run_tool_calls").delete().eq("id", call.id).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    expect((await V.db.from("agent_runs").select("id").eq("organization_id", orgA)).data?.length).toBeGreaterThan(0);
    const vUpd = await V.db.from("agent_runs").update({ error_code: "x" }).eq("organization_id", orgA).select("id");
    expect(vUpd.data ?? []).toEqual([]);
  });

  test("no anon or service_role grants on agent tables", async () => {
    const rows = await sql`select table_name, grantee from information_schema.role_table_grants where table_schema = 'public' and table_name like 'agent_%' and grantee in ('anon', 'service_role')`;
    expect(rows).toEqual([]);
  });
});
