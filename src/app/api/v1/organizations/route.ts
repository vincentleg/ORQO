import { requireAuth } from "@/lib/server/auth/context";
import { json, readJson, toErrorResponse } from "@/lib/server/http";
import { NewOrganizationInput, createOrganization, listMyOrganizations } from "@/lib/server/repositories/tenancy";

export const dynamic = "force-dynamic";

/** Organizations the caller belongs to, with their role in each. */
export async function GET(request: Request) {
  try {
    const { db, user } = await requireAuth(request);
    return json({ organizations: await listMyOrganizations(db, user.id) });
  } catch (e) {
    return toErrorResponse(e, "GET /api/v1/organizations");
  }
}

/** Creates an organization; the caller becomes its owner. */
export async function POST(request: Request) {
  try {
    const { db } = await requireAuth(request);
    const input = await readJson(request, NewOrganizationInput);
    return json({ id: await createOrganization(db, input) }, 201);
  } catch (e) {
    return toErrorResponse(e, "POST /api/v1/organizations");
  }
}
