/**
 * Test doubles for the mission executor (unit tests only; never imported by application code).
 *
 * MemoryMissionStore mirrors the Phase 17B database functions (claim_mission_step with lease recovery,
 * complete_mission_step with fencing, release_mission_step, cancel_mission) and enforces the same state
 * machines (src/lib/missions/state.ts). FixtureChildRunner executes child runs through the REAL Phase 4
 * orchestrator with an in-memory run store and fake data tools over the golden world: no database, no
 * network, no provider.
 */
import { AgentResultSchema, parseMissionInput, type AgentResult, type MissionInput } from "@/lib/agents/contracts";
import { AGENT_REGISTRY, MISSION_ROUTES } from "@/lib/agents/registry";
import { assertTransition } from "@/lib/agents/state";
import type { RunStatus, ToolId } from "@/lib/agents/types";
import type { KnowledgeIndex } from "@/lib/discovery/candidates";
import type { OwnCompanyContext, TargetProfile } from "@/lib/intelligence/types";
import type { MissionContract, ChildRunSpec } from "@/lib/missions/contracts";
import type { StoredFinding } from "@/lib/missions/findings";
import { childAction, isRetryable, type PreviousRun } from "@/lib/missions/recovery";
import { canMissionTransition, canStepTransition } from "@/lib/missions/state";
import type { MissionStatus, MissionStepStatus, StepKind } from "@/lib/missions/types";
import { knownCandidates } from "@/lib/server/discovery/knowledge";
import { executeRun } from "@/lib/server/agents/orchestrator";
import type { RunStore } from "@/lib/server/agents/repository";
import { TOOL_IMPLEMENTATIONS, ToolError, type StoredResearch, type ToolImpl } from "@/lib/server/agents/tools";
import type { ChildOutcome, ChildRunner, ClaimResult, ClaimedStep, CompleteResult, Completion, Lease, MissionStore } from "./executor";

interface MemStep {
  id: string;
  seq: number;
  key: string;
  kind: StepKind;
  required: boolean;
  spec: unknown;
  status: MissionStepStatus;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  recoveries: number;
  childRunId: string | null;
  errorCode: string | null;
  result: Record<string, unknown> | null;
}

export interface MemRun {
  id: string;
  stepId: string;
  status: RunStatus;
  createdBy: string;
  errorCode: string | null;
  result: AgentResult | null;
}

export class MemoryMissionStore implements MissionStore {
  status: MissionStatus = "planned";
  failureReason: string | null = null;
  stepRows: MemStep[];
  /** Set by an injected crash: the dead executor's writes never arrive. */
  crashed = false;
  rows: StoredFinding[] = [];
  runs = new Map<string, MemRun>();
  /** Milliseconds; tests move it to expire leases. */
  now = 1_000_000;

  constructor(
    readonly missionId: string,
    contract: MissionContract,
  ) {
    this.stepRows = contract.steps.map((s) => ({ id: crypto.randomUUID(), seq: s.seq, key: s.key, kind: s.kind, required: s.required, spec: structuredClone(s.spec), status: "pending", attempt: 0, maxAttempts: s.maxAttempts, leaseOwner: null, leaseExpiresAt: null, recoveries: 0, childRunId: null, errorCode: null, result: null }));
  }

  private setMission(s: MissionStatus, reason: string | null = null) {
    if (!canMissionTransition(this.status, s)) throw new Error(`invalid mission transition ${this.status} -> ${s}`);
    this.status = s;
    this.failureReason = reason ?? this.failureReason;
  }
  private setStep(st: MemStep, s: MissionStepStatus) {
    if (!canStepTransition(st.status, s)) throw new Error(`invalid step transition ${st.status} -> ${s}`);
    st.status = s;
    if (s !== "leased") {
      st.leaseOwner = null;
      st.leaseExpiresAt = null;
    }
  }
  private ordered() {
    return [...this.stepRows].sort((a, b) => a.seq - b.seq);
  }
  private fail(reason: string) {
    for (const s of this.stepRows) if (s.status === "pending") this.setStep(s, "skipped");
    this.setMission("failed", reason);
  }
  private settle(): MissionStatus {
    if (this.status === "running" && !this.stepRows.some((s) => s.status === "pending" || s.status === "leased")) this.setMission("completed");
    return this.status;
  }
  step(key: string) {
    const s = this.stepRows.find((x) => x.key === key);
    if (!s) throw new Error(`no step ${key}`);
    return s;
  }

  async claim(_missionId: string, owner: string, leaseSeconds: number): Promise<ClaimResult> {
    if (this.status === "completed" || this.status === "failed" || this.status === "cancelled") return { state: this.status, recovered: 0 };
    if (this.status === "planned") this.setMission("running");
    let recovered = 0;
    for (const s of this.stepRows)
      if (s.status === "leased" && (s.leaseExpiresAt ?? 0) <= this.now) {
        this.setStep(s, "pending");
        s.recoveries += 1;
        recovered += 1;
      }
    const live = this.stepRows.find((s) => s.status === "leased");
    if (live) return { state: "in_progress", leaseExpiresAt: new Date(live.leaseExpiresAt ?? 0).toISOString() };
    for (;;) {
      const s = this.ordered().find((x) => x.status === "pending");
      if (!s) {
        const st = this.settle();
        return { state: st as "completed", recovered };
      }
      const prev = s.childRunId ? this.runs.get(s.childRunId) : undefined;
      if (s.attempt >= s.maxAttempts && prev?.status !== "completed") {
        this.setStep(s, "failed");
        s.errorCode ??= "attempts_exhausted";
        if (s.required) {
          this.fail("step_failed");
          return { state: "failed", recovered };
        }
        continue;
      }
      this.setStep(s, "leased");
      s.attempt = Math.min(s.attempt + 1, s.maxAttempts);
      s.leaseOwner = owner;
      s.leaseExpiresAt = this.now + leaseSeconds * 1000;
      const step: ClaimedStep = { id: s.id, seq: s.seq, key: s.key, kind: s.kind, required: s.required, spec: structuredClone(s.spec), attempt: s.attempt, maxAttempts: s.maxAttempts, recoveries: s.recoveries };
      const previousRun: PreviousRun | null = prev ? { id: prev.id, status: prev.status, createdBy: prev.createdBy, hasAuthority: true, errorCode: prev.errorCode } : null;
      return { state: "claimed", step, previousRun, recovered };
    }
  }

  async complete(stepId: string, lease: Lease, c: Completion): Promise<CompleteResult> {
    if (this.crashed) throw new CrashSignal();
    const s = this.stepRows.find((x) => x.id === stepId);
    if (!s) throw new Error("step not found");
    if (this.status !== "running") return { state: "rejected", reason: `mission_${this.status}` };
    if (s.status !== "leased" || s.leaseOwner !== lease.owner || s.attempt !== lease.attempt) return { state: "rejected", reason: "lease_lost" };
    let next: MissionStepStatus;
    if (c.outcome === "completed") {
      for (const f of c.findings) {
        if (this.rows.some((r) => r.key === f.key)) continue;
        this.rows.push({ ...structuredClone(f), id: crypto.randomUUID(), stepId: s.id, stepKey: s.key, agentRunId: s.childRunId, createdAt: new Date(this.now).toISOString() });
      }
      if (c.newSteps.length) {
        if (s.kind !== "fanout") throw new Error("only a fan-out step adds steps");
        for (const n of c.newSteps) {
          if (n.kind !== "child_run" || n.seq <= s.seq || n.seq > s.seq + 9 || this.stepRows.some((x) => x.seq === n.seq || x.key === n.key)) throw new Error("invalid step");
          this.stepRows.push({ id: crypto.randomUUID(), seq: n.seq, key: n.key, kind: n.kind, required: n.required, spec: structuredClone(n.spec), status: "pending", attempt: 0, maxAttempts: n.maxAttempts, leaseOwner: null, leaseExpiresAt: null, recoveries: 0, childRunId: null, errorCode: null, result: null });
        }
        if (this.stepRows.length > 24) throw new Error("too many steps");
      }
      next = "completed";
    } else if (c.outcome === "skipped") next = "skipped";
    else next = c.retry && s.attempt < s.maxAttempts ? "pending" : "failed";
    this.setStep(s, next);
    s.errorCode = c.errorCode;
    s.result = c.result ?? s.result;
    if (next === "pending") s.childRunId = null;
    if (next === "failed" && s.required) {
      this.fail("step_failed");
      return { state: "step_failed", mission: "failed" };
    }
    return { state: `step_${next}`, mission: this.settle() };
  }

  async release(stepId: string, lease: Lease, consume: boolean) {
    if (this.crashed) return false;
    const s = this.stepRows.find((x) => x.id === stepId);
    if (!s || s.status !== "leased" || s.leaseOwner !== lease.owner || s.attempt !== lease.attempt) return false;
    this.setStep(s, "pending");
    if (!consume) s.attempt = Math.max(0, s.attempt - 1);
    return true;
  }

  /** cancel_mission */
  cancel() {
    if (this.status !== "planned" && this.status !== "running") throw new Error("mission cannot be cancelled");
    for (const r of this.runs.values()) if (r.status === "queued" || r.status === "waiting_for_approval") Object.assign(r, { status: "cancelled", errorCode: "cancelled" });
    for (const s of this.stepRows) if (s.status === "pending" || s.status === "leased") this.setStep(s, "cancelled");
    this.setMission("cancelled", "cancelled");
  }

  /** attach_mission_child_run (lease holder only). */
  attach(stepId: string, lease: Lease, runId: string, createdBy: string) {
    const s = this.stepRows.find((x) => x.id === stepId);
    if (!s || this.status !== "running" || s.status !== "leased" || s.leaseOwner !== lease.owner || s.attempt !== lease.attempt || (s.leaseExpiresAt ?? 0) <= this.now) return false;
    this.runs.set(runId, { id: runId, stepId, status: "queued", createdBy, errorCode: null, result: null });
    s.childRunId = runId;
    return true;
  }

  async findings() {
    return structuredClone(this.rows);
  }
  async steps() {
    return this.ordered().map((s) => ({ key: s.key, kind: s.kind, status: s.status, errorCode: s.errorCode }));
  }
  /** `key:status[:error]` lines (golden expectations). */
  view() {
    return this.ordered().map((s) => ({ key: s.key, status: s.status, error: s.errorCode }));
  }
}

// ---------------------------------------------------------------------------
// Child runs through the real orchestrator over a fake world
// ---------------------------------------------------------------------------

class MemoryRunStore implements RunStore {
  constructor(private readonly run: MemRun) {}
  private to(s: RunStatus) {
    assertTransition(this.run.status, s);
    this.run.status = s;
  }
  async startRun() {
    this.to("running");
  }
  async resumeRun() {
    this.to("running");
  }
  private seq = 0;
  async nextStepSeq() {
    return ++this.seq;
  }
  async addStep() {
    return crypto.randomUUID();
  }
  async finishStep() {}
  async addToolCall() {}
  async requestApproval(): Promise<string> {
    throw new Error("no approval in a free child run");
  }
  async completeRun(_r: string, _m: string, out: { result: AgentResult }) {
    this.to("completed");
    this.run.result = out.result;
  }
  async failRun(_r: string, _m: string, out: { code: string }) {
    this.to("failed");
    this.run.errorCode = out.code;
  }
}

export interface FixtureWorld {
  own: OwnCompanyContext | null;
  research: Map<string, StoredResearch>;
  knowledge: KnowledgeIndex;
  /** Tool ids called, for assertions (e.g. no web research). */
  calls: string[];
}

export const storedResearch = (profile: TargetProfile): StoredResearch => ({ id: crypto.randomUUID(), mode: "basic", researchedAt: new Date().toISOString(), profile, hypotheses: [] });

export function fixtureWorld(own: OwnCompanyContext, stored: readonly TargetProfile[]): FixtureWorld {
  const now = new Date().toISOString();
  return {
    own,
    research: new Map(stored.map((p) => [p.domain, storedResearch(p)])),
    knowledge: { ownDomain: "own.example", network: [], analyses: stored.map((p) => ({ domain: p.domain, name: p.name, researchedAt: now, mode: "basic" as const })), decisions: [] },
    calls: [],
  };
}

function fakeTools(w: FixtureWorld): Record<ToolId, ToolImpl<never, unknown>> {
  const real = TOOL_IMPLEMENTATIONS as Record<ToolId, ToolImpl<unknown, unknown>>;
  const fake = <I, O>(id: ToolId, run: (input: I) => Promise<O>): ToolImpl<never, unknown> =>
    ({
      ...real[id],
      precheck: undefined,
      run: (_env: unknown, input: I) => {
        w.calls.push(id);
        return run(input);
      },
    }) as unknown as ToolImpl<never, unknown>;
  return {
    ...(TOOL_IMPLEMENTATIONS as Record<ToolId, ToolImpl<never, unknown>>),
    read_workspace_company: fake("read_workspace_company", async () => ({ own: w.own })),
    read_network_company: fake("read_network_company", async () => ({ company: null })),
    read_existing_company_knowledge: fake("read_existing_company_knowledge", async () => ({ knowledge: w.knowledge })),
    source_known_candidates: fake("source_known_candidates", async (i: { limit: number }) => ({ candidates: knownCandidates(w.knowledge, i.limit), provider: null, usage: [] })),
    read_stored_research: fake("read_stored_research", async (i: { domain?: string }) => ({ research: (i.domain && w.research.get(i.domain)) || null })),
    // Like the database golden runs (no research gateway): nothing can be fetched from the web.
    official_site_research: fake("official_site_research", async () => {
      throw new ToolError("unavailable", "no_gateway");
    }),
    deep_company_research: fake("deep_company_research", async () => {
      throw new Error("deep research must be unreachable in a mission");
    }),
    search_web_candidates: fake("search_web_candidates", async () => {
      throw new Error("web search must be unreachable in a mission");
    }),
  };
}

const fakeDb = { from: () => ({ insert: async () => ({ error: null }) }) };

/**
 * Executes child runs like dbChildRunner does — same recovery table (childAction), same retry policy — but
 * with in-memory runs. `inject` lets a test replace the outcome of a step's attempt (crash, failure, busy).
 */
export class FixtureChildRunner implements ChildRunner {
  readonly started: string[] = [];
  inject: Record<string, (attempt: number) => ChildOutcome | "crash" | "throw" | null> = {};

  constructor(
    private readonly store: MemoryMissionStore,
    private readonly world: FixtureWorld,
    readonly userId: string,
  ) {}

  async run(step: ClaimedStep, spec: ChildRunSpec, previous: PreviousRun | null, lease: Lease): Promise<ChildOutcome> {
    const action = childAction(previous, this.userId);
    if (action.kind === "adopt") {
      const r = this.store.runs.get(action.runId);
      const parsed = AgentResultSchema.safeParse(r?.result);
      return parsed.success && r ? { status: "completed", runId: r.id, result: parsed.data, adopted: true } : { status: "failed", runId: action.runId, code: "internal", retry: true };
    }
    if (action.kind === "adopt_failure") return { status: "failed", runId: action.runId, code: action.code, retry: isRetryable(action.code) };
    if (action.kind === "interrupt") {
      const r = this.store.runs.get(action.runId);
      if (r && (r.status === "queued" || r.status === "running" || r.status === "waiting_for_approval")) Object.assign(r, { status: "failed", errorCode: "interrupted" });
    }
    const injected = this.inject[step.key]?.(step.attempt) ?? null;
    if (injected && injected !== "crash" && injected !== "throw" && (injected.status === "busy" || injected.status === "lease_lost")) return injected;

    let run: MemRun;
    if (action.kind === "resume") {
      run = this.store.runs.get(action.runId) as MemRun;
    } else {
      const runId = crypto.randomUUID();
      if (!this.store.attach(step.id, lease, runId, this.userId)) return { status: "lease_lost" };
      run = this.store.runs.get(runId) as MemRun;
    }
    this.started.push(`${step.key}#${step.attempt}`);
    if (injected === "throw") throw new Error("executor crashed");
    if (injected === "crash") {
      // The process dies mid-run: the run stays "running", the lease is never released or completed.
      run.status = "running";
      this.store.crashed = true;
      throw new CrashSignal();
    }
    if (injected) {
      if (injected.status === "failed") Object.assign(run, { status: "failed", errorCode: injected.code });
      return { ...injected, ...(injected.status === "failed" || injected.status === "completed" ? { runId: run.id } : {}) } as ChildOutcome;
    }

    const route = MISSION_ROUTES[spec.missionType];
    const agent = AGENT_REGISTRY[route.agent];
    const input = parseMissionInput(spec.missionType, spec.input) as MissionInput<"analyze_company"> | MissionInput<"discover_companies">;
    const outcome = await executeRun(
      { store: new MemoryRunStore(run), tools: fakeTools(this.world), env: { db: fakeDb as never, organizationId: "11111111-1111-4111-8111-111111111111", userId: this.userId, locale: "en", research: null } },
      { runId: run.id, missionId: crypto.randomUUID(), agent, capability: route.capability, autonomy: 1, missionType: spec.missionType, input, approvedTools: [], resumed: false },
    );
    if (outcome.status === "completed") return { status: "completed", runId: run.id, result: outcome.result, adopted: false };
    if (outcome.status === "failed") return { status: "failed", runId: run.id, code: outcome.code, retry: isRetryable(outcome.code) };
    return { status: "failed", runId: run.id, code: "approval_required", retry: false };
  }
}

/** Thrown by an injected crash: the test catches it to simulate a process that stopped mid-step. */
export class CrashSignal extends Error {
  constructor() {
    super("crash");
  }
}
