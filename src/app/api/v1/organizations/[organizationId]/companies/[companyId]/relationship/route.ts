import { z } from "zod";
import { requireAuth } from "@/lib/server/auth/context";
import { assertSameOriginJson, json, readJson, toErrorResponse } from "@/lib/server/http";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import { addRelationshipAnswer, getCompanyDossier } from "@/lib/server/repositories/understanding";
import { AppError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/companies/[companyId]/relationship">;

/** The relationship ORQO currently assesses for a remembered company, and whether the question is still open. */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId, companyId } = await ctx.params;
    const membership = await requireMembership(db, user.id, organizationId, "viewer");
    const resolved = await getCompanyDossier(db, membership.organizationId, companyId);
    if (!resolved) throw new AppError("not_found", "Company not found.");
    const d = resolved.dossier;
    return json({ relationship: d?.relationship ?? null, askRelationship: d?.askRelationship ?? false, verdict: d?.verdict ?? null });
  } catch (e) {
    return toErrorResponse(e, "GET relationship");
  }
}

/** Answer "How does this company work with you today?" (one to three roles, "none" or "not_sure"). */
export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId, companyId } = await ctx.params;
    const membership = await requireMembership(db, user.id, organizationId, "member");
    const input = await readJson(request, z.object({ values: z.array(z.string()).max(3) }));
    await addRelationshipAnswer(db, membership.organizationId, companyId, input);
    return json({ ok: true }, 201);
  } catch (e) {
    return toErrorResponse(e, "POST relationship");
  }
}
