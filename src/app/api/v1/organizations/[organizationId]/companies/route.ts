import { requireAuth } from "@/lib/server/auth/context";
import { json, readJson, toErrorResponse } from "@/lib/server/http";
import { NewCompanyInput, createCompany, listCompanies } from "@/lib/server/repositories/companies";
import { requireMembership } from "@/lib/server/repositories/tenancy";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/companies">;

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const membership = await requireMembership(db, user.id, organizationId, "viewer");
    return json({ companies: await listCompanies(db, membership.organizationId) });
  } catch (e) {
    return toErrorResponse(e, "GET companies");
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const membership = await requireMembership(db, user.id, organizationId, "member");
    const input = await readJson(request, NewCompanyInput);
    return json({ company: await createCompany(db, membership.organizationId, input) }, 201);
  } catch (e) {
    return toErrorResponse(e, "POST companies");
  }
}
