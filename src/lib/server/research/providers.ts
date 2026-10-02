/**
 * Provider abstraction for the Web Research Layer. Business logic depends on
 * these interfaces only; vendors are adapters that can be swapped or added
 * (Exa, Firecrawl… later) without touching the research service.
 *
 * Phase 17A: the only implementations are the GOVERNED providers built by the provider gate
 * (src/lib/server/governance/provider-gate.ts), which authorize, reserve and settle every paid call.
 * Official-site retrieval needs no vendor (see fetcher.ts).
 */
import type { z } from "zod";
import type { ModelTask } from "./config";
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
