/**
 * Persistence for missions, runs, steps, tool calls and approvals. Every call
 * runs as the signed-in user (RLS applies) and also filters by organization.
 * Run status changes are additionally checked by a database trigger that
 * mirrors src/lib/agents/state.ts.
 */
import { z } from "zod";
import type { AgentResult } from "@/lib/agents/contracts";
import type { ExecutionLimits } from "@/lib/agents/registry";
import { RUN_STATUSES, STEP_STATUSES, type AgentId, type AutonomyLevel, type CapabilityId, type MissionType, type RunFailure, type RunStatus, type StepKey, type StepStatus, type ToolId } from "@/lib/agents/types";
import type { CostClass } from "@/lib/agents/tools";
import { AppError, fromDbError } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";
import { AGENT_QUOTA, AGENT_RUN_STALE_AFTER_SECONDS, APPROVAL_TTL_HOURS } from "./config";

/** Why a mission could not start (quota or concurrency). */
export class AgentRunRefusedError extends AppError {
  constructor(readonly reason: "quota_exhausted" | "busy") {
    super(reason === "quota_exhausted" ? "rate_limited" : "conflict", reason === "quota_exhausted" ? "Agent run limit reached for now." : "An agent run is already in progress.");
  }
}

export interface NewMission {
  agentId: AgentId;
  missionType: MissionType;
  capability: CapabilityId;
  objective: string;
  input: Record<string, unknown>;
  autonomy: AutonomyLevel;
  limits: ExecutionLimits;
  idempotencyKey: string;
}

const Created = z.object({ mission_id: z.uuid(), run_id: z.uuid(), status: z.enum(RUN_STATUSES), reused: z.boolean() });

/** Atomic idempotency + concurrency + quota guard (create_agent_mission RPC). */
export async function createMission(db: Db, organizationId: string, m: NewMission): Promise<{ missionId: string; runId: string; status: RunStatus; reused: boolean }> {
  const { data, error } = await db.rpc("create_agent_mission", {
    p_organization_id: organizationId,
    p_agent_id: m.agentId,
    p_mission_type: m.missionType,
    p_capability: m.capability,
    p_objective: m.objective.slice(0, 300),
    p_input: m.input,
    p_autonomy: m.autonomy,
    p_limits: m.limits,
    p_idempotency_key: m.idempotencyKey,
    p_max_runs: AGENT_QUOTA.maxRunsPerOrg,
    p_window_hours: AGENT_QUOTA.windowHours,
    p_stale_after_seconds: AGENT_RUN_STALE_AFTER_SECONDS,
  });
  if (error) {
    if (error.code === "54000") throw new AgentRunRefusedError("quota_exhausted");
    if (error.code === "55P03") throw new AgentRunRefusedError("busy");
    throw fromDbError(error);
  }
  const r = Created.parse(data);
  return { missionId: r.mission_id, runId: r.run_id, status: r.status, reused: r.reused };
}

export interface ToolCallRecord {
  toolId: string;
  outcome: "succeeded" | "failed" | "denied" | "approval_required";
  detail: string | null;
  costClass: CostClass;
  externalNetwork: boolean;
  researchRunId: string | null;
  ref: Record<string, string | number | boolean | null>;
  durationMs: number;
}

export interface RunCounters {
  toolCalls: number;
  modelCalls: number;
  externalRequests: number;
  costUsd: number;
}

/** What the orchestrator needs from persistence. The database implementation is below; tests may use an in-memory one. */
export interface RunStore {
  startRun(runId: string, missionId: string): Promise<void>;
  resumeRun(runId: string, missionId: string): Promise<void>;
  nextStepSeq(runId: string): Promise<number>;
  addStep(runId: string, seq: number, key: StepKey): Promise<string>;
  finishStep(stepId: string, status: Exclude<StepStatus, "running">, summary: Record<string, unknown>): Promise<void>;
  addToolCall(runId: string, stepId: string | null, call: ToolCallRecord): Promise<void>;
  requestApproval(runId: string, toolId: ToolId, action: Record<string, unknown>): Promise<string>;
  completeRun(runId: string, missionId: string, out: { result: AgentResult; counters: RunCounters; durationMs: number; summary: string }): Promise<void>;
  failRun(runId: string, missionId: string, out: { code: RunFailure; counters: RunCounters; durationMs: number }): Promise<void>;
}

export function dbRunStore(db: Db, organizationId: string): RunStore {
  const now = () => new Date().toISOString();
  const updateRun = async (runId: string, patch: Record<string, unknown>) => {
    const { error } = await db.from("agent_runs").update(patch).eq("organization_id", organizationId).eq("id", runId);
    if (error) throw fromDbError(error);
  };
  const updateMission = async (missionId: string, patch: Record<string, unknown>) => {
    const { error } = await db.from("agent_missions").update(patch).eq("organization_id", organizationId).eq("id", missionId);
    if (error) throw fromDbError(error);
  };
  return {
    async startRun(runId, missionId) {
      await updateRun(runId, { status: "running", started_at: now() });
      await updateMission(missionId, { status: "running", started_at: now() });
    },
    async resumeRun(runId, missionId) {
      await updateRun(runId, { status: "running" });
      await updateMission(missionId, { status: "running" });
    },
    async nextStepSeq(runId) {
      const { data, error } = await db.from("agent_run_steps").select("seq").eq("organization_id", organizationId).eq("run_id", runId).order("seq", { ascending: false }).limit(1);
      if (error) throw fromDbError(error);
      return (z.array(z.object({ seq: z.number() })).parse(data)[0]?.seq ?? 0) + 1;
    },
    async addStep(runId, seq, key) {
      const { data, error } = await db.from("agent_run_steps").insert({ organization_id: organizationId, run_id: runId, seq, step_key: key }).select("id").single();
      if (error) throw fromDbError(error);
      return z.object({ id: z.uuid() }).parse(data).id;
    },
    async finishStep(stepId, status, summary) {
      const { error } = await db.from("agent_run_steps").update({ status, summary, finished_at: now() }).eq("organization_id", organizationId).eq("id", stepId);
      if (error) throw fromDbError(error);
    },
    async addToolCall(runId, stepId, c) {
      const { error } = await db.from("agent_run_tool_calls").insert({
        organization_id: organizationId,
        run_id: runId,
        step_id: stepId,
        tool_id: /^[a-z_]{1,60}$/.test(c.toolId) ? c.toolId : "unregistered",
        outcome: c.outcome,
        detail: c.detail,
        cost_class: c.costClass,
        external_network: c.externalNetwork,
        research_run_id: c.researchRunId,
        output_ref: c.ref,
        duration_ms: Math.max(0, Math.round(c.durationMs)),
      });
      if (error) throw fromDbError(error);
    },
    async requestApproval(runId, toolId, action) {
      const { data, error } = await db.rpc("request_agent_approval", { p_organization_id: organizationId, p_run_id: runId, p_tool_id: toolId, p_action: action, p_ttl_hours: APPROVAL_TTL_HOURS });
      if (error) throw fromDbError(error);
      return z.uuid().parse(data);
    },
    async completeRun(runId, missionId, out) {
      await updateRun(runId, { status: "completed", result: out.result, counters: out.counters, finished_at: now(), duration_ms: Math.round(out.durationMs) });
      await updateMission(missionId, { status: "completed", result_summary: out.summary.slice(0, 500), completed_at: now() });
    },
    async failRun(runId, missionId, out) {
      await updateRun(runId, { status: "failed", error_code: out.code, counters: out.counters, finished_at: now(), duration_ms: Math.round(out.durationMs) });
      await updateMission(missionId, { status: "failed", failure_reason: out.code, completed_at: now() });
    },
  };
}

// ---------------------------------------------------------------------------
// Approvals and cancellation (database-enforced)
// ---------------------------------------------------------------------------

export async function decideApproval(db: Db, organizationId: string, approvalId: string, decision: "approve" | "reject"): Promise<"approved" | "rejected" | "expired"> {
  const { data, error } = await db.rpc("decide_agent_approval", { p_organization_id: organizationId, p_approval_id: approvalId, p_decision: decision });
  if (error) {
    if (error.code === "55000") throw new AppError("conflict", "This approval was already decided.");
    throw fromDbError(error, "Approval not found.");
  }
  return z.enum(["approved", "rejected", "expired"]).parse(data);
}

export async function cancelRun(db: Db, organizationId: string, runId: string): Promise<void> {
  const { error } = await db.rpc("cancel_agent_run", { p_organization_id: organizationId, p_run_id: runId });
  if (error) {
    if (error.code === "55000") throw new AppError("conflict", "Only a queued run or a run waiting for approval can be cancelled.");
    throw fromDbError(error, "Run not found.");
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const RunRow = z.object({
  id: z.uuid(),
  mission_id: z.uuid(),
  agent_id: z.string(),
  capability: z.string(),
  autonomy: z.number().int(),
  status: z.enum(RUN_STATUSES),
  approval_state: z.string(),
  limits: z.record(z.string(), z.unknown()),
  counters: z.record(z.string(), z.unknown()),
  result: z.unknown().nullable(),
  error_code: z.string().nullable(),
  queued_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  created_by: z.uuid().nullable(),
  agent_missions: z.object({ mission_type: z.string(), objective: z.string(), input: z.record(z.string(), z.unknown()), idempotency_key: z.uuid() }),
});
export type AgentRunRow = z.infer<typeof RunRow>;

const RUN_COLUMNS = "id, mission_id, agent_id, capability, autonomy, status, approval_state, limits, counters, result, error_code, queued_at, started_at, finished_at, duration_ms, created_by, agent_missions!inner(mission_type, objective, input, idempotency_key)";

export async function listRuns(db: Db, organizationId: string, opts: { limit?: number; agentId?: string } = {}): Promise<AgentRunRow[]> {
  let q = db.from("agent_runs").select(RUN_COLUMNS).eq("organization_id", organizationId);
  if (opts.agentId) q = q.eq("agent_id", opts.agentId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(Math.min(opts.limit ?? 20, 50));
  if (error) throw fromDbError(error);
  return z.array(RunRow).parse(data);
}

export async function getRun(db: Db, organizationId: string, runId: string): Promise<AgentRunRow | null> {
  if (!z.uuid().safeParse(runId).success) return null;
  const { data, error } = await db.from("agent_runs").select(RUN_COLUMNS).eq("organization_id", organizationId).eq("id", runId).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? RunRow.parse(data) : null;
}

const StepRow = z.object({ id: z.uuid(), seq: z.number(), step_key: z.string(), status: z.enum(STEP_STATUSES), summary: z.record(z.string(), z.unknown()), started_at: z.string(), finished_at: z.string().nullable() });
const ToolCallRow = z.object({ tool_id: z.string(), outcome: z.string(), detail: z.string().nullable(), cost_class: z.string(), external_network: z.boolean(), research_run_id: z.uuid().nullable(), duration_ms: z.number(), created_at: z.string(), step_id: z.uuid().nullable() });
const ApprovalRow = z.object({ id: z.uuid(), tool_id: z.string(), action: z.record(z.string(), z.unknown()), state: z.string(), requested_at: z.string(), expires_at: z.string(), decided_at: z.string().nullable() });
const UsageRow = z.object({ provider: z.string(), service: z.string(), operation: z.string(), succeeded: z.boolean(), units: z.record(z.string(), z.number()), cost_usd: z.union([z.number(), z.string()]).nullable() });

export interface RunDetail {
  run: AgentRunRow;
  steps: z.infer<typeof StepRow>[];
  toolCalls: z.infer<typeof ToolCallRow>[];
  approvals: z.infer<typeof ApprovalRow>[];
  /** Provider usage attributed to the run. Readable by admins only (RLS); empty for other roles. */
  usage: z.infer<typeof UsageRow>[];
}

export async function getRunDetail(db: Db, organizationId: string, runId: string): Promise<RunDetail | null> {
  const run = await getRun(db, organizationId, runId);
  if (!run) return null;
  const [steps, calls, approvals, usage] = await Promise.all([
    db.from("agent_run_steps").select("id, seq, step_key, status, summary, started_at, finished_at").eq("organization_id", organizationId).eq("run_id", runId).order("seq"),
    db.from("agent_run_tool_calls").select("tool_id, outcome, detail, cost_class, external_network, research_run_id, duration_ms, created_at, step_id").eq("organization_id", organizationId).eq("run_id", runId).order("created_at"),
    db.from("agent_approvals").select("id, tool_id, action, state, requested_at, expires_at, decided_at").eq("organization_id", organizationId).eq("run_id", runId).order("requested_at"),
    db.from("usage_events").select("provider, service, operation, succeeded, units, cost_usd").eq("organization_id", organizationId).eq("agent_run_id", runId),
  ]);
  for (const r of [steps, calls, approvals, usage]) if (r.error) throw fromDbError(r.error);
  return {
    run,
    steps: z.array(StepRow).parse(steps.data),
    toolCalls: z.array(ToolCallRow).parse(calls.data),
    approvals: z.array(ApprovalRow).parse(approvals.data),
    usage: z.array(UsageRow).parse(usage.data),
  };
}

/** The open approval of a run that the server may resume, read from the database (never from a request payload). */
export async function getApproval(db: Db, organizationId: string, approvalId: string): Promise<{ id: string; runId: string; toolId: string; state: string } | null> {
  if (!z.uuid().safeParse(approvalId).success) return null;
  const { data, error } = await db.from("agent_approvals").select("id, run_id, tool_id, state").eq("organization_id", organizationId).eq("id", approvalId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) return null;
  const r = z.object({ id: z.uuid(), run_id: z.uuid(), tool_id: z.string(), state: z.string() }).parse(data);
  return { id: r.id, runId: r.run_id, toolId: r.tool_id, state: r.state };
}
