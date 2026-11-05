/**
 * The provider gate (Phase 17A): the ONLY way to invoke a paid provider (OpenRouter, Brave).
 *
 * Before a request can leave ORQO, in this order:
 *   authority present → same organization and user → kill switch → entitlement (paid or Internal, with a
 *   configured ceiling) → provider and task inside the authority → network inside the authority →
 *   model policy → credentials configured → spend RESERVED (worst case, organization lock, rolling ceiling,
 *   run caps) → permit issued → transport.
 * After the call: settle (reported cost, or the full reservation when unknown), record usage linked to the
 * reservation. One fallback model at most, with its own reservation. Violations trip a wire (deny + audit).
 *
 * Models, prompts, tool results and web pages never reach any of these decisions.
 */
import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { ModelTask } from "@/lib/agents/types";
import { networkAllows, type AuthorityContract, type Provider } from "@/lib/governance/authority";
import { mayUsePaidProviders } from "@/lib/governance/entitlement";
import { BRAVE_QUERY_RESERVATION_USD, selectModel, type ModelAttempt } from "@/lib/governance/model-policy";
import { TripwireError, type Tripwire } from "@/lib/governance/tripwire";
import { AppError } from "@/lib/server/errors";
import { paidProvidersKilled, serverConfig } from "@/lib/server/config";
import { resolveEntitlement } from "@/lib/server/governance/entitlement";
import { recordOperation } from "@/lib/server/observability";
import { recordUsage } from "@/lib/server/research/repository";
import { ProviderCallError, type ModelMessage, type ModelProvider, type SearchHit, type WebSearchProvider } from "@/lib/server/research/providers";
import type { ModelTask as ResearchTask } from "@/lib/server/research/config";
import type { ProviderUsage } from "@/lib/server/research/types";
import type { Db } from "@/lib/server/supabase/types";
import { recordTripwire, ReservationRefused, reserveSpend, settleSpend } from "./ledger";
import { issuePermit, PermitError } from "./permit";
import { AIUnavailableError } from "../ai/openrouter";
import { REAL_TRANSPORTS, TransportError, type ProviderTransports } from "./transports";

export interface GovernedCallContext {
  db: Db;
  /** Server-validated: the caller is a member of this organization. */
  organizationId: string;
  userId: string;
  /** Frozen authority of the run, or the server-built authority of a direct research run. */
  authority: AuthorityContract | null;
  agentRunId: string | null;
  researchRunId: string | null;
}

export type ProviderDenial = "kill_switch" | "not_entitled" | "not_configured" | "no_model" | "budget_exhausted";

/** A paid call refused before any provider was reached (not a security violation). */
export class ProviderDeniedError extends AppError {
  constructor(readonly denial: ProviderDenial) {
    super(denial === "budget_exhausted" ? "rate_limited" : denial === "not_entitled" ? "forbidden" : "unavailable", `Paid provider refused: ${denial}.`);
  }
}

let transports: ProviderTransports = REAL_TRANSPORTS;
/** Tests only: replace the transports with fakes (returns a restore function). Refused outside tests. */
export function setTransportsForTests(next: ProviderTransports): () => void {
  if (process.env.NODE_ENV !== "test") throw new Error("Transports can only be replaced in tests.");
  const prev = transports;
  transports = next;
  return () => {
    transports = prev;
  };
}

/** Deterministic idempotency key (a UUID) for one logical call: retries of the same call never reserve twice. */
export function callKey(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function trip(ctx: GovernedCallContext, tripwire: Tripwire, detail: string): Promise<never> {
  recordOperation({ operation: "governance.tripwire", outcome: "denied", errorCategory: tripwire, organizationId: ctx.organizationId, runId: ctx.agentRunId, durationMs: 0 });
  // Audit in the organization the server validated for this caller (never one named by the request).
  await recordTripwire(ctx.db, ctx.organizationId, tripwire, ctx.agentRunId, detail);
  throw new TripwireError(tripwire, detail);
}

function credentialsFor(provider: Provider): boolean {
  const c = serverConfig();
  return provider === "brave" ? Boolean(c.brave.apiKey) : Boolean(c.openrouter.apiKey && c.openrouter.enabled);
}

/** Every check that must pass before a reservation. Returns the ceiling to reserve against. */
async function authorize(ctx: GovernedCallContext, provider: Provider, task: string): Promise<number> {
  const a = ctx.authority;
  if (!a) return trip(ctx, "missing_authority", `${provider}:${task}`);
  // An agent run's call must carry THAT run's authority (never an authority without a run, or another run's).
  // A run-bound authority (loaded and verified by the server for this run) belongs to the run's creator and may be
  // executed by another member of the same organization, e.g. the admin who approved it. Any other authority
  // must belong to the caller.
  const runBound = ctx.agentRunId !== null && a.runId === ctx.agentRunId;
  if (a.organizationId !== ctx.organizationId || (ctx.agentRunId !== null && a.runId !== ctx.agentRunId) || (!runBound && a.userId !== ctx.userId)) return trip(ctx, "cross_organization", `${provider}:${task}`);
  if (paidProvidersKilled()) throw new ProviderDeniedError("kill_switch");
  const e = await resolveEntitlement(ctx.organizationId);
  if (!mayUsePaidProviders(e) || e.budgetUsd === null) throw new ProviderDeniedError("not_entitled");
  if (provider === "brave" && !a.providers.brave) return trip(ctx, "provider_outside_authority", `brave:${task}`);
  if (provider === "openrouter" && !(a.providers.openrouter && a.providers.openrouter.tasks.includes(task as ModelTask))) return trip(ctx, "provider_outside_authority", `openrouter:${task}`);
  if (provider === "brave" && !networkAllows(a.network, "public_search")) return trip(ctx, "unauthorized_network", "public_search");
  if (a.limits.maxCostUsd <= 0) return trip(ctx, "cost_limit", "no_money_in_authority");
  if (!credentialsFor(provider)) throw new ProviderDeniedError("not_configured");
  return e.budgetUsd;
}

async function reserve(ctx: GovernedCallContext, provider: Provider, task: string, model: string | null, amountUsd: number, ceilingUsd: number, key: string): Promise<string> {
  try {
    return await reserveSpend(ctx.db, { organizationId: ctx.organizationId, agentRunId: ctx.agentRunId, researchRunId: ctx.researchRunId, provider, task, model, amountUsd, ceilingUsd, idempotencyKey: key });
  } catch (e) {
    if (!(e instanceof ReservationRefused)) throw e;
    if (e.refusal === "ceiling") throw new ProviderDeniedError("budget_exhausted");
    if (e.refusal === "run_cost") return trip(ctx, "cost_limit", `${provider}:${task}`);
    if (e.refusal === "run_calls") return trip(ctx, "provider_call_limit", `${provider}:${task}`);
    if (e.refusal === "outside_authority") return trip(ctx, "provider_outside_authority", `${provider}:${task}`);
    // The same logical call was already reserved (retry, double submit): never send it twice.
    if (e.refusal === "duplicate") throw new AppError("conflict", "This provider call was already made.");
    throw new ProviderDeniedError("no_model");
  }
}

async function settle(ctx: GovernedCallContext, reservationId: string, outcome: "succeeded" | "failed" | "not_sent", costUsd: number | null): Promise<void> {
  // A settlement failure leaves the reservation counted in full: conservative, never under-counted.
  await settleSpend(ctx.db, ctx.organizationId, reservationId, outcome, costUsd).catch((e) => console.error("[orqo] spend settlement failed", e instanceof Error ? e.name : typeof e));
}

async function usage(ctx: GovernedCallContext, u: ProviderUsage, reservationId: string, durationMs: number): Promise<void> {
  await recordUsage(ctx.db, ctx.organizationId, ctx.researchRunId, u, ctx.agentRunId, { reservationId, durationMs }).catch((e) => console.error("[orqo] usage record failed", e instanceof Error ? e.name : typeof e));
}

const RESEARCH_TO_AGENT_TASK: Record<ResearchTask, ModelTask> = { extraction: "extraction", reasoning: "business_reasoning" };

/** One governed structured model call (one bounded fallback). */
export async function governedModelCall<S extends z.ZodType>(
  ctx: GovernedCallContext,
  req: { task: ModelTask; name: string; schema: S; messages: ModelMessage[]; timeoutMs: number; idempotencyKey: string },
): Promise<{ data: z.infer<S>; usage: ProviderUsage }> {
  const ceiling = await authorize(ctx, "openrouter", req.task);
  const selection = selectModel(req.task, { maxTier: ctx.authority!.providers.openrouter!.maxTier, env: process.env });
  if (!selection) throw new ProviderDeniedError("no_model");
  const attempts: ModelAttempt[] = [selection.primary, ...(selection.fallback ? [selection.fallback] : [])];
  let lastError: ProviderCallError | null = null;
  for (const [i, attempt] of attempts.entries()) {
    const key = callKey(`${req.idempotencyKey}:${i}`);
    const reservationId = await reserve(ctx, "openrouter", req.task, attempt.model, attempt.reservationUsd, ceiling, key);
    // Re-checked after the reservation: a kill switch flipped meanwhile still stops the call.
    if (paidProvidersKilled()) {
      await settle(ctx, reservationId, "not_sent", 0);
      throw new ProviderDeniedError("kill_switch");
    }
    const t0 = Date.now();
    try {
      const r = await transports.openrouter(issuePermit("openrouter", reservationId), { name: req.name, schema: req.schema, messages: req.messages, model: attempt.model, maxPrice: attempt.maxPrice, maxTokens: attempt.maxOutputTokens, timeoutMs: req.timeoutMs });
      const u = modelUsage(req.task, true, r.model, r.usage);
      await settle(ctx, reservationId, "succeeded", r.usage?.costUsd ?? null);
      await usage(ctx, u, reservationId, Date.now() - t0);
      return { data: r.data, usage: u };
    } catch (e) {
      // Not a provider failure: the request never left ORQO (configuration vanished, or an invalid permit).
      // Release the reservation and stop; no fallback is attempted.
      if (e instanceof AIUnavailableError || e instanceof PermitError) {
        await settle(ctx, reservationId, "not_sent", 0);
        throw new ProviderDeniedError("not_configured");
      }
      const tu = e instanceof TransportError || (e && typeof e === "object" && "usage" in e) ? ((e as { usage: { promptTokens: number | null; completionTokens: number | null; costUsd: number | null } | null }).usage ?? null) : null;
      const u = modelUsage(req.task, false, attempt.model, tu);
      await settle(ctx, reservationId, "failed", tu?.costUsd ?? null);
      await usage(ctx, u, reservationId, Date.now() - t0);
      lastError = new ProviderCallError("Model call failed.", u);
    }
  }
  throw lastError ?? new ProviderDeniedError("no_model");
}

function modelUsage(task: ModelTask, succeeded: boolean, model: string, u: { promptTokens: number | null; completionTokens: number | null; costUsd: number | null } | null): ProviderUsage {
  return {
    provider: "openrouter",
    service: model.slice(0, 120),
    operation: task === "extraction" ? "extraction" : "reasoning",
    succeeded,
    units: Object.fromEntries(Object.entries({ promptTokens: u?.promptTokens, completionTokens: u?.completionTokens }).filter((e): e is [string, number] => typeof e[1] === "number")),
    costUsd: u?.costUsd ?? null,
  };
}

/** One governed web search query. Brave reports no cost: the reservation is kept in full. */
export async function governedSearch(ctx: GovernedCallContext, req: { query: string; count: number; timeoutMs: number; idempotencyKey: string }): Promise<{ hits: SearchHit[]; usage: ProviderUsage }> {
  const ceiling = await authorize(ctx, "brave", "web_search");
  const reservationId = await reserve(ctx, "brave", "web_search", null, BRAVE_QUERY_RESERVATION_USD, ceiling, callKey(req.idempotencyKey));
  if (paidProvidersKilled()) {
    await settle(ctx, reservationId, "not_sent", 0);
    throw new ProviderDeniedError("kill_switch");
  }
  const t0 = Date.now();
  const u = (succeeded: boolean, results = 0): ProviderUsage => ({ provider: "brave", service: "web/search", operation: "web_search", succeeded, units: { queries: 1, results }, costUsd: null });
  try {
    const r = await transports.brave(issuePermit("brave", reservationId), { query: req.query, count: req.count, timeoutMs: req.timeoutMs });
    await settle(ctx, reservationId, "succeeded", null);
    await usage(ctx, u(true, r.hits.length), reservationId, Date.now() - t0);
    return { hits: r.hits, usage: u(true, r.hits.length) };
  } catch {
    await settle(ctx, reservationId, "failed", null);
    await usage(ctx, u(false), reservationId, Date.now() - t0);
    throw new ProviderCallError("Web search failed.", u(false));
  }
}

/** The research layer's model provider, governed. Each call gets a deterministic idempotency key. */
export function governedModelProvider(ctx: GovernedCallContext, seed: string): ModelProvider {
  let n = 0;
  return {
    id: "openrouter",
    complete: ({ task, name, schema, messages, timeoutMs }) => governedModelCall(ctx, { task: RESEARCH_TO_AGENT_TASK[task], name, schema, messages, timeoutMs, idempotencyKey: `${seed}:model:${n++}` }),
  };
}

/** The research and discovery layers' web search provider, governed. */
export function governedSearchProvider(ctx: GovernedCallContext, seed: string): WebSearchProvider {
  let n = 0;
  return { id: "brave", search: (query, { count, timeoutMs }) => governedSearch(ctx, { query, count, timeoutMs, idempotencyKey: `${seed}:search:${n++}` }) };
}

/** Whether paid providers could be reached at all on this deployment (presentation and prechecks only). */
export function paidProvidersConfigured(provider: Provider): boolean {
  return !paidProvidersKilled() && credentialsFor(provider);
}
