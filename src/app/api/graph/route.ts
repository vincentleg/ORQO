import type { World } from "@/lib/domain/types";
import { toGraph } from "@/lib/graph/elements";
import { graphRepository } from "@/lib/server/graph/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = graphRepository();
  return Response.json({ backend: repo.backend, ...(await repo.health()) });
}

/** Mirrors the client's world graph into the configured repository. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { world?: World } | null;
  if (!body?.world?.companies || !body.world.relationships) return Response.json({ error: "Expected { world }" }, { status: 400 });
  const repo = graphRepository();
  try {
    const counts = await repo.sync(toGraph(body.world, { detail: true }));
    return Response.json({ backend: repo.backend, ...counts });
  } catch (e) {
    console.error("[orqo] graph sync failed", e);
    return Response.json({ backend: repo.backend, error: e instanceof Error ? e.message.slice(0, 160) : "Sync failed" }, { status: 502 });
  }
}
