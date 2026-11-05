/**
 * Mission execution driver policy (Phase 17C). Pure and deterministic: given what the last call to
 * POST …/missions/:id/execute returned, decide whether to call again, after how long, or stop.
 *
 * Why a client-side driver: Phase 17B executes a mission in bounded slices (one child run per call) and has
 * no background worker. The mission page calls execute while the mission is executable; the database leases
 * make a second tab, a refresh or a retry harmless (another executor gets `in_progress`, a lost lease is
 * rejected, completed work is adopted). This policy keeps the loop bounded:
 *   - one call at a time (the caller awaits each call before deciding);
 *   - `yielded` (more work, this slice's child run used) → call again at once;
 *   - `busy` / `in_progress` / `lease_lost` / 409 / 429 → wait with backoff, at most MAX_WAITS in a row;
 *   - `error`, 5xx, network failure → retry with backoff, at most MAX_ERRORS in a row;
 *   - terminal state, 401/403/404 → stop;
 *   - at most MAX_CALLS calls per page session → stop and offer "Resume".
 * Stopping never loses work: the mission is persisted; the next visit (or Resume) continues it.
 */

export const DRIVER_LIMITS = {
  maxCalls: 40,
  maxWaits: 12,
  maxErrors: 3,
  /** Backoff ladder (ms) for waits and retries. */
  backoffMs: [3_000, 6_000, 12_000, 24_000, 30_000],
} as const;

export type ExecuteOutcome = { kind: "state"; state: string } | { kind: "http"; status: number } | { kind: "network" };

export type StopReason = "terminal" | "unauthenticated" | "forbidden" | "not_found" | "budget" | "errors" | "waiting";

export type DriverDecision = { action: "execute"; delayMs: number; waiting: boolean; retrying: boolean } | { action: "stop"; reason: StopReason };

export interface DriverState {
  calls: number;
  waits: number;
  errors: number;
}

export const initialDriverState = (): DriverState => ({ calls: 0, waits: 0, errors: 0 });

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const WAIT_STATES = new Set(["busy", "in_progress", "lease_lost"]);

const backoff = (n: number) => DRIVER_LIMITS.backoffMs[Math.min(Math.max(n, 1), DRIVER_LIMITS.backoffMs.length) - 1];

/** The decision after one execute call (`state.calls` counts the call just made). */
export function nextDecision(prev: DriverState, outcome: ExecuteOutcome): { state: DriverState; decision: DriverDecision } {
  const calls = prev.calls + 1;
  const stop = (reason: StopReason) => ({ state: { ...prev, calls }, decision: { action: "stop", reason } as DriverDecision });

  let kind: "progress" | "wait" | "error";
  if (outcome.kind === "state") {
    if (TERMINAL.has(outcome.state)) return stop("terminal");
    kind = outcome.state === "yielded" ? "progress" : WAIT_STATES.has(outcome.state) ? "wait" : "error";
  } else if (outcome.kind === "http") {
    if (outcome.status === 401) return stop("unauthenticated");
    if (outcome.status === 403) return stop("forbidden");
    if (outcome.status === 404) return stop("not_found");
    kind = outcome.status === 409 || outcome.status === 429 ? "wait" : "error";
  } else kind = "error";

  if (calls >= DRIVER_LIMITS.maxCalls) return stop("budget");
  if (kind === "progress") return { state: { calls, waits: 0, errors: 0 }, decision: { action: "execute", delayMs: 0, waiting: false, retrying: false } };
  if (kind === "wait") {
    const waits = prev.waits + 1;
    if (waits > DRIVER_LIMITS.maxWaits) return stop("waiting");
    return { state: { calls, waits, errors: 0 }, decision: { action: "execute", delayMs: backoff(waits), waiting: true, retrying: false } };
  }
  const errors = prev.errors + 1;
  if (errors > DRIVER_LIMITS.maxErrors) return stop("errors");
  return { state: { calls, waits: prev.waits, errors }, decision: { action: "execute", delayMs: backoff(errors), waiting: false, retrying: true } };
}

/** Whether the driver should start at all for a mission in this status (members only; viewers just read). */
export const shouldDrive = (status: string, canExecute: boolean) => canExecute && (status === "planned" || status === "running");
