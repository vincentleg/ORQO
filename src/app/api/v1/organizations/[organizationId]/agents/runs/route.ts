import { requireAuth } from "@/lib/server/auth/context";
import { requireAgentReader } from "@/lib/server/agents/gate";
import { agentRefusal } from "@/lib/server/agents/http";
import { listRuns } from "@/lib/server/agents/repository";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/agents/runs">;

/** GET /api/v1/organizations/:org/agents/runs — recent agent runs of the workspace (viewer+). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const m = await requireAgentReader(db, user.id, organizationId);
    const runs = await listRuns(db, m.organizationId, { limit: 20 });
    return json({
      runs: runs.map((r) => ({ id: r.id, missionId: r.mission_id, agentId: r.agent_id, missionType: r.agent_missions.mission_type, objective: r.agent_missions.objective, status: r.status, approvalState: r.approval_state, error: r.error_code, queuedAt: r.queued_at, finishedAt: r.finished_at, durationMs: r.duration_ms })),
    });
  } catch (e) {
    return agentRefusal(e, "GET agent runs");
  }
}
