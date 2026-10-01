/**
 * Hard execution limits for one research run. Every provider call and page
 * fetch must first `spend()` from the budget; once a limit or the deadline is
 * reached the run fails closed. There are no retries and no loops that are
 * not bounded by these counters.
 */
import type { ResearchLimits } from "./config";
import { ResearchError } from "./types";

export type BudgetKind = "searchQueries" | "officialPages" | "thirdPartyPages" | "modelCalls" | "robots";

const LIMIT_OF: Record<BudgetKind, (l: ResearchLimits) => number> = {
  searchQueries: (l) => l.maxSearchQueries,
  officialPages: (l) => l.maxOfficialPages,
  thirdPartyPages: (l) => l.maxThirdPartyPages,
  modelCalls: (l) => l.maxModelCalls,
  robots: () => 1,
};

export class RunBudget {
  readonly counters: Record<BudgetKind | "bytes", number> = { searchQueries: 0, officialPages: 0, thirdPartyPages: 0, modelCalls: 0, robots: 0, bytes: 0 };
  private readonly deadline: number;

  constructor(
    readonly limits: ResearchLimits,
    private readonly clock: () => number = Date.now,
  ) {
    this.deadline = clock() + limits.runTimeoutMs;
  }

  remaining(kind: BudgetKind): number {
    return LIMIT_OF[kind](this.limits) - this.counters[kind];
  }

  /** Reserves one unit; throws when the limit or the run deadline is reached. */
  spend(kind: BudgetKind): void {
    this.assertTime();
    if (this.remaining(kind) <= 0) throw new ResearchError("budget_exceeded", `Research limit reached: ${kind}.`);
    this.counters[kind]++;
  }

  addBytes(n: number): void {
    this.counters.bytes += n;
  }

  assertTime(): void {
    if (this.clock() > this.deadline) throw new ResearchError("timeout", "Research run timed out.");
  }

  /** Milliseconds left before the run deadline (for per-call timeouts). */
  timeLeft(): number {
    return Math.max(0, this.deadline - this.clock());
  }
}
