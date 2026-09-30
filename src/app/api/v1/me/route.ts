import { requireAuth } from "@/lib/server/auth/context";
import { json, readJson, toErrorResponse } from "@/lib/server/http";
import { ProfileUpdate, getProfile, updateProfile } from "@/lib/server/repositories/tenancy";
import { AppError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireAuth(request);
    const profile = await getProfile(db, user.id);
    if (!profile) throw new AppError("not_found", "Profile not found.");
    return json({ profile });
  } catch (e) {
    return toErrorResponse(e, "GET /api/v1/me");
  }
}

/** Updates the caller's own profile (display name, language preference). */
export async function PATCH(request: Request) {
  try {
    const { db, user } = await requireAuth(request);
    const input = await readJson(request, ProfileUpdate);
    return json({ profile: await updateProfile(db, user.id, input) });
  } catch (e) {
    return toErrorResponse(e, "PATCH /api/v1/me");
  }
}
