import "server-only";
/**
 * Candidate sources (Phase 5) — provider-independent. A source returns
 * minimal candidate records (name, URL, discovery hint); it never produces
 * evidence. Qualification only ever uses verified, retrieved company sources.
 *
 * Implemented:
 * - workspace knowledge: this workspace's stored analyses and Network (internal, no cost, NOT live web discovery);
 * - web search: the Phase 3 WebSearchProvider abstraction (Brave adapter). Paid; used only when configured,
 *   entitled and approved. Exa is NOT integrated: no adapter is faked.
 *
 * Web-search policy (checked BEFORE any approval or provider call):
 *   authoritative plan includes paid search (search.deepResearch), or the operator's paid-research preview list
 *   (ORQO_RESEARCH_PREVIEW_ORGS) — agent preview alone never grants paid spend; then a provider must be configured.
 */
import type { RawCandidate } from "@/lib/discovery/candidates";
import { DISCOVERY_LIMITS } from "@/lib/discovery/types";
import { mayUsePaidProviders } from "@/lib/governance/entitlement";
import { resolveEntitlement } from "@/lib/server/governance/entitlement";
import { governedSearchProvider, paidProvidersConfigured, type GovernedCallContext } from "@/lib/server/governance/provider-gate";
import { ProviderCallError, type WebSearchProvider } from "@/lib/server/research/providers";
import type { ProviderUsage } from "@/lib/server/research/types";

export interface CandidateSourceResult {
  candidates: RawCandidate[];
  usage: ProviderUsage[];
}

export interface CandidateSource {
  readonly id: "web_search";
  /** Vendor id (e.g. "brave"). */
  readonly provider: string;
  find(queries: readonly string[]): Promise<CandidateSourceResult>;
}

/** Wraps any WebSearchProvider. Failed queries are skipped (their usage is still recorded); nothing is invented. */
export function webSearchCandidateSource(provider: WebSearchProvider, opts: { perQuery?: number; timeoutMs?: number } = {}): CandidateSource {
  return {
    id: "web_search",
    provider: provider.id,
    async find(queries) {
      const candidates: RawCandidate[] = [];
      const usage: ProviderUsage[] = [];
      for (const q of queries.slice(0, DISCOVERY_LIMITS.maxQueries)) {
        try {
          const r = await provider.search(q, { count: opts.perQuery ?? DISCOVERY_LIMITS.resultsPerQuery, timeoutMs: opts.timeoutMs ?? 8_000 });
          usage.push(r.usage);
          for (const h of r.hits) candidates.push({ name: h.title, url: h.url, hint: h.snippet, source: "web_search" });
        } catch (e) {
          if (e instanceof ProviderCallError) usage.push(e.usage);
          else throw e;
        }
      }
      return { candidates, usage };
    },
  };
}

/** The configured web candidate source, or null (never faked). */
/** Paid web search for an agent run, through the provider gate (authority, budget, reservation). Null when unconfigured. */
export function configuredWebCandidateSource(ctx: GovernedCallContext): CandidateSource | null {
  return paidProvidersConfigured("brave") ? webSearchCandidateSource(governedSearchProvider(ctx, ctx.agentRunId ?? ctx.researchRunId ?? "discovery")) : null;
}

/** Whether the workspace may spend on paid web search. Server-side only; the browser's plan is never used. */
export async function webSearchEntitled(organizationId: string): Promise<boolean> {
  // Phase 17A: paid search needs a paid plan or Internal, and a configured money ceiling.
  return mayUsePaidProviders(await resolveEntitlement(organizationId));
}

/** What the Discover UI may offer for the web source. Presentation only — the tool precheck decides. */
export async function webSourceAvailability(organizationId: string): Promise<"available" | "not_entitled" | "not_configured"> {
  if (!(await webSearchEntitled(organizationId))) return "not_entitled";
  return paidProvidersConfigured("brave") ? "available" : "not_configured";
}
