/**
 * Phase 17B mission executor: golden missions end to end (contracts → executor → child runs through the
 * REAL orchestrator → findings/state) and the failure paths — crash and lease expiry, adoption of completed
 * work, bounded retries, lease fencing, busy, cancellation (also mid child run), concurrent executors,
 * tampered steps. In-memory store mirroring the database functions; no database, network or provider.
 */
import { describe, expect, test } from "bun:test";
import { planMission } from "@/lib/missions/contracts";
import { GOLDEN_MISSIONS, GOLDEN_WORLD, stepLine } from "@/lib/missions/golden";
import { MISSION_LIMITS } from "@/lib/missions/types";
import { executeMissionSlice, type ChildRunner, type ExecutorDeps, type SliceResult } from "./executor";
import { FixtureChildRunner, fixtureWorld, MemoryMissionStore } from "./testing";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEASE_MS = MISSION_LIMITS.leaseSeconds * 1000;

function setup(template: string, input: unknown) {
  const plan = planMission(template, input);
  if (!plan) throw new Error("bad plan");
  const store = new MemoryMissionStore(crypto.randomUUID(), plan.contract);
  const world = fixtureWorld(GOLDEN_WORLD.own, GOLDEN_WORLD.stored);
  const children = new FixtureChildRunner(store, world, USER);
  const tripwires: string[] = [];
  const deps: ExecutorDeps = { store, children, contract: plan.contract, onTripwire: async (t, d) => void tripwires.push(`${t}:${d}`) };
  return { plan, store, world, children, deps, tripwires };
}

/** Calls execute until the mission is terminal (like a client polling …/execute). */
async function drive(deps: ExecutorDeps, missionId: string, max = 20): Promise<SliceResult[]> {
  const out: SliceResult[] = [];
  for (let i = 0; i < max; i++) {
    const r = await executeMissionSlice(deps, missionId);
    out.push(r);
    if (["completed", "failed", "cancelled"].includes(r.state)) return out;
  }
  throw new Error("mission did not finish");
}

/** One slice whose process dies mid-step: nothing more reaches the store (the lease stays held until it expires). */
async function crashSlice(deps: ExecutorDeps, missionId: string) {
  const store = deps.store as MemoryMissionStore;
  expect((await executeMissionSlice(deps, missionId)).state).toBe("error");
  expect(store.crashed).toBe(true);
  expect(store.stepRows.some((s) => s.status === "leased")).toBe(true);
}
const restart = (store: MemoryMissionStore, afterMs = LEASE_MS + 1) => {
  store.crashed = false;
  store.now += afterMs;
};

describe("golden missions (in memory, real orchestrator)", () => {
  for (const g of GOLDEN_MISSIONS)
    test(g.name, async () => {
      const { store, deps, world, children } = setup(g.template, g.input);
      const slices = await drive(deps, store.missionId);
      expect(store.status).toBe(g.expect.status);
      expect(store.failureReason).toBe(g.expect.failureReason);
      expect(store.view().map(stepLine)).toEqual(g.expect.steps);
      const keys = store.rows.map((f) => f.key);
      for (const k of g.expect.findings) expect(keys).toContain(k);
      for (const d of g.expect.notProspects) expect(keys).not.toContain(`prospect:${d}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(store.runs.size).toBe(g.expect.childRuns);
      expect(children.started).toHaveLength(g.expect.childRuns);
      // At most one child run per slice; a slice yields when the next child run needs a new request.
      for (const s of slices) expect(s.executed.filter((e) => e.kind === "child_run").length).toBeLessThanOrEqual(1);
      // Free only: never deep research or web search.
      expect(world.calls).not.toContain("deep_company_research");
      expect(world.calls).not.toContain("search_web_candidates");
      // Attribution: child findings point at their step's run; the summary at none.
      for (const f of store.rows) {
        const step = store.step(f.stepKey);
        if (step.kind === "child_run") expect(f.agentRunId).toBe(step.childRunId as string);
        else expect(f.agentRunId).toBeNull();
      }
      if (g.expect.status === "completed") expect(store.rows.find((f) => f.kind === "mission_summary")?.payload).toMatchObject({ steps: { failed: 0 } });
      // A finished mission is inert: executing again does nothing.
      const again = await executeMissionSlice(deps, store.missionId);
      expect(again).toEqual({ state: g.expect.status, executed: [], recovered: 0 });
      expect(store.runs.size).toBe(g.expect.childRuns);
    });

  test("fan-out researches the best prospects, in rank order, after prospecting", async () => {
    const { store, deps } = setup("prospect_and_research", { intent: "customers", researchTop: 2 });
    await drive(deps, store.missionId);
    const prospects = store.rows.filter((f) => f.kind === "prospect" && f.payload.priority !== "weak").map((f) => f.subjectDomain);
    const researched = store.view().filter((s) => s.key.startsWith("research_top_")).map((s) => (store.step(s.key).spec as { input: { target: { query: string } } }).input.target.query);
    expect(researched.length).toBeGreaterThan(0);
    for (const d of researched) expect(prospects).toContain(d);
    expect(store.step("research_top").result).toMatchObject({ planned: researched.length });
  });
});

describe("recovery", () => {
  test("crash mid child run: live lease → in_progress; expired lease → previous run interrupted, new run, mission completes", async () => {
    const { store, deps, children } = setup("research_company", { target: { query: "strong.example" } });
    children.inject.research = (attempt) => (attempt === 1 ? "crash" : null);
    await crashSlice(deps, store.missionId);
    const first = store.step("research").childRunId as string;
    expect(store.runs.get(first)?.status).toBe("running");
    store.crashed = false;
    expect((await executeMissionSlice(deps, store.missionId)).state).toBe("in_progress");
    restart(store);
    const slices = await drive(deps, store.missionId);
    expect(slices[0].recovered).toBe(1);
    expect(store.status).toBe("completed");
    expect(store.runs.get(first)).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect(store.runs.size).toBe(2);
    expect(store.step("research")).toMatchObject({ status: "completed", attempt: 2, recoveries: 1 });
    expect(store.rows.filter((f) => f.key === "analysis:strong.example")).toHaveLength(1);
  });

  test("crash after the child run completed: the result is adopted, the work is never run twice", async () => {
    const { store, deps, children } = setup("research_company", { target: { query: "strong.example" } });
    const real = children.run.bind(children);
    let crashes = 1;
    const crashing: ChildRunner = {
      async run(...a) {
        const out = await real(...a);
        if (crashes-- > 0) store.crashed = true; // dies before reporting the outcome
        return out;
      },
    };
    const d = { ...deps, children: crashing };
    await crashSlice(d, store.missionId);
    expect(store.runs.size).toBe(1);
    restart(store);
    await drive(d, store.missionId);
    expect(store.status).toBe("completed");
    expect(store.runs.size).toBe(1);
    expect(children.started).toEqual(["research#1"]);
    expect(store.step("research").result).toMatchObject({ adopted: true });
  });

  test("a queued run left by a crash is resumed, not duplicated", async () => {
    const { store, deps, children } = setup("research_company", { target: { query: "strong.example" } });
    children.inject.research = (attempt) => (attempt === 1 ? "throw" : null);
    const r = await executeMissionSlice(deps, store.missionId);
    expect(r.state).toBe("error");
    // The step was given back with its attempt consumed; its queued run is resumed by the next attempt.
    expect(store.step("research")).toMatchObject({ status: "pending", attempt: 1 });
    await drive(deps, store.missionId);
    expect(store.status).toBe("completed");
    expect(store.runs.size).toBe(1);
    expect(store.step("research").attempt).toBe(2);
  });

  test("attempts are bounded: two crashes fail a required step and the mission", async () => {
    const { store, deps, children } = setup("research_company", { target: { query: "strong.example" } });
    children.inject.research = () => "crash";
    await crashSlice(deps, store.missionId);
    restart(store);
    await crashSlice(deps, store.missionId);
    restart(store);
    const r = await executeMissionSlice(deps, store.missionId);
    expect(r.state).toBe("failed");
    expect(store.view().map(stepLine)).toEqual(["research:failed:attempts_exhausted", "compile:skipped"]);
    expect(store.failureReason).toBe("step_failed");
  });

  test("a transient child failure is retried once with a new run; a deterministic one is not", async () => {
    const t = setup("research_company", { target: { query: "strong.example" } });
    t.children.inject.research = (attempt) => (attempt === 1 ? { status: "failed", runId: null, code: "internal", retry: true } : null);
    const slices = await drive(t.deps, t.store.missionId);
    expect(slices[0].executed[0]).toMatchObject({ key: "research", outcome: "retry", error: "internal" });
    expect(t.store.status).toBe("completed");
    expect(t.store.runs.size).toBe(2);

    const u = setup("research_company", { target: { query: "strong.example" } });
    u.children.inject.research = () => ({ status: "failed", runId: null, code: "target_not_found", retry: false });
    await drive(u.deps, u.store.missionId);
    expect(u.store.view().map(stepLine)).toEqual(["research:failed:target_not_found", "compile:skipped"]);
    expect(u.store.runs.size).toBe(1);
  });

  test("an optional fan-out child that fails does not fail the mission; the summary lists it", async () => {
    const { store, deps, children } = setup("prospect_and_research", { intent: "customers", researchTop: 2 });
    children.inject.research_top_1 = () => ({ status: "failed", runId: null, code: "research_refused", retry: false });
    await drive(deps, store.missionId);
    expect(store.status).toBe("completed");
    expect(store.step("research_top_1")).toMatchObject({ status: "failed", errorCode: "research_refused" });
    expect(store.rows.find((f) => f.kind === "mission_summary")?.payload).toMatchObject({ failedSteps: [{ key: "research_top_1", error: "research_refused" }] });
  });

  test("busy (another agent run in progress): the step is given back without consuming an attempt", async () => {
    const { store, deps, children } = setup("research_company", { target: { query: "strong.example" } });
    let busy = 2;
    children.inject.research = () => (busy-- > 0 ? { status: "busy" } : null);
    expect((await executeMissionSlice(deps, store.missionId)).state).toBe("busy");
    expect((await executeMissionSlice(deps, store.missionId)).state).toBe("busy");
    expect(store.step("research")).toMatchObject({ status: "pending", attempt: 0 });
    await drive(deps, store.missionId);
    expect(store.step("research")).toMatchObject({ status: "completed", attempt: 1 });
  });
});

describe("leases, cancellation and integrity", () => {
  test("fencing: an executor that lost its lease cannot complete the step or record findings", async () => {
    const { store, plan } = setup("research_company", { target: { query: "strong.example" } });
    const a = await store.claim(store.missionId, "owner-a", MISSION_LIMITS.leaseSeconds);
    if (a.state !== "claimed") throw new Error("claim");
    store.now += LEASE_MS + 1;
    const b = await store.claim(store.missionId, "owner-b", MISSION_LIMITS.leaseSeconds);
    expect(b).toMatchObject({ state: "claimed", recovered: 1, step: { key: "research", attempt: 2, recoveries: 1 } });
    const late = await store.complete(a.step.id, { owner: "owner-a", attempt: a.step.attempt }, { outcome: "completed", errorCode: null, retry: false, result: null, findings: [{ key: "analysis:forged.example", kind: "company_analysis", subjectDomain: "forged.example", payload: {} }], newSteps: [] });
    expect(late).toEqual({ state: "rejected", reason: "lease_lost" });
    expect(await store.release(a.step.id, { owner: "owner-a", attempt: a.step.attempt }, true)).toBe(false);
    expect(store.rows).toEqual([]);
    expect(plan.contract.steps).toHaveLength(2);
  });

  test("two executors at once: the second sees in_progress and does nothing", async () => {
    const { store, deps, children } = setup("research_company", { target: { query: "strong.example" } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = children.run.bind(children);
    const slow: ChildRunner = { run: async (...a) => (await gate, real(...a)) };
    const first = executeMissionSlice({ ...deps, children: slow }, store.missionId);
    await Bun.sleep(5);
    expect((await executeMissionSlice(deps, store.missionId)).state).toBe("in_progress");
    release();
    expect((await first).executed[0]).toMatchObject({ key: "research", outcome: "completed" });
    expect(store.runs.size).toBe(1);
  });

  test("cancel between slices: remaining steps cancelled, execution stops", async () => {
    const { store, deps } = setup("prospect_and_research", { intent: "customers", researchTop: 2 });
    expect((await executeMissionSlice(deps, store.missionId)).state).toBe("yielded");
    store.cancel();
    expect(await executeMissionSlice(deps, store.missionId)).toEqual({ state: "cancelled", executed: [], recovered: 0 });
    // The fan-out (internal) ran in the first slice; the slice yielded before the first research child.
    expect(store.view().map(stepLine)).toEqual(["prospect:completed", "research_top:completed", "research_top_1:cancelled", "research_top_2:cancelled", "compile:cancelled"]);
    expect(() => store.cancel()).toThrow();
  });

  test("cancel while a child run executes: its completion is rejected, nothing from it is recorded", async () => {
    const { store, deps, children } = setup("research_company", { target: { query: "strong.example" } });
    const real = children.run.bind(children);
    const cancelling: ChildRunner = {
      async run(...a) {
        const out = await real(...a);
        store.cancel();
        return out;
      },
    };
    const r = await executeMissionSlice({ ...deps, children: cancelling }, store.missionId);
    expect(r.state).toBe("cancelled");
    expect(store.status).toBe("cancelled");
    expect(store.rows).toEqual([]);
    expect(store.view().map(stepLine)).toEqual(["research:cancelled", "compile:cancelled"]);
  });

  test("a tampered step never runs: failed as invalid_step, tripwire recorded, no child run", async () => {
    const { store, deps, tripwires, children } = setup("prospect_known_candidates", { intent: "customers" });
    (store.step("prospect").spec as { input: Record<string, unknown> }).input.source = "web_search";
    const r = await executeMissionSlice(deps, store.missionId);
    expect(r.state).toBe("failed");
    expect(store.view().map(stepLine)).toEqual(["prospect:failed:invalid_step", "compile:skipped"]);
    expect(tripwires).toEqual(["authority_modification:mission_step:prospect"]);
    expect(children.started).toEqual([]);
  });
});
