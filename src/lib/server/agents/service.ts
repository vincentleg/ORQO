import "server-only";
/**
 * Mission service: wires the authority chain, persistence, the real tools and
 * the governed research entry point into the orchestrator. Used by the agent
 * API routes only.
 */
import { z } from "zod";
import { MissionTypeSchema, parseMissionInput, type MissionInput } from "@/lib/agents/contracts";
import { mayDecideApproval } from "@/lib/agents/policy";
import { AutonomySchema, type AutonomyLevel, type MissionType, type StepKey, type ToolId } from "@/lib/agents/types";
import { isRegisteredTool } from "@/lib/agents/tools";
import type { Locale } from "@/lib/i18n/config";
import { AppError } from "@/lib/server/errors";
import { prepareResearch, runPreparedResearch } from "@/lib/server/research/execute";
import { authorizeResearch } from "@/lib/server/research/policy";
import type { Db } from "@/lib/server/supabase/types";
import { AgentDeniedError, authorizeMission, requireAgentReader } from "./gate";
import { executeRun, type RunOutcome } from "./orchestrator";
import { createMission, dbRunStore, decideApproval, getApproval, getRun } from "./repository";
import { configuredWebCandidateSource, webSearchEntitled } from "@/lib/server/discovery/sources";
import { TOOL_IMPLEMENTATIONS, type DiscoveryGateway, type ResearchGateway } from "./tools";

/** Strict: a caller cannot pass plan, budget, tools, organization or approval fields. */
export const MissionRequest = z.strictObject({
  agentId: z.string().min(1).max(40).optional(),
  missionType: MissionTypeSchema,
  input: z.unknown(),
  autonomy: AutonomySchema.optional(),
  idempotencyKey: z.uuid(),
});
export type MissionRequest = z.infer<typeof MissionRequest>;

const researchGateway: ResearchGateway = { authorize: authorizeResearch, prepare: prepareResearch, run: (p) => runPreparedResearch(p) };
const discoveryGateway: DiscoveryGateway = { webSource: configuredWebCandidateSource, webEntitled: webSearchEntitled };

export type StepEvent = { key: StepKey; status: "running" | "completed" | "failed" | "skipped" };

export interface Accepted {
  missionId: string;
  runId: string;
  reused: boolean;
}

function objectiveOf(type: MissionType, input: MissionInput<"analyze_company"> | MissionInput<"explain_opportunities"> | MissionInput<"discover_companies">): string {
  // Built by the server from validated fields only.
  if (!("target" in input)) return [type, input.intent, input.objective, input.market, input.geography].filter(Boolean).join(" · ");
  const target = "query" in input.target ? input.target.query : `company:${input.target.companyId}`;
  return `${type} · ${target}`;
}

/**
 * Authorizes and creates a mission (idempotent), then returns a function that
 * executes it. Splitting lets the route refuse with a JSON status before it
 * opens a stream.
 */
export async function acceptMission(db: Db, userId: string, requestedOrganizationId: string, req: MissionRequest, locale: Locale): Promise<{ accepted: Accepted; execute: (onStep: (e: StepEvent) => void) => Promise<RunOutcome | null> }> {
  const auth = await authorizeMission(db, userId, requestedOrganizationId, { agentId: req.agentId ?? null, missionType: req.missionType, autonomy: (req.autonomy ?? null) as AutonomyLevel | null });
  const input = parseMissionInput(req.missionType, req.input);
  if (!input) throw new AppError("invalid_input", "The mission input is invalid.");
  const created = await createMission(db, auth.organizationId, {
    agentId: auth.agent.id,
    missionType: req.missionType,
    capability: auth.capability,
    objective: objectiveOf(req.missionType, input),
    input: input as Record<string, unknown>,
    autonomy: auth.autonomy,
    limits: auth.agent.limits,
    idempotencyKey: req.idempotencyKey,
  });
  const accepted = { missionId: created.missionId, runId: created.runId, reused: created.reused };
  return {
    accepted,
    async execute(onStep) {
      // A duplicate submission returns the existing run; it never executes twice.
      if (created.reused) return null;
      return executeRun(
        { store: dbRunStore(db, auth.organizationId), tools: TOOL_IMPLEMENTATIONS, env: { db, organizationId: auth.organizationId, userId, locale, research: researchGateway, discovery: discoveryGateway }, onStep },
        { runId: created.runId, missionId: created.missionId, agent: auth.agent, capability: auth.capability, autonomy: auth.autonomy, missionType: req.missionType, input, approvedTools: [], resumed: false },
      );
    },
  };
}

/**
 * Records an approval decision (admin+, enforced by the database RPC) and,
 * when approved, resumes the run. The approved tool is read from the database
 * row, and the mission is re-authorized against CURRENT entitlements.
 */
export async function decideAndResume(db: Db, userId: string, requestedOrganizationId: string, approvalId: string, decision: "approve" | "reject", locale: Locale): Promise<{ decision: "approved" | "rejected" | "expired"; outcome: RunOutcome | null }> {
  const membership = await requireAgentReader(db, userId, requestedOrganizationId);
  if (!mayDecideApproval(membership.role)) throw new AppError("forbidden", "Only an admin can decide approvals.");
  const approval = await getApproval(db, membership.organizationId, approvalId);
  if (!approval) throw new AppError("not_found", "Approval not found.");
  const result = await decideApproval(db, membership.organizationId, approvalId, decision);
  if (result !== "approved") return { decision: result, outcome: null };

  const run = await getRun(db, membership.organizationId, approval.runId);
  if (!run || run.status !== "waiting_for_approval" || run.approval_state !== "approved" || !isRegisteredTool(approval.toolId)) throw new AppError("conflict", "This run cannot be resumed.");
  const missionType = MissionTypeSchema.parse(run.agent_missions.mission_type);
  const input = parseMissionInput(missionType, run.agent_missions.input);
  if (!input) throw new AppError("conflict", "This run cannot be resumed.");
  let auth: Awaited<ReturnType<typeof authorizeMission>>;
  try {
    auth = await authorizeMission(db, userId, membership.organizationId, { agentId: run.agent_id, missionType, autonomy: AutonomySchema.parse(run.autonomy) });
  } catch (e) {
    // Entitlement changed since the run started: close the run instead of leaving it waiting.
    if (e instanceof AgentDeniedError) {
      await dbRunStore(db, membership.organizationId).failRun(run.id, run.mission_id, { code: e.reason === "plan_required" ? "plan_required" : "tool_denied", counters: { toolCalls: 0, modelCalls: 0, externalRequests: 0, costUsd: 0 }, durationMs: 0 });
    }
    throw e;
  }
  const outcome = await executeRun(
    { store: dbRunStore(db, auth.organizationId), tools: TOOL_IMPLEMENTATIONS, env: { db, organizationId: auth.organizationId, userId, locale, research: researchGateway, discovery: discoveryGateway } },
    { runId: run.id, missionId: run.mission_id, agent: auth.agent, capability: auth.capability, autonomy: auth.autonomy, missionType, input, approvedTools: [approval.toolId as ToolId], resumed: true },
  );
  return { decision: result, outcome };
}
