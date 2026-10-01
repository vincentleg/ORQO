import { requireAuth } from "@/lib/server/auth/context";
import { requireAgentReader } from "@/lib/server/agents/gate";
import { agentRefusal } from "@/lib/server/agents/http";
import { getRunDetail } from "@/lib/server/agents/repository";
import { AppError } from "@/lib/server/errors";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/agents/runs/[runId]">;

/** GET /api/v1/organizations/:org/agents/runs/:runId — one run with its steps, tool calls, approvals and (admins) usage. */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId, runId } = await ctx.params;
    const m = await requireAgentReader(db, user.id, organizationId);
    const d = await getRunDetail(db, m.organizationId, runId);
    if (!d) throw new AppError("not_found", "Run not found.");
    return json({
      run: { id: d.run.id, agentId: d.run.agent_id, capability: d.run.capability, autonomy: d.run.autonomy, status: d.run.status, approvalState: d.run.approval_state, error: d.run.error_code, result: d.run.result, counters: d.run.counters, limits: d.run.limits, queuedAt: d.run.queued_at, startedAt: d.run.started_at, finishedAt: d.run.finished_at, durationMs: d.run.duration_ms, mission: { type: d.run.agent_missions.mission_type, objective: d.run.agent_missions.objective } },
      steps: d.steps.map((s) => ({ seq: s.seq, key: s.step_key, status: s.status, summary: s.summary, startedAt: s.started_at, finishedAt: s.finished_at })),
      toolCalls: d.toolCalls.map((c) => ({ toolId: c.tool_id, outcome: c.outcome, detail: c.detail, costClass: c.cost_class, externalNetwork: c.external_network, researchRunId: c.research_run_id, durationMs: c.duration_ms, at: c.created_at })),
      approvals: d.approvals.map((a) => ({ id: a.id, toolId: a.tool_id, state: a.state, requestedAt: a.requested_at, expiresAt: a.expires_at, decidedAt: a.decided_at })),
      usage: d.usage,
    });
  } catch (e) {
    return agentRefusal(e, "GET agent run");
  }
}
