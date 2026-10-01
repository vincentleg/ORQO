/**
 * Observability hooks for agent runs. The database run history (runs, steps,
 * tool calls, usage, audit events) is the system of record in Phase 4. This
 * interface lets a tracing backend (e.g. Langfuse) subscribe later; none is
 * integrated or required today. Events carry ids, codes and timings only —
 * never prompts, page content or secrets.
 */
import type { AgentId, AutonomyLevel, MissionType, StepKey } from "@/lib/agents/types";

export interface AgentObserver {
  runStarted(e: { runId: string; agentId: AgentId; missionType: MissionType; autonomy: AutonomyLevel }): void;
  step(e: { runId: string; key: StepKey; status: "completed" | "failed" | "skipped" }): void;
  toolCall(e: { runId: string; toolId: string; outcome: "succeeded" | "failed" | "denied" | "approval_required" }): void;
  runFinished(e: { runId: string; status: "completed" | "failed" | "waiting_for_approval"; durationMs: number }): void;
}

export const noopObserver: AgentObserver = {
  runStarted: () => undefined,
  step: () => undefined,
  toolCall: () => undefined,
  runFinished: () => undefined,
};
