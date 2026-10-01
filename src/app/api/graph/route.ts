import type { World } from "@/lib/domain/types";
import { toGraph } from "@/lib/graph/elements";
import { requireAuth } from "@/lib/server/auth/context";
import { AppError } from "@/lib/server/errors";
import { graphRepository } from "@/lib/server/graph/repository";
import { json, toLegacyErrorResponse } from "@/lib/server/http";
import { errorSummary } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;

export async function GET() {
  const repo = graphRepository();
  return Response.json({ backend: repo.backend, ...(await repo.health()) });
}

/**
 * Legacy demo endpoint: mirrors the client's demo world graph into the
 * in-memory demo repository. Writes are restricted to signed-in users and
 * never reach Neo4j; the production Opportunity Graph (Phase 10) is projected
 * from PostgreSQL per organization by src/lib/server/graph/service.ts.
 */
export async function POST(req: Request) {
  try {
    await requireAuth(req);
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new AppError("invalid_input", "Request body is too large.");
    let body: { world?: World } | null = null;
    try {
      body = JSON.parse(text) as { world?: World } | null;
    } catch {
      body = null;
    }
    if (!body?.world?.companies || !body.world.relationships) throw new AppError("invalid_input", "Expected { world }");
    const repo = graphRepository();
    try {
      const counts = await repo.sync(toGraph(body.world, { detail: true }));
      return json({ backend: repo.backend, ...counts });
    } catch (e) {
      console.error("[orqo] graph sync failed", errorSummary(e));
      throw new AppError("unavailable", "Sync failed");
    }
  } catch (e) {
    return toLegacyErrorResponse(e, "POST /api/graph");
  }
}
