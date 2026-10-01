import type { World } from "@/lib/domain/types";
import { evaluateRelationship } from "@/lib/engine/pipeline";
import { requireAuth } from "@/lib/server/auth/context";
import { discoverWithLLM } from "@/lib/server/ai/discovery";
import { AIUnavailableError } from "@/lib/server/ai/openrouter";
import { AppError } from "@/lib/server/errors";
import { legacyLiveProvidersEnabled } from "@/lib/server/config";
import { json, toLegacyErrorResponse } from "@/lib/server/http";
import { errorSummary } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

/** The demo world is ~30 KB; anything far larger is not a demo request. */
const MAX_BODY_BYTES = 512 * 1024;

function isWorld(v: unknown): v is World {
  if (typeof v !== "object" || v === null) return false;
  const w = v as Record<string, unknown>;
  return typeof w.now === "string" && typeof w.companies === "object" && typeof w.relationships === "object" && typeof w.people === "object";
}

/**
 * Legacy demo endpoint: live OpenRouter discovery over the browser-local demo
 * world. The world is client-supplied demo data, so this route is not used by
 * the production app (which evaluates server-side state via /api/v1). It is
 * restricted to signed-in users because every call spends model credits.
 */
export async function POST(req: Request) {
  try {
    await requireAuth(req);
    if (!legacyLiveProvidersEnabled()) throw new AppError("unavailable", "Live providers are disabled for the demo.");
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new AppError("invalid_input", "Request body is too large.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError("invalid_input", "Invalid JSON");
    }
    const { world, relationshipId } = (body ?? {}) as { world?: unknown; relationshipId?: unknown };
    if (!isWorld(world) || typeof relationshipId !== "string" || !world.relationships[relationshipId]) {
      throw new AppError("invalid_input", "Expected { world, relationshipId }");
    }
    try {
      const { tests, drafts, model } = await discoverWithLLM(world, relationshipId);
      const result = evaluateRelationship(world, relationshipId, { tests, drafts });
      return json({ result, engine: `openrouter:${model}` });
    } catch (e) {
      if (e instanceof AIUnavailableError) throw new AppError("unavailable", e.message);
      console.error("[orqo] live discovery failed", errorSummary(e));
      throw new AppError("unavailable", "Live discovery failed");
    }
  } catch (e) {
    return toLegacyErrorResponse(e, "POST /api/discover");
  }
}
