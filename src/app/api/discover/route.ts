import type { World } from "@/lib/domain/types";
import { evaluateRelationship } from "@/lib/engine/pipeline";
import { discoverWithLLM } from "@/lib/server/ai/discovery";
import { AIUnavailableError } from "@/lib/server/ai/openrouter";

export const dynamic = "force-dynamic";

function isWorld(v: unknown): v is World {
  if (typeof v !== "object" || v === null) return false;
  const w = v as Record<string, unknown>;
  return typeof w.now === "string" && typeof w.companies === "object" && typeof w.relationships === "object" && typeof w.people === "object";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { world, relationshipId } = (body ?? {}) as { world?: unknown; relationshipId?: unknown };
  if (!isWorld(world) || typeof relationshipId !== "string" || !world.relationships[relationshipId]) {
    return Response.json({ error: "Expected { world, relationshipId }" }, { status: 400 });
  }
  try {
    const { tests, drafts, model } = await discoverWithLLM(world, relationshipId);
    const result = evaluateRelationship(world, relationshipId, { tests, drafts });
    return Response.json({ result, engine: `openrouter:${model}` });
  } catch (e) {
    if (e instanceof AIUnavailableError) return Response.json({ error: e.message }, { status: 503 });
    console.error("[orqo] live discovery failed", e);
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 160) : "Discovery failed" }, { status: 502 });
  }
}
