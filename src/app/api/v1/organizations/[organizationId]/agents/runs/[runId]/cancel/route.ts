import { requireAuth } from "@/lib/server/auth/context";
import { requireAgentReader } from "@/lib/server/agents/gate";
import { agentRefusal } from "@/lib/server/agents/http";
import { cancelRun } from "@/lib/server/agents/repository";
import { assertSameOriginJson, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/agents/runs/[runId]/cancel">;

/**
 * POST …/agents/runs/:runId/cancel — cancels a queued run or a run waiting for
 * approval (its starter or an admin; enforced by cancel_agent_run). A running
 * run executes synchronously and cannot be interrupted: 409.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId, runId } = await ctx.params;
    const m = await requireAgentReader(db, user.id, organizationId);
    await cancelRun(db, m.organizationId, runId);
    return json({ status: "cancelled" });
  } catch (e) {
    return agentRefusal(e, "POST cancel agent run");
  }
}
