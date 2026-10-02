import { requireAuth } from "@/lib/server/auth/context";
import { assertSameOriginJson, json, readJson, toErrorResponse } from "@/lib/server/http";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import { listTrackedOpportunities, TrackInput, trackOpportunity } from "@/lib/server/repositories/tracked-opportunities";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/opportunities">;

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const membership = await requireMembership(db, user.id, organizationId, "viewer");
    return json({ opportunities: await listTrackedOpportunities(db, membership.organizationId) });
  } catch (e) {
    return toErrorResponse(e, "GET opportunities");
  }
}

/** Track a credible opportunity: only { targetCompanyId, scenarioKey } is accepted; the server recomputes the rest. */
export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const membership = await requireMembership(db, user.id, organizationId, "member");
    const input = await readJson(request, TrackInput);
    const result = await trackOpportunity(db, membership.organizationId, input);
    return json(result, result.created ? 201 : 200);
  } catch (e) {
    return toErrorResponse(e, "POST opportunities");
  }
}
