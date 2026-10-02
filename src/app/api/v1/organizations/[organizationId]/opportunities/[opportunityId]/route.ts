import { AppError } from "@/lib/server/errors";
import { requireAuth } from "@/lib/server/auth/context";
import { assertSameOriginJson, json, readJson, toErrorResponse } from "@/lib/server/http";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import { getTrackedOpportunity, setTrackedStatus, StatusInput } from "@/lib/server/repositories/tracked-opportunities";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/opportunities/[opportunityId]">;

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId, opportunityId } = await ctx.params;
    const membership = await requireMembership(db, user.id, organizationId, "viewer");
    const opportunity = await getTrackedOpportunity(db, membership.organizationId, opportunityId);
    if (!opportunity) throw new AppError("not_found", "Opportunity not found.");
    return json({ opportunity });
  } catch (e) {
    return toErrorResponse(e, "GET opportunity");
  }
}

/** Change the status only. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId, opportunityId } = await ctx.params;
    const membership = await requireMembership(db, user.id, organizationId, "member");
    const input = await readJson(request, StatusInput);
    return json({ opportunity: await setTrackedStatus(db, membership.organizationId, opportunityId, input) });
  } catch (e) {
    return toErrorResponse(e, "PATCH opportunity");
  }
}
