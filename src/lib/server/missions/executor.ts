/**
 * Mission executor (Phase 17B): lease-based, resumable execution of a mission's steps.
 *
 *   claim (recovers expired leases) → verify the step against the frozen contract → dispatch
 *   (child run | fan-out | compile) → complete (fenced by lease owner + attempt) → next step
 *
 * One call executes a bounded SLICE: any number of internal steps but at most `childRunsPerSlice` child runs,
 * because a child run executes synchronously inside the request (≤ ~130 s). The caller calls again to
 * continue; a crashed slice is recovered by the next one once its lease expires.
 *
 * Exactly-once effects: a child run is created through a key derived from (step, attempt), its completed
 * result is adopted rather than re-run, findings are idempotent by key, and a completion from an executor
 * that lost its lease (or of a cancelled mission) is rejected by the database, so it is never recorded.
 *
 * Persistence and child execution are injected (MissionStore, ChildRunner): the same loop runs against the
 * database and against in-memory fakes in tests. Control flow depends only on the contract, step specs and
 * typed outcomes — never on text from the web or a model.
 */
import type { AgentResult } from "@/lib/agents/contracts";
import type { Tripwire } from "@/lib/governance/tripwire";
import { verifyStep, type ChildRunSpec, type MissionContract, type PlannedStep } from "@/lib/missions/contracts";
import { compileSummary, findingsFromResult, planFanout, type MissionFinding, type StepState, type StoredFinding } from "@/lib/missions/findings";
import type { PreviousRun } from "@/lib/missions/recovery";
import { MISSION_LIMITS, type MissionStatus, type StepKind } from "@/lib/missions/types";
import { errorSummary } from "@/lib/server/observability";

export interface ClaimedStep {
  id: string;
  seq: number;
  key: string;
  kind: StepKind;
  required: boolean;
  spec: unknown;
  attempt: number;
  maxAttempts: number;
  recoveries: number;
}

export type ClaimResult =
  | { state: "claimed"; step: ClaimedStep; previousRun: PreviousRun | null; recovered: number }
  | { state: "in_progress"; leaseExpiresAt: string }
  | { state: Exclude<MissionStatus, "planned" | "running">; recovered: number };

export interface Completion {
  outcome: "completed" | "failed" | "skipped";
  errorCode: string | null;
  retry: boolean;
  result: Record<string, unknown> | null;
  findings: MissionFinding[];
  newSteps: PlannedStep[];
}

export type CompleteResult = { state: "rejected"; reason: "lease_lost" | `mission_${string}` } | { state: `step_${string}`; mission: MissionStatus };

export interface Lease {
  owner: string;
  attempt: number;
}

/** What the executor needs from persistence (database: dbMissionStore; tests: an in-memory store). */
export interface MissionStore {
  claim(missionId: string, owner: string, leaseSeconds: number): Promise<ClaimResult>;
  complete(stepId: string, lease: Lease, c: Completion): Promise<CompleteResult>;
  release(stepId: string, lease: Lease, consume: boolean): Promise<boolean>;
  findings(missionId: string): Promise<StoredFinding[]>;
  steps(missionId: string): Promise<StepState[]>;
}

export type ChildOutcome =
  | { status: "completed"; runId: string; result: AgentResult; adopted: boolean }
  | { status: "failed"; runId: string | null; code: string; retry: boolean }
  /** Another agent run of the organization is in progress: give the step back, try later. */
  | { status: "busy" }
  /** The step's lease was lost while starting the run: stop, the new holder owns the step. */
  | { status: "lease_lost" };

/** Executes (or recovers) the child run of one claimed step. Database: dbChildRunner; tests: fakes. */
export interface ChildRunner {
  run(step: ClaimedStep, spec: ChildRunSpec, previous: PreviousRun | null, lease: Lease): Promise<ChildOutcome>;
}

export interface ExecutorDeps {
  store: MissionStore;
  children: ChildRunner;
  /** The mission's frozen contract, already re-derived by the caller (contractMatches). */
  contract: MissionContract;
  onTripwire?: (tripwire: Tripwire, detail: string) => Promise<void>;
  newLeaseOwner?: () => string;
}

export type SliceState = "completed" | "failed" | "cancelled" | "in_progress" | "yielded" | "busy" | "lease_lost" | "error";

export interface ExecutedStep {
  key: string;
  kind: StepKind;
  attempt: number;
  outcome: "completed" | "failed" | "retry" | "skipped";
  runId: string | null;
  error: string | null;
}

export interface SliceResult {
  state: SliceState;
  executed: ExecutedStep[];
  recovered: number;
}

/** Hard cap on loop iterations per slice (every iteration finishes or gives back one step). */
const MAX_ITERATIONS = MISSION_LIMITS.maxSteps + 4;

export async function executeMissionSlice(deps: ExecutorDeps, missionId: string, opts: { childRuns?: number } = {}): Promise<SliceResult> {
  const owner = (deps.newLeaseOwner ?? (() => crypto.randomUUID()))();
  const maxChildRuns = opts.childRuns ?? MISSION_LIMITS.childRunsPerSlice;
  const executed: ExecutedStep[] = [];
  let recovered = 0;
  let childRuns = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const claim = await deps.store.claim(missionId, owner, MISSION_LIMITS.leaseSeconds);
    if (claim.state !== "claimed") {
      if ("recovered" in claim) recovered += claim.recovered;
      return { state: claim.state, executed, recovered };
    }
    recovered += claim.recovered;
    const step = claim.step;
    const lease: Lease = { owner, attempt: step.attempt };
    const finish = async (c: Partial<Completion> & Pick<Completion, "outcome">, runId: string | null): Promise<SliceState | null> => {
      const r = await deps.store.complete(step.id, lease, { errorCode: null, retry: false, result: null, findings: [], newSteps: [], ...c });
      if (r.state === "rejected") return r.reason === "lease_lost" ? "lease_lost" : "cancelled";
      const outcome = r.state === "step_pending" ? "retry" : c.outcome;
      executed.push({ key: step.key, kind: step.kind, attempt: step.attempt, outcome, runId, error: c.errorCode ?? null });
      return r.mission === "completed" || r.mission === "failed" || r.mission === "cancelled" ? r.mission : null;
    };

    try {
      // Integrity: only a step that is exactly what the contract planned (or a valid fan-out child) runs.
      const spec = verifyStep(deps.contract, { seq: step.seq, key: step.key, kind: step.kind, required: step.required, maxAttempts: step.maxAttempts, spec: step.spec });
      if (!spec || spec.kind !== step.kind) {
        await deps.onTripwire?.("authority_modification", `mission_step:${step.key}`);
        const end = await finish({ outcome: "failed", errorCode: "invalid_step" }, null);
        if (end) return { state: end, executed, recovered };
        continue;
      }

      let end: SliceState | null;
      if (spec.kind === "child_run") {
        if (childRuns >= maxChildRuns) {
          // The slice's child-run allowance is used: give the step back untouched (its attempt is not consumed).
          await deps.store.release(step.id, lease, false);
          return { state: "yielded", executed, recovered };
        }
        childRuns += 1;
        const out = await deps.children.run(step, spec, claim.previousRun, lease);
        if (out.status === "busy") {
          await deps.store.release(step.id, lease, false);
          return { state: "busy", executed, recovered };
        }
        if (out.status === "lease_lost") return { state: "lease_lost", executed, recovered };
        if (out.status === "completed") {
          end = await finish({ outcome: "completed", result: { runId: out.runId, kind: out.result.kind, adopted: out.adopted }, findings: findingsFromResult(step.key, out.result) }, out.runId);
        } else {
          end = await finish({ outcome: "failed", errorCode: out.code, retry: out.retry, result: out.runId ? { runId: out.runId } : null }, out.runId);
        }
      } else if (spec.kind === "fanout") {
        const children = planFanout(step, spec, await deps.store.findings(missionId));
        end = await finish({ outcome: "completed", result: { planned: children.length, keys: children.map((c) => c.key) }, newSteps: children }, null);
      } else {
        const [steps, findings] = await Promise.all([deps.store.steps(missionId), deps.store.findings(missionId)]);
        end = await finish({ outcome: "completed", findings: [compileSummary(steps, findings.filter((f) => f.kind !== "mission_summary"))] }, null);
      }
      if (end) return { state: end, executed, recovered };
    } catch (e) {
      // Unexpected failure (database, bug): give the step back with its attempt consumed, so retries stay bounded.
      console.error("[orqo] mission step failed", missionId, step.key, errorSummary(e));
      await deps.store.release(step.id, lease, true).catch(() => undefined);
      return { state: "error", executed, recovered };
    }
  }
  return { state: "yielded", executed, recovered };
}
