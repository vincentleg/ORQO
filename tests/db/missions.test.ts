/**
 * Phase 17B mission engine against the isolated ORQO Test database, as signed-in users under RLS:
 * golden missions through the real service (real RPCs, real child agent runs and tools over stored research,
 * no research gateway: nothing is fetched), recovery (queued run resumed, stale running run interrupted,
 * completed run adopted), lease fencing, concurrent claims, busy, cancellation (between slices, queued and
 * running child runs), tampered contracts and steps, authorization, no direct writes, audit, no spend.
 * Synthetic organizations only. No provider is called.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { planMission } from "@/lib/missions/contracts";
import { GOLDEN_MISSIONS, GOLDEN_WORLD, stepLine } from "@/lib/missions/golden";
import { MISSION_LIMITS } from "@/lib/missions/types";
import { cancelRun } from "@/lib/server/agents/repository";
import { createCompany, updateOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { dbChildRunner } from "@/lib/server/missions/children";
import { executeMissionSlice, type ChildRunner } from "@/lib/server/missions/executor";
import { attachChildRun, createMissionRecord, dbMissionStore } from "@/lib/server/missions/repository";
import { cancelMission, createMission, executeMission, getMissionDetail } from "@/lib/server/missions/service";
import { addMember, cleanupTestData, createSyntheticPreviewOrg, createTestUser, sql, type TestUser } from "../support/supabase";

let P: TestUser; // owner of the Internal (agent-entitled) synthetic organization
let M: TestUser; // member
let V: TestUser; // viewer
let B: TestUser; // another organization (Free)
let ORG: string;
let orgB: string;

const create = (template: string, input: unknown, user = P) => createMission(user.db, user.id, ORG, { template: template as never, input, idempotencyKey: crypto.randomUUID() });
const execute = (missionId: string, user = P) => executeMission(user.db, user.id, ORG, missionId, "en", { research: null });
async function runToEnd(missionId: string, user = P) {
  for (let i = 0; i < 15; i++) {
    const r = await execute(missionId, user);
    if (["completed", "failed", "cancelled"].includes(r.state)) return r;
    if (r.state === "error" || r.state === "lease_lost") throw new Error(`slice ${r.state}`);
  }
  throw new Error("mission did not finish");
}
const lines = async (missionId: string) => (await sql`select step_key, status, error_code from public.mission_steps where mission_id = ${missionId} order by seq`).map((r: { step_key: string; status: string; error_code: string | null }) => stepLine({ key: r.step_key, status: r.status, error: r.error_code }));
const childRuns = async (missionId: string) =>
  sql`select r.id, r.status, r.error_code, r.authority, r.depth, r.created_by, s.step_key from public.agent_runs r join public.mission_steps s on s.id = r.mission_step_id where s.mission_id = ${missionId} order by r.created_at`;
const step = async (missionId: string, key: string) => (await sql`select * from public.mission_steps where mission_id = ${missionId} and step_key = ${key}`)[0];
const expire = (stepId: string) => sql`update public.mission_steps set lease_expires_at = now() - interval '1 second' where id = ${stepId}`;
const researchAttach = (stepId: string, lease: { owner: string; attempt: number }, user = P) =>
  attachChildRun(user.db, ORG, stepId, lease, { agentId: "research", missionType: "analyze_company", capability: "company_research", objective: "mission test", input: { target: { query: "strong.example" }, depth: "basic", refresh: false }, autonomy: 1, limits: AGENT_REGISTRY.research.limits as never, maxRuns: 30, windowHours: 24, staleAfterSeconds: 180 });

async function claimFirst(missionId: string, owner = crypto.randomUUID(), user = P) {
  const c = await dbMissionStore(user.db, ORG).claim(missionId, owner, MISSION_LIMITS.leaseSeconds);
  if (c.state !== "claimed") throw new Error(`claim ${c.state}`);
  return { ...c, lease: { owner, attempt: c.step.attempt } };
}

beforeAll(async () => {
  await cleanupTestData();
  [P, M, V, B] = await Promise.all([createTestUser("p17b-p"), createTestUser("p17b-m"), createTestUser("p17b-v"), createTestUser("p17b-b")]);
  ORG = await createSyntheticPreviewOrg(P, "P17B Missions");
  await addMember(ORG, M.id, "member");
  await addMember(ORG, V.id, "viewer");
  orgB = await createOrganization(B.db, { name: "P17B Org B" });
  await createCompany(P.db, ORG, { name: "Own Co", website: GOLDEN_WORLD.ownWebsite, isOwnCompany: true });
  await updateOwnCompanyProfile(P.db, ORG, { ...GOLDEN_WORLD.own, website: GOLDEN_WORLD.ownWebsite });
  for (const p of GOLDEN_WORLD.stored) {
    const rr = await startResearchRun(P.db, ORG, "basic", p.domain, p.domain);
    await saveIntelligence(P.db, ORG, rr, "basic", p, []);
    await finishRun(P.db, ORG, rr, { ok: true, domain: p.domain, counters: {} });
  }
});
afterAll(cleanupTestData);
// Isolation: whatever a test leaves active (a failure midway) is closed, so it cannot block the next test
// through the one-concurrent-run guard or the active-mission cap.
afterEach(async () => {
  await sql`update public.agent_runs set status = 'failed', error_code = 'internal', finished_at = now() where organization_id = ${ORG} and status in ('queued', 'running', 'waiting_for_approval')`;
  await sql`update public.mission_steps set status = 'cancelled', lease_owner = null, lease_expires_at = null where organization_id = ${ORG} and status in ('pending', 'leased')`;
  await sql`update public.missions set status = 'cancelled', failure_reason = 'cancelled' where organization_id = ${ORG} and status in ('planned', 'running')`;
});

describe("golden missions (database, real child runs)", () => {
  for (const g of GOLDEN_MISSIONS)
    test(g.name, async () => {
      const m = await create(g.template, g.input);
      expect(m).toMatchObject({ status: "planned", reused: false });
      const end = await runToEnd(m.missionId);
      expect(end.state).toBe(g.expect.status);
      expect(end.mission).toMatchObject({ status: g.expect.status, failure_reason: g.expect.failureReason });
      expect(await lines(m.missionId)).toEqual(g.expect.steps);

      const detail = await getMissionDetail(V.db, V.id, ORG, m.missionId); // viewers read missions
      const keys = detail.findings.map((f) => f.key);
      for (const k of g.expect.findings) expect(keys).toContain(k);
      for (const d of g.expect.notProspects) expect(keys).not.toContain(`prospect:${d}`);

      // Child runs: ordinary Phase 4 runs, one per child step, each with a FREE frozen authority.
      const runs = await childRuns(m.missionId);
      expect(runs).toHaveLength(g.expect.childRuns);
      for (const r of runs) {
        expect(r.depth).toBe(0);
        expect(r.created_by).toBe(P.id);
        expect(r.authority.limits.maxCostUsd).toBe(0);
        expect(r.authority.providers).toEqual({ openrouter: null, brave: false });
        expect(r.authority.tools).not.toContain("deep_company_research");
        expect(r.authority.tools).not.toContain("search_web_candidates");
      }
      // Attribution: each child finding points at its step's run.
      const stepRuns = new Map(detail.steps.map((s) => [s.step_key, s.child_run_id]));
      for (const f of detail.findings) expect(f.agentRunId).toBe(f.kind === "mission_summary" ? null : (stepRuns.get(f.stepKey) ?? null));
      expect(detail.progress.pending + detail.progress.leased).toBe(0);
    });

  test("no spend, no provider usage, no web research for any mission", async () => {
    expect((await sql`select count(*)::int as n from public.provider_spend where organization_id = ${ORG}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from public.usage_events where organization_id = ${ORG}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from public.research_runs where organization_id = ${ORG} and mode = 'deep'`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from public.agent_run_tool_calls where organization_id = ${ORG} and (cost_class = 'variable' or (external_network and outcome = 'succeeded'))`)[0].n).toBe(0);
  });

  test("lifecycle is audited (created, started, completed)", async () => {
    const rows = await sql`select action from public.audit_events where organization_id = ${ORG} and target_table = 'missions'`;
    const actions = rows.map((r: { action: string }) => r.action);
    for (const a of ["mission.created", "mission.started", "mission.completed", "mission.failed"]) expect(actions).toContain(a);
  });
});

describe("contracts, idempotency and authorization", () => {
  test("the same idempotency key returns the same mission, never a second one", async () => {
    const key = crypto.randomUUID();
    const body = { template: "research_company" as const, input: { target: { query: "strong.example" } }, idempotencyKey: key };
    const a = await createMission(P.db, P.id, ORG, body);
    const b = await createMission(P.db, P.id, ORG, body);
    expect(b).toEqual({ missionId: a.missionId, status: "planned", reused: true });
    expect((await sql`select count(*)::int as n from public.missions where organization_id = ${ORG} and idempotency_key = ${key}`)[0].n).toBe(1);
    await cancelMission(P.db, P.id, ORG, a.missionId);
  });

  test("viewer, Free workspace and other organizations are refused; invalid input never creates anything", async () => {
    await expect(create("research_company", { target: { query: "strong.example" } }, V)).rejects.toMatchObject({ reason: "role" });
    await expect(createMission(B.db, B.id, orgB, { template: "research_company", input: { target: { query: "x.example" } }, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ reason: "plan_required" });
    await expect(createMission(B.db, B.id, ORG, { template: "research_company", input: { target: { query: "x.example" } }, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
    await expect(create("research_company", { target: { query: "x.example" }, depth: "deep" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(create("prospect_known_candidates", { source: "web_search" })).rejects.toMatchObject({ code: "invalid_input" });
    const m = await create("research_company", { target: { query: "strong.example" } });
    await expect(getMissionDetail(B.db, B.id, ORG, m.missionId)).rejects.toMatchObject({ code: "not_found" });
    await expect(getMissionDetail(B.db, B.id, orgB, m.missionId)).rejects.toMatchObject({ code: "not_found" });
    await expect(executeMission(B.db, B.id, orgB, m.missionId, "en", { research: null })).rejects.toMatchObject({ code: "not_found" });
    await expect(executeMission(V.db, V.id, ORG, m.missionId, "en", { research: null })).rejects.toMatchObject({ code: "forbidden" });
    await expect(cancelMission(V.db, V.id, ORG, m.missionId)).rejects.toMatchObject({ code: "forbidden" });
    // A member who did not create it cannot cancel it (creator or admin only).
    await expect(cancelMission(M.db, M.id, ORG, m.missionId)).rejects.toMatchObject({ code: "forbidden" });
    await cancelMission(P.db, P.id, ORG, m.missionId);
  });

  test("no direct writes: missions, steps and findings change only through the engine's functions", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } });
    const s = await step(m.missionId, "research");
    await P.db.from("missions").update({ status: "completed" } as never).eq("id", m.missionId);
    await P.db.from("mission_steps").update({ status: "completed" } as never).eq("id", s.id);
    const ins = await P.db.from("mission_findings").insert({ organization_id: ORG, mission_id: m.missionId, step_id: s.id, finding_key: "forged", kind: "prospect", payload: {} } as never);
    expect(ins.error).not.toBeNull();
    expect((await sql`select status from public.missions where id = ${m.missionId}`)[0].status).toBe("planned");
    expect((await step(m.missionId, "research")).status).toBe("pending");
    // A completion without the lease is rejected and records nothing.
    const forged = await dbMissionStore(P.db, ORG).complete(s.id, { owner: crypto.randomUUID(), attempt: 1 }, { outcome: "completed", errorCode: null, retry: false, result: null, findings: [{ key: "forged", kind: "prospect", subjectDomain: null, payload: {} }], newSteps: [] });
    expect(forged.state).toBe("rejected");
    expect((await sql`select count(*)::int as n from public.mission_findings where mission_id = ${m.missionId}`)[0].n).toBe(0);
    // Even the table owner cannot rewrite a frozen contract or a step definition.
    expect(String(await sql`update public.missions set contract = '{}'::jsonb where id = ${m.missionId}`.then(() => null, (e) => e))).toMatch(/immutable/);
    expect(String(await sql`update public.mission_steps set spec = '{}'::jsonb where id = ${s.id}`.then(() => null, (e) => e))).toMatch(/immutable/);
    await cancelMission(P.db, P.id, ORG, m.missionId);
  });

  test("a tampered contract never executes and is audited as a tripwire", async () => {
    const plan = planMission("research_company", { target: { query: "strong.example" } })!;
    const forged = { ...plan, contract: { ...plan.contract, envelope: { ...plan.contract.envelope, maxCostUsd: 5 } } } as never;
    const m = await createMissionRecord(P.db, ORG, forged, crypto.randomUUID()); // a direct RPC call
    await expect(execute(m.missionId)).rejects.toMatchObject({ code: "forbidden" });
    expect((await sql`select count(*)::int as n from public.audit_events where organization_id = ${ORG} and action = 'governance.tripwire.authority_modification'`)[0].n).toBeGreaterThan(0);
    expect(await childRuns(m.missionId)).toHaveLength(0);
    await cancelMission(P.db, P.id, ORG, m.missionId);
  });

  test("a tampered step (valid contract, forged step row) is refused before any child run", async () => {
    const plan = planMission("prospect_known_candidates", { intent: "customers" })!;
    const steps = structuredClone(plan.contract.steps);
    (steps[0].spec as { input: Record<string, unknown> }).input.source = "web_search";
    const { data, error } = await P.db.rpc("create_mission", { p_organization_id: ORG, p_template: plan.template, p_template_version: plan.templateVersion, p_objective: plan.objective, p_input: plan.input, p_contract: plan.contract, p_steps: steps, p_idempotency_key: crypto.randomUUID(), p_max_missions: 20, p_window_hours: 24, p_max_active: 3 });
    expect(error).toBeNull();
    const id = (data as { mission_id: string }).mission_id;
    const r = await execute(id);
    expect(r.state).toBe("failed");
    expect(await lines(id)).toEqual(["prospect:failed:invalid_step", "compile:skipped"]);
    expect(await childRuns(id)).toHaveLength(0);
  });
});

describe("recovery (lease expiry)", () => {
  test("a queued child run left by a stopped executor is resumed, not duplicated", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } });
    const c = await claimFirst(m.missionId);
    await researchAttach(c.step.id, c.lease);
    // The executor stops here. Before the lease expires, nobody else can take the step.
    expect((await execute(m.missionId)).state).toBe("in_progress");
    await expire(c.step.id);
    const end = await runToEnd(m.missionId);
    expect(end.state).toBe("completed");
    const runs = await childRuns(m.missionId);
    expect(runs.map((r: { status: string }) => r.status)).toEqual(["completed"]);
    expect(await step(m.missionId, "research")).toMatchObject({ status: "completed", attempt: 2, recoveries: 1 });
  });

  test("a stale running child run is closed as interrupted, then a new attempt completes", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } });
    const c = await claimFirst(m.missionId);
    const child = await researchAttach(c.step.id, c.lease);
    await P.db.from("agent_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", child.runId);
    await expire(c.step.id);
    await runToEnd(m.missionId);
    const runs = await childRuns(m.missionId);
    expect(runs.map((r: { status: string; error_code: string | null }) => `${r.status}:${r.error_code}`)).toEqual(["failed:interrupted", "completed:null"]);
    expect(await lines(m.missionId)).toEqual(["research:completed", "compile:completed"]);
  });

  test("a child run that completed before its executor stopped is adopted, never run twice", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } });
    const plan = planMission("research_company", { target: { query: "strong.example" } })!;
    const real = dbChildRunner({ db: P.db, organizationId: ORG, userId: P.id, locale: "en", research: null });
    const dying: ChildRunner = {
      async run(...a) {
        await real.run(...a);
        throw new Error("process stopped before reporting");
      },
    };
    const r = await executeMissionSlice({ store: dbMissionStore(P.db, ORG), children: dying, contract: plan.contract }, m.missionId);
    expect(r.state).toBe("error");
    expect((await childRuns(m.missionId)).map((x: { status: string }) => x.status)).toEqual(["completed"]);
    await runToEnd(m.missionId);
    expect((await childRuns(m.missionId)).map((x: { status: string }) => x.status)).toEqual(["completed"]);
    expect((await step(m.missionId, "research")).result).toMatchObject({ adopted: true });
    expect((await sql`select count(*)::int as n from public.mission_findings where mission_id = ${m.missionId} and finding_key = 'analysis:strong.example'`)[0].n).toBe(1);
  });

  test("fencing: a stale holder's completion is rejected after another executor reclaimed the step", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } });
    const a = await claimFirst(m.missionId);
    await expire(a.step.id);
    const b = await claimFirst(m.missionId);
    expect(b).toMatchObject({ recovered: 1, step: { id: a.step.id, attempt: 2 } });
    const late = await dbMissionStore(P.db, ORG).complete(a.step.id, a.lease, { outcome: "completed", errorCode: null, retry: false, result: null, findings: [{ key: "analysis:late.example", kind: "company_analysis", subjectDomain: "late.example", payload: {} }], newSteps: [] });
    expect(late).toEqual({ state: "rejected", reason: "lease_lost" });
    await expect(researchAttach(a.step.id, a.lease)).rejects.toThrow(); // the stale holder cannot start a run either
    expect((await sql`select count(*)::int as n from public.mission_findings where mission_id = ${m.missionId}`)[0].n).toBe(0);
    await cancelMission(P.db, P.id, ORG, m.missionId);
  });

  test("concurrent executors: exactly one claims the step", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } });
    const store = dbMissionStore(P.db, ORG);
    const results = await Promise.all([1, 2, 3].map(() => store.claim(m.missionId, crypto.randomUUID(), MISSION_LIMITS.leaseSeconds)));
    expect(results.map((r) => r.state).sort()).toEqual(["claimed", "in_progress", "in_progress"]);
    await cancelMission(P.db, P.id, ORG, m.missionId);
  });

  test("busy: another agent run in progress gives the step back without consuming an attempt", async () => {
    const { data } = await P.db.rpc("create_agent_mission", { p_organization_id: ORG, p_agent_id: "research", p_mission_type: "analyze_company", p_capability: "company_research", p_objective: "blocking run", p_input: { target: { query: "x.example" } }, p_autonomy: 1, p_limits: {}, p_idempotency_key: crypto.randomUUID(), p_max_runs: 30, p_window_hours: 24, p_stale_after_seconds: 180 });
    const blocking = (data as { run_id: string }).run_id;
    const m = await create("research_company", { target: { query: "strong.example" } });
    expect((await execute(m.missionId)).state).toBe("busy");
    expect(await step(m.missionId, "research")).toMatchObject({ status: "pending", attempt: 0 });
    await cancelRun(P.db, ORG, blocking);
    expect((await runToEnd(m.missionId)).state).toBe("completed");
  });
});

describe("cancellation", () => {
  test("between slices: remaining steps are cancelled and execution stops; a second cancel conflicts", async () => {
    const m = await create("prospect_and_research", { intent: "customers", researchTop: 2 });
    expect((await execute(m.missionId)).state).toBe("yielded");
    const r = await cancelMission(P.db, P.id, ORG, m.missionId);
    expect(r).toEqual({ cancelledSteps: 3, cancelledRuns: 0, runningRuns: 0 });
    expect((await execute(m.missionId)).state).toBe("cancelled");
    expect(await lines(m.missionId)).toEqual(["prospect:completed", "research_top:completed", "research_top_1:cancelled", "research_top_2:cancelled", "compile:cancelled"]);
    await expect(cancelMission(P.db, P.id, ORG, m.missionId)).rejects.toMatchObject({ code: "conflict" });
    expect((await sql`select cancelled_by from public.missions where id = ${m.missionId}`)[0].cancelled_by).toBe(P.id);
  });

  test("a queued child run is cancelled with its mission", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } });
    const c = await claimFirst(m.missionId);
    const child = await researchAttach(c.step.id, c.lease);
    expect(await cancelMission(P.db, P.id, ORG, m.missionId)).toEqual({ cancelledSteps: 2, cancelledRuns: 1, runningRuns: 0 });
    expect((await sql`select status, error_code from public.agent_runs where id = ${child.runId}`)[0]).toEqual({ status: "cancelled", error_code: "cancelled" });
    expect((await sql`select status from public.agent_missions where id = ${child.missionId}`)[0].status).toBe("cancelled");
  });

  test("a running child run finishes, but its completion is rejected and nothing from it is recorded", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } });
    const c = await claimFirst(m.missionId);
    const child = await researchAttach(c.step.id, c.lease);
    await P.db.from("agent_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", child.runId);
    expect(await cancelMission(P.db, P.id, ORG, m.missionId)).toEqual({ cancelledSteps: 2, cancelledRuns: 0, runningRuns: 1 });
    const late = await dbMissionStore(P.db, ORG).complete(c.step.id, c.lease, { outcome: "completed", errorCode: null, retry: false, result: null, findings: [{ key: "analysis:strong.example", kind: "company_analysis", subjectDomain: "strong.example", payload: {} }], newSteps: [] });
    expect(late).toEqual({ state: "rejected", reason: "mission_cancelled" });
    expect((await sql`select count(*)::int as n from public.mission_findings where mission_id = ${m.missionId}`)[0].n).toBe(0);
    await P.db.from("agent_runs").update({ status: "failed", error_code: "cancelled", finished_at: new Date().toISOString() }).eq("id", child.runId);
  });

  test("an admin may cancel another member's mission", async () => {
    const m = await create("research_company", { target: { query: "strong.example" } }, M);
    expect((await cancelMission(P.db, P.id, ORG, m.missionId)).cancelledSteps).toBe(2);
  });
});
