/**
 * Legacy demo research (Phase 2, `/api/research`). Retired in Phase 17A: it called Brave and OpenRouter
 * outside any organization, authority or budget. Paid research now runs only through the governed
 * workspace research (provider gate). The route keeps answering, with an honest "unavailable".
 */
import type { Company, Source } from "@/lib/domain/types";

export class ResearchUnavailableError extends Error {}

export async function researchCompany(name: string): Promise<{ company: Company; sources: Source[] }> {
  void name;
  throw new ResearchUnavailableError("Live demo research is retired. Company research runs in a workspace, under its governed budget.");
}
