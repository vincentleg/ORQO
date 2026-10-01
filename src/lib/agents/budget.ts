/**
 * Per-run agent budget. Every tool call reserves its declared worst case
 * (tool calls, external requests, model calls) BEFORE it executes, so a run
 * can never exceed its limits even if a tool uses its full allowance. The
 * nested research run keeps its own Phase 3 RunBudget as a second layer.
 */
import type { ExecutionLimits } from "./registry";
import type { ToolDefinition } from "./tools";

export type BudgetDimension = "toolCalls" | "modelCalls" | "externalRequests" | "duration" | "variableCost";

export class AgentBudgetExceeded extends Error {
  constructor(readonly dimension: BudgetDimension) {
    super(`Agent budget exhausted: ${dimension}.`);
  }
}

export interface BudgetCounters {
  toolCalls: number;
  modelCalls: number;
  externalRequests: number;
  costUsd: number;
}

export class AgentBudget {
  readonly used: BudgetCounters = { toolCalls: 0, modelCalls: 0, externalRequests: 0, costUsd: 0 };
  private readonly deadline: number;

  constructor(
    readonly limits: ExecutionLimits,
    private readonly clock: () => number = Date.now,
  ) {
    this.deadline = clock() + limits.maxDurationMs;
  }

  /** Reserves a tool call's worst case; throws without reserving anything when a limit would be exceeded. */
  reserve(tool: ToolDefinition): void {
    this.assertTime();
    if (this.used.toolCalls + 1 > this.limits.maxToolCalls) throw new AgentBudgetExceeded("toolCalls");
    if (this.used.externalRequests + tool.limits.maxExternalRequests > this.limits.maxExternalRequests) throw new AgentBudgetExceeded("externalRequests");
    if (this.used.modelCalls + tool.limits.maxModelCalls > this.limits.maxModelCalls) throw new AgentBudgetExceeded("modelCalls");
    this.used.toolCalls += 1;
    this.used.externalRequests += tool.limits.maxExternalRequests;
    this.used.modelCalls += tool.limits.maxModelCalls;
  }

  /** Adds provider-REPORTED cost (never estimated); throws once a configured ceiling is passed. */
  addCost(usd: number | null): void {
    if (usd === null || !Number.isFinite(usd) || usd <= 0) return;
    this.used.costUsd += usd;
    if (this.limits.maxVariableCostUsd !== null && this.used.costUsd > this.limits.maxVariableCostUsd) throw new AgentBudgetExceeded("variableCost");
  }

  assertTime(): void {
    if (this.clock() > this.deadline) throw new AgentBudgetExceeded("duration");
  }

  /** Run time left before the duration limit. */
  remainingMs(): number {
    return this.deadline - this.clock();
  }

  snapshot(): BudgetCounters {
    return { ...this.used };
  }
}
