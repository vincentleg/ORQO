import { requireAuth } from "@/lib/server/auth/context";
import { assertSameOriginJson, json } from "@/lib/server/http";
import { missionRefusal } from "@/lib/server/missions/http";
import { cancelMission } from "@/lib/server/missions/service";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/missions/[missionId]/cancel">;

/**
 * POST …/missions/:missionId/cancel — cancels a planned or running mission (its creator or an admin; enforced
 * by cancel_mission). Pending and leased steps and queued child runs are cancelled; a child run already
 * executing finishes, but nothing from it is recorded. A finished mission: 409.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId, missionId } = await ctx.params;
    const r = await cancelMission(db, user.id, organizationId, missionId);
    return json({ status: "cancelled", ...r });
  } catch (e) {
    return missionRefusal(e, "POST mission cancel");
  }
}
