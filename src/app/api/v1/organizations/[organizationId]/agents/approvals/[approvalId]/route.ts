import { z } from "zod";
import { requireAuth } from "@/lib/server/auth/context";
import { agentRefusal, outcomeBody } from "@/lib/server/agents/http";
import { decideAndResume } from "@/lib/server/agents/service";
import { assertSameOriginJson, json, readJson } from "@/lib/server/http";
import { getRequestLocale } from "@/lib/server/i18n";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/agents/approvals/[approvalId]">;

const Body = z.strictObject({ decision: z.enum(["approve", "reject"]) });

/**
 * POST …/agents/approvals/:approvalId — admin decision on a pending agent
 * action. The decision is applied by the decide_agent_approval RPC (admin+,
 * not expired, not already decided); an approved run then resumes with the
 * approved tool only, after re-checking current entitlements.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId, approvalId } = await ctx.params;
    const body = await readJson(request, Body, 1024);
    const r = await decideAndResume(db, user.id, organizationId, approvalId, body.decision, await getRequestLocale());
    return json({ decision: r.decision, run: r.outcome ? outcomeBody(r.outcome) : null });
  } catch (e) {
    return agentRefusal(e, "POST agent approval");
  }
}
