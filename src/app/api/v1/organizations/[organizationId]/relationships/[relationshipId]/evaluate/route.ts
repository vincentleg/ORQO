import { z } from "zod";
import { requireAuth } from "@/lib/server/auth/context";
import { assertSameOriginJson, json, readJson, toErrorResponse } from "@/lib/server/http";
import { evaluateRelationshipForOrganization } from "@/lib/server/orqo/evaluate";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/relationships/[relationshipId]/evaluate">;

/**
 * Runs the ORQO engine on a stored relationship. The body carries no state:
 * everything the engine sees is loaded from the database as the caller.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    // CSRF guard for cookie-authenticated writes (same policy as the research and agent routes).
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId, relationshipId } = await ctx.params;
    await readJson(request, z.object({}).strict());
    const outcome = await evaluateRelationshipForOrganization(db, { userId: user.id, organizationId, relationshipId });
    return json(outcome);
  } catch (e) {
    return toErrorResponse(e, "POST evaluate");
  }
}
