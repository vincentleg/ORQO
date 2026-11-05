import "server-only";
/**
 * Mission service (Phase 17B): the authority chain around the mission engine, used by the mission routes.
 *
 *   create:  member + agent entitlement for EVERY agent the plan may delegate to (authorizeMission, the same
 *            gate as direct agent missions) → deterministic plan (template) → create_mission (idempotent)
 *   inspect: viewer+ (RLS)
 *   execute: member + the stored contract equals the server's own rebuild → one executor slice
 *            (each child run is re-authorized and gets a free authority; see children.ts)
 *   cancel:  creator or admin (cancel_mission)
 */
import { z } from "zod";
import { contractMatches, planMission } from "@/lib/missions/contracts";
import { MISSION_TEMPLATES } from "@/lib/missions/types";
import { isMissionTerminal } from "@/lib/missions/state";
import type { StoredFinding } from "@/lib/missions/findings";
import type { Locale } from "@/lib/i18n/config";
import { authorizeMission, requireAgentReader } from "@/lib/server/agents/gate";
import { researchGateway } from "@/lib/server/agents/service";
import type { ResearchGateway } from "@/lib/server/agents/tools";
import { AppError } from "@/lib/server/errors";
import { recordTripwire } from "@/lib/server/governance/ledger";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { Db } from "@/lib/server/supabase/types";
import { dbChildRunner } from "./children";
import { executeMissionSlice, type SliceResult } from "./executor";
import type { MissionView, StepSubject } from "@/lib/missions/view";
import { cancelMissionRecord, createMissionRecord, dbMissionStore, getMission, listFindings, listSteps, missionSpend, type MissionRow, type MissionStepRow } from "./repository";

/** Strict: a caller cannot pass steps, a contract, an envelope, a budget, tools or an organization. */
export const MissionCreateRequest = z.strictObject({
  template: z.enum(MISSION_TEMPLATES),
  input: z.unknown(),
  idempotencyKey: z.uuid(),
});
export type MissionCreateRequest = z.infer<typeof MissionCreateRequest>;

export async function createMission(db: Db, userId: string, requestedOrganizationId: string, req: MissionCreateRequest): Promise<{ missionId: string; status: string; reused: boolean }> {
  const plan = planMission(req.template, req.input);
  // Role and entitlement first (same refusals as direct agent missions), then the input contract.
  const missionTypes = plan?.missionTypes ?? [];
  const auths = [];
  for (const missionType of missionTypes.length ? missionTypes : (["analyze_company"] as const)) auths.push(await authorizeMission(db, userId, requestedOrganizationId, { agentId: null, missionType, autonomy: 1 }));
  if (!plan) throw new AppError("invalid_input", "The mission input is invalid.");
  return createMissionRecord(db, auths[0].organizationId, plan, req.idempotencyKey);
}

export interface MissionProgress {
  total: number;
  pending: number;
  leased: number;
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

export interface MissionDetail {
  mission: MissionRow;
  steps: MissionStepRow[];
  findings: StoredFinding[];
  progress: MissionProgress;
  spend: MissionView["spend"];
}

export function progressOf(steps: readonly { status: string }[]): MissionProgress {
  const n = (s: string) => steps.filter((x) => x.status === s).length;
  return { total: steps.length, pending: n("pending"), leased: n("leased"), completed: n("completed"), failed: n("failed"), skipped: n("skipped"), cancelled: n("cancelled") };
}

export async function getMissionDetail(db: Db, userId: string, requestedOrganizationId: string, missionId: string): Promise<MissionDetail> {
  const m = await requireAgentReader(db, userId, requestedOrganizationId);
  const mission = await getMission(db, m.organizationId, missionId);
  if (!mission) throw new AppError("not_found", "Mission not found.");
  const [steps, findings] = await Promise.all([listSteps(db, m.organizationId, mission.id), listFindings(db, m.organizationId, mission.id)]);
  const spend = await missionSpend(db, m.organizationId, steps.map((s) => s.id));
  return { mission, steps, findings, progress: progressOf(steps), spend };
}

export interface ExecuteOptions {
  /** Injected in tests (no web access). Defaults to the governed research entry point (Basic only reachable). */
  research?: ResearchGateway | null;
  childRuns?: number;
}

/** Executes (or resumes) one bounded slice of a mission. Safe to call repeatedly and concurrently. */
export async function executeMission(db: Db, userId: string, requestedOrganizationId: string, missionId: string, locale: Locale, opts: ExecuteOptions = {}): Promise<SliceResult & { mission: MissionRow }> {
  const m = await requireMembership(db, userId, requestedOrganizationId, "member");
  const mission = await getMission(db, m.organizationId, missionId);
  if (!mission) throw new AppError("not_found", "Mission not found.");
  if (isMissionTerminal(mission.status)) return { state: mission.status as SliceResult["state"], executed: [], recovered: 0, mission };
  // Integrity: the stored plan must be exactly what the server builds from the stored template and input.
  const plan = contractMatches({ template: mission.template, templateVersion: mission.template_version, input: mission.input, contract: mission.contract });
  if (!plan) {
    await recordTripwire(db, m.organizationId, "authority_modification", null, "mission_contract");
    throw new AppError("forbidden", "This mission cannot be executed.");
  }
  const slice = await executeMissionSlice(
    {
      store: dbMissionStore(db, m.organizationId),
      children: dbChildRunner({ db, organizationId: m.organizationId, userId, locale, research: opts.research === undefined ? researchGateway : opts.research }),
      contract: plan.contract,
      onTripwire: (t, d) => recordTripwire(db, m.organizationId, t, null, d),
    },
    mission.id,
    { childRuns: opts.childRuns },
  );
  return { ...slice, mission: (await getMission(db, m.organizationId, mission.id)) ?? mission };
}

export async function cancelMission(db: Db, userId: string, requestedOrganizationId: string, missionId: string) {
  const m = await requireMembership(db, userId, requestedOrganizationId, "member");
  if (!z.uuid().safeParse(missionId).success) throw new AppError("not_found", "Mission not found.");
  return cancelMissionRecord(db, m.organizationId, missionId);
}

/** What a child step works on (its research target), read from the server-built step spec. */
function subjectOf(spec: Record<string, unknown>): StepSubject | null {
  const target = (spec.input as { target?: unknown } | undefined)?.target;
  const t = z.union([z.strictObject({ query: z.string().max(200) }), z.strictObject({ companyId: z.uuid() })]).safeParse(target);
  return t.success ? t.data : null;
}

const Envelope = z.object({ envelope: z.object({ maxCostUsd: z.number(), paidProviders: z.boolean(), webSearch: z.boolean(), deepResearch: z.boolean() }) });

/** Public, safe view of a mission (no lease owner, no contract internals beyond its paid authority). */
export function missionBody(d: MissionDetail): MissionView {
  const { mission: m } = d;
  const envelope = Envelope.safeParse(m.contract);
  return {
    mission: { id: m.id, template: m.template as MissionView["mission"]["template"], templateVersion: m.template_version, objective: m.objective, input: m.input, status: m.status, failureReason: m.failure_reason, createdAt: m.created_at, startedAt: m.started_at, finishedAt: m.finished_at },
    progress: d.progress,
    steps: d.steps.map((s) => ({ seq: s.seq, key: s.step_key, kind: s.kind, required: s.required, status: s.status, attempt: s.attempt, maxAttempts: s.max_attempts, recoveries: s.recoveries, leaseExpiresAt: s.lease_expires_at, childRunId: s.child_run_id, error: s.error_code, result: s.result, subject: s.kind === "child_run" ? subjectOf(s.spec) : null, startedAt: s.started_at, finishedAt: s.finished_at })),
    findings: d.findings.map((f) => ({ id: f.id, key: f.key, kind: f.kind, subjectDomain: f.subjectDomain, stepKey: f.stepKey, agentRunId: f.agentRunId, payload: f.payload, createdAt: f.createdAt })),
    // A contract that does not parse grants nothing: shown as $0, never as more.
    authority: envelope.success ? envelope.data.envelope : { maxCostUsd: 0, paidProviders: false, webSearch: false, deepResearch: false },
    spend: d.spend,
  };
}
