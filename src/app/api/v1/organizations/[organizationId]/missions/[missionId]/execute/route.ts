import { requireAuth } from "@/lib/server/auth/context";
import { assertSameOriginJson, json } from "@/lib/server/http";
import { getRequestLocale } from "@/lib/server/i18n";
import { missionRefusal } from "@/lib/server/missions/http";
import { executeMission, getMissionDetail, missionBody } from "@/lib/server/missions/service";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/missions/[missionId]/execute">;

/**
 * POST …/missions/:missionId/execute — executes or resumes ONE bounded slice of the mission (member+): any
 * internal steps and at most one child run. Expired leases of stopped executors are recovered first. Call
 * again until `state` is terminal (completed, failed, cancelled). `in_progress`: another executor holds the
 * current step; `busy`: another agent run of the workspace is in progress; `yielded`: more work remains.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId, missionId } = await ctx.params;
    const slice = await executeMission(db, user.id, organizationId, missionId, await getRequestLocale());
    const detail = await getMissionDetail(db, user.id, organizationId, missionId);
    return json({ state: slice.state, executed: slice.executed, recovered: slice.recovered, ...missionBody(detail) });
  } catch (e) {
    return missionRefusal(e, "POST mission execute");
  }
}
