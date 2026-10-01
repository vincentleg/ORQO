/**
 * Deterministic run state machine. The same table is enforced by a database
 * trigger (agent_runs), so neither application code nor a direct API call can
 * move a run backwards. A model never chooses a transition.
 *
 *   queued → running → completed
 *                    → failed
 *                    → waiting_for_approval → running   (approved)
 *                                           → cancelled (rejected / cancelled)
 *                                           → failed    (expired)
 *   queued → cancelled | failed
 *
 * A running run cannot be cancelled: runs execute synchronously inside one
 * request and the architecture cannot interrupt them.
 */
import type { RunStatus } from "./types";

export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["completed", "failed", "waiting_for_approval"],
  waiting_for_approval: ["running", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: RunStatus): boolean {
  return RUN_TRANSITIONS[status].length === 0;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(`Invalid run transition ${from} → ${to}.`);
  }
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
