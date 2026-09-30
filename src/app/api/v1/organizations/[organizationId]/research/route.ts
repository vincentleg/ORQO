import { z } from "zod";
import { findKnownCompany, parseSearchQuery, websiteDomain } from "@/lib/search/query";
import { requireAuth } from "@/lib/server/auth/context";
import { AppError } from "@/lib/server/errors";
import { assertSameOriginJson, json, readJson, toErrorResponse } from "@/lib/server/http";
import { getOwnCompanyProfile, listCompanies, toOwnContext } from "@/lib/server/repositories/companies";
import { cacheStatus, RESEARCH_LIMITS } from "@/lib/server/research/config";
import { createPageFetcher } from "@/lib/server/research/fetcher";
import { authorizeResearch, ResearchDeniedError } from "@/lib/server/research/policy";
import { configuredProviders } from "@/lib/server/research/providers";
import { findIntelligence, finishRun, recordUsage, RunRefusedError, saveIntelligence, setRunStage, startResearchRun } from "@/lib/server/research/repository";
import { runCompanyResearch, type ResearchDeps, type ResearchInput } from "@/lib/server/research/service";
import { RESEARCH_MODES, ResearchError, type ResearchErrorCode } from "@/lib/server/research/types";
import { getRequestLocale } from "@/lib/server/i18n";
import type { Db } from "@/lib/server/supabase/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/research">;

const Body = z.object({
  query: z.string().trim().min(1).max(200),
  mode: z.enum(RESEARCH_MODES).default("basic"),
  refresh: z.boolean().default(false),
});

function refusal(e: unknown): Response {
  if (e instanceof ResearchDeniedError) return json({ error: { code: e.code, reason: e.reason, requiredPlan: e.requiredPlan, message: e.message } }, e.status);
  if (e instanceof RunRefusedError) return json({ error: { code: e.code, reason: e.reason, message: e.message } }, e.status);
  return toErrorResponse(e, "POST research");
}

/**
 * POST /api/v1/organizations/:org/research — analyze a company for this workspace.
 *
 * Every check happens before any provider is reached: same-origin JSON,
 * authentication, membership (member+), entitlement for the mode, provider
 * configuration, cache reuse, then the atomic quota/concurrency guard. The
 * response is an NDJSON stream of the run's real stages, ending in `done` or
 * `error`; results are persisted and read back by the Search page.
 */
export async function POST(request: Request, ctx: Ctx) {
  let prepared: { db: Db; organizationId: string; runId: string; input: ResearchInput };
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId: requested } = await ctx.params;
    const body = await readJson(request, Body, 4096);
    const target = parseSearchQuery(body.query);
    if (!target) throw new AppError("invalid_input", "Enter a company name or website.");
    const { organizationId } = await authorizeResearch(db, user.id, requested, body.mode);

    const companies = await listCompanies(db, organizationId);
    const known = findKnownCompany(target, companies.filter((c) => !c.is_own_company));
    const knownWebsite = known?.website ?? null;
    const domainKey = target.kind === "website" ? target.domain : knownWebsite ? websiteDomain(knownWebsite) : null;

    const cached = await findIntelligence(db, organizationId, domainKey ? { domain: domainKey } : { name: target.kind === "name" ? target.name : null });
    if (cached) {
      const cache = cacheStatus(cached.researchedAt);
      const sufficient = cached.mode === "deep" || body.mode === "basic";
      if (!body.refresh && sufficient && !cache.stale) return json({ status: "cached", domain: cached.profile.domain });
      if (body.refresh && sufficient && !cache.canRefresh) {
        return json({ error: { code: "conflict", reason: "refresh_too_soon", message: "This analysis was refreshed recently." } }, 409);
      }
    }

    const ownRow = await getOwnCompanyProfile(db, organizationId);
    const runId = await startResearchRun(db, organizationId, body.mode, body.query, domainKey);
    prepared = { db, organizationId, runId, input: { target, knownWebsite, mode: body.mode, own: ownRow ? toOwnContext(ownRow) : null, locale: await getRequestLocale() } };
  } catch (e) {
    return refusal(e);
  }

  const { db, organizationId, runId, input } = prepared;
  const mode = input.mode;
  // Basic research gets NO paid providers, by construction.
  const providers = mode === "deep" ? configuredProviders() : { search: null, model: null };
  const deps: ResearchDeps = {
    fetcher: createPageFetcher({ limits: RESEARCH_LIMITS[mode] }),
    ...providers,
    onUsage: (u) => recordUsage(db, organizationId, runId, u).catch((e) => console.error("[orqo] usage record failed", e instanceof Error ? e.message.slice(0, 200) : typeof e)),
  };

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
        const out = await runCompanyResearch(deps, input, async (stage) => {
          send({ type: "stage", stage });
          await setRunStage(db, organizationId, runId, stage).catch(() => undefined);
        });
        await saveIntelligence(db, organizationId, runId, mode, out.profile, out.hypotheses);
        await finishRun(db, organizationId, runId, { ok: true, domain: out.profile.domain, counters: { ...out.counters, warnings: out.warnings } });
        send({ type: "stage", stage: "complete" });
        send({ type: "done", domain: out.profile.domain, summary: out.summary });
      } catch (e) {
        const code: ResearchErrorCode | "internal" = e instanceof ResearchError ? e.code : "internal";
        if (code === "internal") console.error("[orqo] research run failed", runId, e instanceof Error ? `${e.name}: ${e.message.slice(0, 300)}` : typeof e);
        await finishRun(db, organizationId, runId, { ok: false, errorCode: code }).catch(() => undefined);
        send({ type: "error", code: code === "internal" ? "analysis_failed" : code, candidates: e instanceof ResearchError ? e.candidates : [] });
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
