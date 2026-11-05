/**
 * Mission persistence (Phase 17B). Every call runs as the signed-in user (RLS applies) and filters by
 * organization. Missions, steps and findings have NO direct write grant: they change only through the
 * database functions of the 17B migration, which check membership, leases (owner + attempt), the mission's
 * status and the state machines.
 */
import { z } from "zod";
import { RUN_STATUSES } from "@/lib/agents/types";
import type { MissionPlan } from "@/lib/missions/contracts";
import type { StoredFinding } from "@/lib/missions/findings";
import { FINDING_KINDS, MISSION_LIMITS, MISSION_STATUSES, MISSION_STEP_STATUSES, STEP_KINDS } from "@/lib/missions/types";
import { AppError, fromDbError } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";
import { AgentRunRefusedError } from "@/lib/server/agents/repository";
import type { ClaimResult, CompleteResult, Completion, Lease, MissionStore } from "./executor";

/** Why a mission could not be created (quota or too many active missions). */
export class MissionRefusedError extends AppError {
  constructor(readonly reason: "quota_exhausted" | "busy") {
    super(reason === "quota_exhausted" ? "rate_limited" : "conflict", reason === "quota_exhausted" ? "Mission limit reached for now." : "Too many missions are in progress.");
  }
}

export class LeaseLostError extends Error {
  constructor() {
    super("lease_lost");
  }
}

const Created = z.object({ mission_id: z.uuid(), status: z.enum(MISSION_STATUSES), reused: z.boolean() });

/** Atomic idempotency + active cap + quota (create_mission). */
export async function createMissionRecord(db: Db, organizationId: string, plan: MissionPlan, idempotencyKey: string): Promise<{ missionId: string; status: string; reused: boolean }> {
  const { data, error } = await db.rpc("create_mission", {
    p_organization_id: organizationId,
    p_template: plan.template,
    p_template_version: plan.templateVersion,
    p_objective: plan.objective,
    p_input: plan.input,
    p_contract: plan.contract,
    p_steps: plan.contract.steps,
    p_idempotency_key: idempotencyKey,
    p_max_missions: MISSION_LIMITS.maxPerWindow,
    p_window_hours: MISSION_LIMITS.windowHours,
    p_max_active: MISSION_LIMITS.maxActive,
  });
  if (error) {
    if (error.code === "54000") throw new MissionRefusedError("quota_exhausted");
    if (error.code === "55P03") throw new MissionRefusedError("busy");
    throw fromDbError(error);
  }
  const r = Created.parse(data);
  return { missionId: r.mission_id, status: r.status, reused: r.reused };
}

export async function cancelMissionRecord(db: Db, organizationId: string, missionId: string): Promise<{ cancelledSteps: number; cancelledRuns: number; runningRuns: number }> {
  const { data, error } = await db.rpc("cancel_mission", { p_organization_id: organizationId, p_mission_id: missionId });
  if (error) {
    if (error.code === "55000") throw new AppError("conflict", "Only a planned or running mission can be cancelled.");
    throw fromDbError(error, "Mission not found.");
  }
  const r = z.object({ cancelled_steps: z.number(), cancelled_runs: z.number(), running_runs: z.number() }).parse(data);
  return { cancelledSteps: r.cancelled_steps, cancelledRuns: r.cancelled_runs, runningRuns: r.running_runs };
}

export interface ChildRunRequest {
  agentId: string;
  missionType: string;
  capability: string;
  objective: string;
  input: Record<string, unknown>;
  autonomy: number;
  limits: Record<string, unknown>;
  maxRuns: number;
  windowHours: number;
  staleAfterSeconds: number;
}

/** Creates the agent run of a leased child-run step (idempotent per step and attempt) and links it to the step. */
export async function attachChildRun(db: Db, organizationId: string, stepId: string, lease: Lease, r: ChildRunRequest): Promise<{ missionId: string; runId: string; reused: boolean }> {
  const { data, error } = await db.rpc("attach_mission_child_run", {
    p_organization_id: organizationId,
    p_step_id: stepId,
    p_lease_owner: lease.owner,
    p_attempt: lease.attempt,
    p_agent_id: r.agentId,
    p_mission_type: r.missionType,
    p_capability: r.capability,
    p_objective: r.objective.slice(0, 300),
    p_input: r.input,
    p_autonomy: r.autonomy,
    p_limits: r.limits,
    p_max_runs: r.maxRuns,
    p_window_hours: r.windowHours,
    p_stale_after_seconds: r.staleAfterSeconds,
  });
  if (error) {
    if (error.code === "54000") throw new AgentRunRefusedError("quota_exhausted");
    if (error.code === "55P03") throw new AgentRunRefusedError("busy");
    if (error.code === "55000") throw new LeaseLostError();
    throw fromDbError(error);
  }
  const res = z.object({ mission_id: z.uuid(), run_id: z.uuid(), reused: z.boolean() }).parse(data);
  return { missionId: res.mission_id, runId: res.run_id, reused: res.reused };
}

// ---------------------------------------------------------------------------
// Executor store
// ---------------------------------------------------------------------------

const ClaimRow = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("claimed"),
    recovered: z.number().int(),
    step: z.object({ id: z.uuid(), seq: z.number().int(), key: z.string(), kind: z.enum(STEP_KINDS), required: z.boolean(), spec: z.unknown(), attempt: z.number().int(), max_attempts: z.number().int(), recoveries: z.number().int() }),
    previous_run: z.object({ id: z.uuid(), status: z.enum(RUN_STATUSES), created_by: z.uuid().nullable(), has_authority: z.boolean(), error_code: z.string().nullable() }).nullable(),
  }),
  z.object({ state: z.literal("in_progress"), lease_expires_at: z.string() }),
  z.object({ state: z.enum(["completed", "failed", "cancelled"]), recovered: z.number().int().optional() }),
]);

const FindingRow = z.object({ id: z.uuid(), step_id: z.uuid(), agent_run_id: z.uuid().nullable(), finding_key: z.string(), kind: z.enum(FINDING_KINDS), subject_domain: z.string().nullable(), payload: z.record(z.string(), z.unknown()), created_at: z.string(), mission_steps: z.object({ step_key: z.string() }) });

export async function listFindings(db: Db, organizationId: string, missionId: string): Promise<StoredFinding[]> {
  const { data, error } = await db
    .from("mission_findings")
    .select("id, step_id, agent_run_id, finding_key, kind, subject_domain, payload, created_at, mission_steps!inner(step_key)")
    .eq("organization_id", organizationId)
    .eq("mission_id", missionId)
    .order("created_at")
    .order("finding_key");
  if (error) throw fromDbError(error);
  return z
    .array(FindingRow)
    .parse(data)
    .map((f) => ({ id: f.id, stepId: f.step_id, stepKey: f.mission_steps.step_key, agentRunId: f.agent_run_id, key: f.finding_key, kind: f.kind, subjectDomain: f.subject_domain, payload: f.payload, createdAt: f.created_at }));
}

export function dbMissionStore(db: Db, organizationId: string): MissionStore {
  return {
    async claim(missionId, owner, leaseSeconds): Promise<ClaimResult> {
      const { data, error } = await db.rpc("claim_mission_step", { p_organization_id: organizationId, p_mission_id: missionId, p_lease_owner: owner, p_lease_seconds: leaseSeconds });
      if (error) throw fromDbError(error, "Mission not found.");
      const r = ClaimRow.parse(data);
      if (r.state === "claimed") {
        const s = r.step;
        const p = r.previous_run;
        return {
          state: "claimed",
          recovered: r.recovered,
          step: { id: s.id, seq: s.seq, key: s.key, kind: s.kind, required: s.required, spec: s.spec, attempt: s.attempt, maxAttempts: s.max_attempts, recoveries: s.recoveries },
          previousRun: p ? { id: p.id, status: p.status, createdBy: p.created_by, hasAuthority: p.has_authority, errorCode: p.error_code } : null,
        };
      }
      if (r.state === "in_progress") return { state: "in_progress", leaseExpiresAt: r.lease_expires_at };
      return { state: r.state, recovered: r.recovered ?? 0 };
    },
    async complete(stepId, lease, c: Completion): Promise<CompleteResult> {
      const { data, error } = await db.rpc("complete_mission_step", {
        p_organization_id: organizationId,
        p_step_id: stepId,
        p_lease_owner: lease.owner,
        p_attempt: lease.attempt,
        p_outcome: c.outcome,
        p_error_code: c.errorCode && /^[a-z_]{1,40}$/.test(c.errorCode) ? c.errorCode : c.errorCode ? "internal" : null,
        p_retry: c.retry,
        p_result: c.result,
        p_findings: c.findings,
        p_new_steps: c.newSteps,
      });
      if (error) throw fromDbError(error);
      return z.union([z.object({ state: z.literal("rejected"), reason: z.string() }), z.object({ state: z.string(), mission: z.enum(MISSION_STATUSES) })]).parse(data) as CompleteResult;
    },
    async release(stepId, lease, consume) {
      const { data, error } = await db.rpc("release_mission_step", { p_organization_id: organizationId, p_step_id: stepId, p_lease_owner: lease.owner, p_attempt: lease.attempt, p_consume: consume });
      if (error) throw fromDbError(error);
      return data === true;
    },
    findings: (missionId) => listFindings(db, organizationId, missionId),
    async steps(missionId) {
      const { data, error } = await db.from("mission_steps").select("step_key, kind, status, error_code").eq("organization_id", organizationId).eq("mission_id", missionId).order("seq");
      if (error) throw fromDbError(error);
      return z
        .array(z.object({ step_key: z.string(), kind: z.string(), status: z.string(), error_code: z.string().nullable() }))
        .parse(data)
        .map((s) => ({ key: s.step_key, kind: s.kind, status: s.status, errorCode: s.error_code }));
    },
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const MissionRow = z.object({
  id: z.uuid(),
  template: z.string(),
  template_version: z.number().int(),
  objective: z.string(),
  input: z.record(z.string(), z.unknown()),
  contract: z.record(z.string(), z.unknown()),
  status: z.enum(MISSION_STATUSES),
  failure_reason: z.string().nullable(),
  created_by: z.uuid().nullable(),
  cancelled_by: z.uuid().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type MissionRow = z.infer<typeof MissionRow>;
const MISSION_COLUMNS = "id, template, template_version, objective, input, contract, status, failure_reason, created_by, cancelled_by, created_at, started_at, finished_at";

const StepRow = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  step_key: z.string(),
  kind: z.enum(STEP_KINDS),
  required: z.boolean(),
  status: z.enum(MISSION_STEP_STATUSES),
  attempt: z.number().int(),
  max_attempts: z.number().int(),
  recoveries: z.number().int(),
  lease_expires_at: z.string().nullable(),
  child_run_id: z.uuid().nullable(),
  error_code: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  spec: z.record(z.string(), z.unknown()),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type MissionStepRow = z.infer<typeof StepRow>;

export async function getMission(db: Db, organizationId: string, missionId: string): Promise<MissionRow | null> {
  if (!z.uuid().safeParse(missionId).success) return null;
  const { data, error } = await db.from("missions").select(MISSION_COLUMNS).eq("organization_id", organizationId).eq("id", missionId).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? MissionRow.parse(data) : null;
}

export async function listMissions(db: Db, organizationId: string, limit = 20): Promise<MissionRow[]> {
  const { data, error } = await db.from("missions").select(MISSION_COLUMNS).eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(Math.min(limit, 50));
  if (error) throw fromDbError(error);
  return z.array(MissionRow).parse(data);
}

export async function listSteps(db: Db, organizationId: string, missionId: string): Promise<MissionStepRow[]> {
  const { data, error } = await db
    .from("mission_steps")
    .select("id, seq, step_key, kind, required, status, attempt, max_attempts, recoveries, lease_expires_at, child_run_id, error_code, result, spec, started_at, finished_at")
    .eq("organization_id", organizationId)
    .eq("mission_id", missionId)
    .order("seq");
  if (error) throw fromDbError(error);
  return z.array(StepRow).parse(data);
}

/**
 * Provider spend recorded for the child runs of a mission's steps (every attempt), from the provider ledger
 * (viewer-readable). Phase 17B/17C missions are free, so this is $0 with no call; Phase 17D fills it.
 */
export async function missionSpend(db: Db, organizationId: string, stepIds: string[]): Promise<{ committedUsd: number; settledUsd: number; calls: number }> {
  const none = { committedUsd: 0, settledUsd: 0, calls: 0 };
  if (stepIds.length === 0) return none;
  const runs = await db.from("agent_runs").select("id").eq("organization_id", organizationId).in("mission_step_id", stepIds);
  if (runs.error) throw fromDbError(runs.error);
  const runIds = z.array(z.object({ id: z.uuid() })).parse(runs.data).map((r) => r.id);
  if (runIds.length === 0) return none;
  const spend = await db.from("provider_spend").select("reserved_usd, settled_usd, status").eq("organization_id", organizationId).in("agent_run_id", runIds);
  if (spend.error) throw fromDbError(spend.error);
  const num = z.union([z.number(), z.string()]).nullable().transform((v) => (v === null ? 0 : Number(v)));
  const rows = z.array(z.object({ reserved_usd: num, settled_usd: num, status: z.string() })).parse(spend.data);
  const settled = rows.filter((r) => r.status === "settled").reduce((a, r) => a + r.settled_usd, 0);
  const reserved = rows.filter((r) => r.status === "reserved").reduce((a, r) => a + r.reserved_usd, 0);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { committedUsd: round(settled + reserved), settledUsd: round(settled), calls: rows.filter((r) => r.status !== "released").length };
}
