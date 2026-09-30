import { requireAuth } from "@/lib/server/auth/context";
import { AIUnavailableError } from "@/lib/server/ai/openrouter";
import { AppError } from "@/lib/server/errors";
import { json, toLegacyErrorResponse } from "@/lib/server/http";
import { ResearchUnavailableError, researchCompany } from "@/lib/server/research/brave";

export const dynamic = "force-dynamic";

/** GET /api/research?company=Name → structured Company with cited web sources. Signed-in users only: it spends search and model credits. */
export async function GET(req: Request) {
  try {
    await requireAuth(req);
    const name = new URL(req.url).searchParams.get("company")?.trim();
    if (!name || name.length > 120) throw new AppError("invalid_input", "Expected ?company=<name>");
    try {
      return json(await researchCompany(name));
    } catch (e) {
      if (e instanceof ResearchUnavailableError || e instanceof AIUnavailableError) throw new AppError("unavailable", e.message);
      console.error("[orqo] research failed", e instanceof Error ? e.message.slice(0, 300) : e);
      throw new AppError("unavailable", "Research failed");
    }
  } catch (e) {
    return toLegacyErrorResponse(e, "GET /api/research");
  }
}
