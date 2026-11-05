/**
 * Paid provider transports (Phase 17A): the only code that talks to OpenRouter and Brave over HTTP.
 * Each transport consumes a permit from the provider gate first, so a call that did not pass the gate
 * (authority, entitlement, kill switch, model policy, budget reservation) cannot leave ORQO.
 * Tests replace the transports with fakes through the gate; they never reach a real provider.
 */
import "server-only";
import type { z } from "zod";
import { structuredCompletion, type ChatMessage, type CompletionUsage } from "../ai/openrouter";
import { serverConfig } from "../config";
import { observe } from "../observability";
import type { SearchHit } from "../research/providers";
import { consumePermit, type ProviderPermit } from "./permit";

export interface OpenRouterRequest<S extends z.ZodType> {
  name: string;
  schema: S;
  messages: ChatMessage[];
  model: string;
  maxPrice: { prompt: number; completion: number };
  maxTokens: number;
  timeoutMs: number;
}

export interface BraveRequest {
  query: string;
  count: number;
  timeoutMs: number;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly usage: CompletionUsage | null,
    readonly model: string | null = null,
  ) {
    super(message);
  }
}

export interface ProviderTransports {
  openrouter<S extends z.ZodType>(permit: ProviderPermit, req: OpenRouterRequest<S>): Promise<{ data: z.infer<S>; model: string; usage: CompletionUsage | null }>;
  brave(permit: ProviderPermit, req: BraveRequest): Promise<{ hits: SearchHit[] }>;
}

/** Exported for the normalization test only; it still refuses without a permit. */
export async function braveHttp(permit: ProviderPermit, req: BraveRequest, key: string | undefined, fetchImpl: typeof fetch = fetch): Promise<{ hits: SearchHit[] }> {
  consumePermit(permit, "brave");
  if (!key) throw new TransportError("Brave is not configured.", null);
  return observe({ operation: "provider.call", provider: "brave" }, async () => {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(req.query.slice(0, 300))}&count=${Math.min(Math.max(req.count, 1), 20)}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { accept: "application/json", "x-subscription-token": key }, signal: AbortSignal.timeout(req.timeoutMs) });
    } catch {
      throw new TransportError("Brave request failed.", null);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new TransportError(`Brave HTTP ${res.status}`, null);
    }
    const body = (await res.json().catch(() => ({}))) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    const hits = (body.web?.results ?? [])
      .filter((r): r is { title: string; url: string; description: string } => Boolean(r.title && r.url && r.description && /^https?:\/\//i.test(r.url)))
      .map((r) => ({ title: r.title.replace(/<[^>]+>/g, "").slice(0, 300), url: r.url, snippet: r.description.replace(/<[^>]+>/g, "").slice(0, 500) }));
    return { hits };
  });
}

export const REAL_TRANSPORTS: ProviderTransports = {
  openrouter: (permit, req) => structuredCompletion(permit, req),
  brave: (permit, req) => braveHttp(permit, req, serverConfig().brave.apiKey),
};
