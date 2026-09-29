import { AIUnavailableError } from "@/lib/server/ai/openrouter";
import { ResearchUnavailableError, researchCompany } from "@/lib/server/research/brave";

export const dynamic = "force-dynamic";

/** GET /api/research?company=Name → structured Company with cited web sources. */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("company")?.trim();
  if (!name || name.length > 120) return Response.json({ error: "Expected ?company=<name>" }, { status: 400 });
  try {
    return Response.json(await researchCompany(name));
  } catch (e) {
    if (e instanceof ResearchUnavailableError || e instanceof AIUnavailableError) return Response.json({ error: e.message }, { status: 503 });
    console.error("[orqo] research failed", e);
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 160) : "Research failed" }, { status: 502 });
  }
}
