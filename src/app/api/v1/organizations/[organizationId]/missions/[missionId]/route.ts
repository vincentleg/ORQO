import { requireAuth } from "@/lib/server/auth/context";
import { json } from "@/lib/server/http";
import { missionRefusal } from "@/lib/server/missions/http";
import { getMissionDetail, missionBody } from "@/lib/server/missions/service";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/missions/[missionId]">;

/** GET …/missions/:missionId — the mission with its progress, steps and findings (viewer+). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId, missionId } = await ctx.params;
    return json(missionBody(await getMissionDetail(db, user.id, organizationId, missionId)));
  } catch (e) {
    return missionRefusal(e, "GET mission");
  }
}
