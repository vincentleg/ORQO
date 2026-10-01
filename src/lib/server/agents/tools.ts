/**
 * Server-side tool implementations, keyed by the Tool Registry ids
 * (src/lib/agents/tools.ts). Each tool has a strict input and output schema;
 * the orchestrator validates both around every call, so a malformed output
 * can never become run state.
 *
 * Tools do not duplicate Phase 3 logic: research tools call the governed
 * research entry point (prepare → run, with its own authorization, quota,
 * SSRF protection and hard limits); evaluation calls analyzeRelevance (rules +
 * critic). Every database read is scoped to the run's organization under RLS.
 */
import { z } from "zod";
import type { ToolId } from "@/lib/agents/types";
import type { Locale } from "@/lib/i18n/config";
import { analyzeRelevance } from "@/lib/intelligence/relevance";
import { ModelHypothesisSchema, RELATIONSHIP_TYPES, TargetProfileSchema, type OwnCompanyContext } from "@/lib/intelligence/types";
import { AppError } from "@/lib/server/errors";
import { getCompany, getOwnCompanyProfile, toOwnContext } from "@/lib/server/repositories/companies";
import type { PreparedResearch, ResearchCompletion, ResearchRequest } from "@/lib/server/research/execute";
import { findIntelligence } from "@/lib/server/research/repository";
import { ResearchError, type ProviderUsage } from "@/lib/server/research/types";
import type { Db } from "@/lib/server/supabase/types";

/** The governed research entry point, injected so tests never reach the network. */
export interface ResearchGateway {
  /** The Phase 3 authorization for a mode (member+, entitlement, providers), without starting anything. */
  authorize(db: Db, userId: string, organizationId: string, mode: "basic" | "deep"): Promise<unknown>;
  prepare(db: Db, userId: string, organizationId: string, req: ResearchRequest): Promise<PreparedResearch>;
  run(p: Extract<PreparedResearch, { kind: "run" }>): Promise<ResearchCompletion>;
}

export interface ToolEnv {
  db: Db;
  organizationId: string;
  userId: string;
  locale: Locale;
  agentRunId: string;
  research: ResearchGateway | null;
}

/** A tool failure with a safe code (never a stack trace or provider message). */
export class ToolError extends Error {
  constructor(
    readonly code: "research_refused" | "research_failed" | "unavailable",
    readonly detail: string,
  ) {
    super(`${code}:${detail}`);
  }
}

export interface ToolImpl<I = unknown, O = unknown> {
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  run(env: ToolEnv, input: I): Promise<O>;
  /** Policy checks that must pass BEFORE an approval is requested (never ask a human to approve something policy refuses). */
  precheck?(env: ToolEnv, input: I): Promise<void>;
  /** Ids the call produced or used (stored on the tool-call ledger), and provider usage. */
  refs?(output: O): { researchRunId?: string | null; ref?: Record<string, string | number | boolean | null>; usage?: ProviderUsage[] };
}

export const OwnContextSchema: z.ZodType<OwnCompanyContext> = z.strictObject({
  name: z.string().max(200),
  website: z.string().max(500).nullable(),
  summary: z.string().max(4000),
  offerings: z.array(z.string().max(120)).max(30),
  customerSegments: z.array(z.string().max(120)).max(30),
  markets: z.array(z.string().max(120)).max(50),
  geographies: z.array(z.string().max(120)).max(50),
  soughtCapabilities: z.array(z.string().max(120)).max(30),
  partnershipGoals: z.array(z.enum(RELATIONSHIP_TYPES)).max(9),
});

export const StoredResearchSchema = z.strictObject({
  id: z.uuid(),
  mode: z.enum(["basic", "deep"]),
  researchedAt: z.string(),
  profile: TargetProfileSchema,
  hypotheses: z.array(ModelHypothesisSchema),
});
export type StoredResearch = z.infer<typeof StoredResearchSchema>;

const Domain = z.string().regex(/^[a-z0-9.-]{3,253}$/);

const ResearchToolOutput = z.strictObject({
  status: z.enum(["cached", "completed"]),
  domain: Domain,
  researchRunId: z.uuid().nullable(),
  usage: z.array(z.strictObject({ provider: z.string(), service: z.string(), operation: z.enum(["web_search", "extraction", "reasoning"]), succeeded: z.boolean(), units: z.record(z.string(), z.number()), costUsd: z.number().nullable() })),
});

const RelevanceOutput = z.strictObject({
  analysis: z.custom<ReturnType<typeof analyzeRelevance>>((v) => typeof v === "object" && v !== null && "status" in v && "opportunities" in v && "hypotheses" in v && "rejected" in v),
});

function researchTool(mode: "basic" | "deep"): ToolImpl<{ query: string; refresh: boolean }, z.infer<typeof ResearchToolOutput>> {
  return {
    input: z.strictObject({ query: z.string().trim().min(1).max(200), refresh: z.boolean() }),
    output: ResearchToolOutput,
    async precheck(env) {
      if (!env.research) throw new ToolError("unavailable", "research_unavailable");
      try {
        await env.research.authorize(env.db, env.userId, env.organizationId, mode);
      } catch (e) {
        const reason = (e as { reason?: unknown }).reason;
        if (e instanceof AppError) throw new ToolError("research_refused", typeof reason === "string" && /^[a-z_]{1,40}$/.test(reason) ? reason : e.code);
        throw e;
      }
    },
    async run(env, input) {
      if (!env.research) throw new ToolError("unavailable", "research_unavailable");
      let prepared: PreparedResearch;
      try {
        prepared = await env.research.prepare(env.db, env.userId, env.organizationId, { query: input.query, mode, refresh: input.refresh, locale: env.locale, agentRunId: env.agentRunId });
      } catch (e) {
        // Authorization, entitlement, provider configuration, quota, concurrency or refresh window refused it.
        const reason = (e as { reason?: unknown }).reason;
        if (e instanceof AppError) throw new ToolError("research_refused", typeof reason === "string" && /^[a-z_]{1,40}$/.test(reason) ? reason : e.code);
        throw e;
      }
      if (prepared.kind === "cached") return { status: "cached", domain: prepared.domain, researchRunId: null, usage: [] };
      try {
        const done = await env.research.run(prepared);
        return { status: "completed", domain: done.domain, researchRunId: done.runId, usage: done.usage };
      } catch (e) {
        throw new ToolError("research_failed", e instanceof ResearchError ? e.code : "analysis_failed");
      }
    },
    refs: (o) => ({ researchRunId: o.researchRunId, ref: { status: o.status, domain: o.domain }, usage: o.usage }),
  };
}

export const TOOL_IMPLEMENTATIONS: Record<ToolId, ToolImpl<never, unknown>> = {
  read_workspace_company: {
    input: z.strictObject({}),
    output: z.strictObject({ own: OwnContextSchema.nullable() }),
    async run(env) {
      const row = await getOwnCompanyProfile(env.db, env.organizationId);
      return { own: row ? toOwnContext(row) : null };
    },
  } satisfies ToolImpl<Record<string, never>, { own: OwnCompanyContext | null }>,
  read_network_company: {
    input: z.strictObject({ companyId: z.uuid() }),
    output: z.strictObject({ company: z.strictObject({ id: z.uuid(), name: z.string(), website: z.string().nullable() }).nullable() }),
    async run(env, input) {
      const c = await getCompany(env.db, env.organizationId, input.companyId);
      return { company: c && !c.is_own_company ? { id: c.id, name: c.name, website: c.website } : null };
    },
    refs: (o) => ({ ref: { companyId: o.company?.id ?? null } }),
  } satisfies ToolImpl<{ companyId: string }, { company: { id: string; name: string; website: string | null } | null }>,
  read_stored_research: {
    input: z.union([z.strictObject({ domain: Domain }), z.strictObject({ name: z.string().trim().min(1).max(200) })]),
    output: z.strictObject({ research: StoredResearchSchema.nullable() }),
    async run(env, input) {
      const found = await findIntelligence(env.db, env.organizationId, input);
      return { research: found };
    },
    refs: (o) => ({ ref: { intelligenceId: o.research?.id ?? null, mode: o.research?.mode ?? null } }),
  } satisfies ToolImpl<{ domain: string } | { name: string }, { research: StoredResearch | null }>,
  official_site_research: researchTool("basic"),
  deep_company_research: researchTool("deep"),
  evaluate_business_relevance: {
    input: z.strictObject({ own: OwnContextSchema.nullable(), profile: TargetProfileSchema, hypotheses: z.array(ModelHypothesisSchema) }),
    output: RelevanceOutput,
    // Deterministic mechanism rules + critic (Phase 3). Model hypotheses (deep only) stay untrusted and are re-critiqued here.
    async run(_env, input) {
      return { analysis: analyzeRelevance(input.own, input.profile, input.hypotheses) };
    },
  } satisfies ToolImpl<{ own: OwnCompanyContext | null; profile: z.infer<typeof TargetProfileSchema>; hypotheses: z.infer<typeof ModelHypothesisSchema>[] }, z.infer<typeof RelevanceOutput>>,
} as unknown as Record<ToolId, ToolImpl<never, unknown>>;
