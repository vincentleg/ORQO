import { requireAuth } from "@/lib/server/auth/context";
import { agentRefusal, outcomeBody } from "@/lib/server/agents/http";
import { acceptMission, MissionRequest } from "@/lib/server/agents/service";
import { assertSameOriginJson, readJson } from "@/lib/server/http";
import { getRequestLocale } from "@/lib/server/i18n";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/agents/missions">;

/**
 * POST /api/v1/organizations/:org/agents/missions — assign a structured
 * mission to an agent and run it.
 *
 * Refusals (JSON, before anything executes): same-origin JSON, authentication,
 * membership, role, authoritative plan or operator preview, agent status,
 * mission contract, autonomy range, then the atomic idempotency + concurrency
 * + quota guard. An accepted mission streams NDJSON: `accepted`, one `step`
 * per real step transition, then `done`. A repeated idempotency key returns
 * the existing run without executing anything.
 */
export async function POST(request: Request, ctx: Ctx) {
  let accepted: Awaited<ReturnType<typeof acceptMission>>;
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const body = await readJson(request, MissionRequest, 8192);
    accepted = await acceptMission(db, user.id, organizationId, body, await getRequestLocale());
  } catch (e) {
    return agentRefusal(e, "POST agent mission");
  }

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
      send({ type: "accepted", ...accepted.accepted });
      try {
        const outcome = await accepted.execute((s) => send({ type: "step", ...s }));
        send({ type: "done", ...(outcome ? outcomeBody(outcome) : { status: "reused" }) });
      } catch (e) {
        console.error("[orqo] agent mission stream failed", accepted.accepted.runId, e instanceof Error ? e.name : typeof e);
        send({ type: "done", status: "failed", error: "internal" });
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
