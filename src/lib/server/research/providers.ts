/**
 * Provider abstraction for the Web Research Layer. Business logic depends on
 * these interfaces only; vendors are adapters that can be swapped or added
 * (Exa, Firecrawl… later) without touching the research service.
 *
 * Implemented adapters: Brave Search (web search) and OpenRouter (models).
 * Official-site retrieval needs no vendor (see fetcher.ts).
 */
import type { z } from "zod";
import { CompletionError, structuredCompletion } from "../ai/openrouter";
import { serverConfig } from "../config";
import { modelFor, type ModelTask } from "./config";
import type { ProviderUsage } from "./types";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  readonly id: string;
  search(query: string, opts: { count: number; timeoutMs: number }): Promise<{ hits: SearchHit[]; usage: ProviderUsage }>;
}

export interface ModelMessage {
  role: "system" | "user";
  content: string;
}

export interface ModelProvider {
  readonly id: string;
  complete<S extends z.ZodType>(opts: { task: ModelTask; name: string; schema: S; messages: ModelMessage[]; maxTokens: number; timeoutMs: number }): Promise<{ data: z.infer<S>; usage: ProviderUsage }>;
}

/** A provider call that failed after it may have consumed paid units. */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly usage: ProviderUsage,
  ) {
    super(message);
  }
}

export function braveSearchProvider(apiKey: string, fetchImpl: typeof fetch = fetch): WebSearchProvider {
  return {
    id: "brave",
    async search(query, { count, timeoutMs }) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query.slice(0, 300))}&count=${Math.min(Math.max(count, 1), 20)}`;
      const usage = (succeeded: boolean, results = 0): ProviderUsage => ({ provider: "brave", service: "web/search", operation: "web_search", succeeded, units: { queries: 1, results }, costUsd: null });
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { accept: "application/json", "x-subscription-token": apiKey }, signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new ProviderCallError("Brave request failed.", usage(false));
      }
      if (!res.ok) throw new ProviderCallError(`Brave ${res.status}`, usage(false));
      const body = (await res.json().catch(() => ({}))) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      const hits = (body.web?.results ?? [])
        .filter((r): r is { title: string; url: string; description: string } => Boolean(r.title && r.url && r.description && /^https?:\/\//i.test(r.url)))
        .map((r) => ({ title: r.title.replace(/<[^>]+>/g, "").slice(0, 300), url: r.url, snippet: r.description.replace(/<[^>]+>/g, "").slice(0, 500) }));
      return { hits, usage: usage(true, hits.length) };
    },
  };
}

export function openRouterModelProvider(): ModelProvider {
  return {
    id: "openrouter",
    async complete({ task, name, schema, messages, maxTokens, timeoutMs }) {
      const model = modelFor(task);
      const toUsage = (succeeded: boolean, m: string, u: { promptTokens: number | null; completionTokens: number | null; costUsd: number | null } | null): ProviderUsage => ({
        provider: "openrouter",
        service: m.slice(0, 120),
        operation: task,
        succeeded,
        units: Object.fromEntries(Object.entries({ promptTokens: u?.promptTokens, completionTokens: u?.completionTokens }).filter((e): e is [string, number] => typeof e[1] === "number")),
        costUsd: u?.costUsd ?? null,
      });
      try {
        const r = await structuredCompletion({ name, schema, messages, model, maxTokens, timeoutMs });
        return { data: r.data, usage: toUsage(true, r.model, r.usage) };
      } catch (e) {
        if (e instanceof CompletionError) throw new ProviderCallError(e.message, toUsage(false, e.model, e.usage));
        throw new ProviderCallError("Model call failed.", toUsage(false, model, null));
      }
    },
  };
}

/** Configured providers, or null when credentials are absent (never faked). */
export function configuredProviders(): { search: WebSearchProvider | null; model: ModelProvider | null } {
  const cfg = serverConfig();
  return {
    search: cfg.brave.apiKey ? braveSearchProvider(cfg.brave.apiKey) : null,
    model: cfg.openrouter.apiKey && cfg.openrouter.enabled ? openRouterModelProvider() : null,
  };
}
