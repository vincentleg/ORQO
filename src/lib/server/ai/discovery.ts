/**
 * Legacy demo live discovery (Phase 2, `/api/discover`). Retired in Phase 17A: it called OpenRouter outside
 * any organization, authority or budget. The demo keeps its deterministic engine; the route answers with an
 * honest "unavailable". Paid model calls now go through the provider gate only.
 */
import type { World } from "@/lib/domain/types";
import type { OpportunityDraft } from "@/lib/engine/patterns";
import type { PatternTest } from "@/lib/engine/pipeline";
import { AIUnavailableError } from "./openrouter";

export async function discoverWithLLM(world: World, relationshipId: string): Promise<{ tests: PatternTest[]; drafts: OpportunityDraft[]; model: string }> {
  void world;
  void relationshipId;
  throw new AIUnavailableError("Live demo AI is retired. Model calls run only in a workspace, under its governed budget.");
}
