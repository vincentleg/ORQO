/**
 * Child-run recovery (Phase 17B): what an executor does with the run a step's previous attempt left behind.
 * Pure decision table; the executor applies it after it claimed the step (so it owns the step's lease).
 *
 *   no previous run                 → new        start a new child run
 *   completed                       → adopt      use its result; never run the same work twice
 *   failed | cancelled (unreported) → adopt_failure   report its failure (retry policy below)
 *   queued, created by this user    → resume     set its authority if missing, then execute it
 *   queued by someone else, running,
 *   or waiting for approval         → interrupt  close it as "interrupted" (its executor is gone: the lease
 *                                                expired), then start a new run
 *
 * A reported retryable failure clears the step's run (complete_mission_step), so it is never re-adopted.
 */
import type { RunFailure, RunStatus } from "@/lib/agents/types";

export interface PreviousRun {
  id: string;
  status: RunStatus;
  createdBy: string | null;
  hasAuthority: boolean;
  errorCode: string | null;
}

export type ChildAction =
  | { kind: "new" }
  | { kind: "adopt"; runId: string }
  | { kind: "adopt_failure"; runId: string; code: string }
  | { kind: "resume"; runId: string }
  | { kind: "interrupt"; runId: string };

export function childAction(previous: PreviousRun | null, userId: string): ChildAction {
  if (!previous) return { kind: "new" };
  switch (previous.status) {
    case "completed":
      return { kind: "adopt", runId: previous.id };
    case "failed":
    case "cancelled":
      return { kind: "adopt_failure", runId: previous.id, code: previous.errorCode ?? (previous.status === "cancelled" ? "cancelled" : "internal") };
    case "queued":
      return previous.createdBy === userId ? { kind: "resume", runId: previous.id } : { kind: "interrupt", runId: previous.id };
    case "running":
    case "waiting_for_approval":
      return { kind: "interrupt", runId: previous.id };
  }
}

/**
 * Failures worth another attempt: transient by nature. Business outcomes (target not found, own profile
 * missing, refused by policy, plan, cancelled) are deterministic and fail the step at once.
 */
const RETRYABLE: ReadonlySet<string> = new Set<RunFailure | string>(["internal", "interrupted", "research_failed"]);
export const isRetryable = (code: string) => RETRYABLE.has(code);
