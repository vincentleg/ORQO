import { z } from "zod";
import { requireAuth } from "@/lib/server/auth/context";
import { assertSameOriginJson, json, readJson, recordDenial, toErrorResponse } from "@/lib/server/http";
import { prepareResearch, runPreparedResearch, type PreparedResearch } from "@/lib/server/research/execute";
import { ResearchDeniedError } from "@/lib/server/research/policy";
import { RunRefusedError } from "@/lib/server/research/repository";
import { RESEARCH_MODES, ResearchError } from "@/lib/server/research/types";
import { getRequestLocale } from "@/lib/server/i18n";
import { AppError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/research">;

const Body = z.object({
  query: z.string().trim().min(1).max(200),
  mode: z.enum(RESEARCH_MODES).default("basic"),
  refresh: z.boolean().default(false),
});

function refusal(e: unknown): Response {
  if (e instanceof ResearchDeniedError || e instanceof RunRefusedError) recordDenial(e, "POST research");
  if (e instanceof ResearchDeniedError) return json({ error: { code: e.code, reason: e.reason, requiredPlan: e.requiredPlan, message: e.message } }, e.status);
  if (e instanceof RunRefusedError) return json({ error: { code: e.code, reason: e.reason, message: e.message } }, e.status);
  if (e instanceof AppError && e.code === "conflict") return json({ error: { code: "conflict", reason: "refresh_too_soon", message: e.message } }, 409);
  return toErrorResponse(e, "POST research");
}

/**
 * POST /api/v1/organizations/:org/research — analyze a company for this workspace.
 *
 * Every check happens before any provider is reached (prepareResearch):
 * same-origin JSON, authentication, membership (member+), entitlement for the
 * mode, provider configuration, cache reuse, then the atomic quota/concurrency
 * guard. The response is an NDJSON stream of the run's real stages, ending in
 * `done` or `error`; results are persisted and read back by the Search page.
 */
export async function POST(request: Request, ctx: Ctx) {
  let prepared: PreparedResearch;
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const body = await readJson(request, Body, 4096);
    prepared = await prepareResearch(db, user.id, organizationId, { ...body, locale: await getRequestLocale() });
  } catch (e) {
    return refusal(e);
  }
  if (prepared.kind === "cached") return json({ status: "cached", domain: prepared.domain });
  const run = prepared;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client went away; the run still finishes and is persisted.
        }
      };
      try {
        const out = await runPreparedResearch(run, (stage) => send({ type: "stage", stage }));
        send({ type: "done", domain: out.domain, summary: out.summary });
      } catch (e) {
        const re = e instanceof ResearchError ? e : new ResearchError("analysis_failed", "Analysis failed.");
        send({ type: "error", code: re.code, candidates: re.candidates });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "private, no-store", "x-accel-buffering": "no" } });
}
