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
import { ModelHypothesisSchema, RELATIONSHIP_TYPES, TargetProfileSchema, UNDERSTANDING_FIELDS, type OwnCompanyContext } from "@/lib/intelligence/types";
import { AppError } from "@/lib/server/errors";
import { getCompany, getOwnCompanyProfile, toOwnContext } from "@/lib/server/repositories/companies";
import { readRelationshipContext, type RelationshipContext } from "@/lib/server/repositories/network-memory";
import { FOLLOW_UP_PRIORITIES, INTERACTION_KINDS, NETWORK_ORIGINS, NETWORK_STAGES } from "@/lib/network/model";
import type { PreparedResearch, ResearchCompletion, ResearchRequest } from "@/lib/server/research/execute";
import { findIntelligence } from "@/lib/server/research/repository";
import { ResearchError, type ProviderUsage } from "@/lib/server/research/types";
import type { Db } from "@/lib/server/supabase/types";
import { DiscoveryPlanSchema, EvidenceRefSchema, PriorityDimensionsSchema, QualifiedMechanismSchema } from "@/lib/agents/contracts";
import { deduplicateCandidates, type KnowledgeIndex, type RawCandidate, type SourcedCandidate } from "@/lib/discovery/candidates";
import { buildDiscoveryPlan, type DiscoveryPlan } from "@/lib/discovery/plan";
import { compareDecisions, criticizeCandidate, qualifyCandidate, type CriticDecision, type Qualification } from "@/lib/discovery/qualify";
import { CANDIDATE_SOURCES, DISCOVERY_INTENTS, DISCOVERY_LIMITS, PRIORITIES, REJECTION_REASONS } from "@/lib/discovery/types";
import { recordUsage } from "@/lib/server/research/repository";
import { knownCandidates, readCompanyKnowledge } from "@/lib/server/discovery/knowledge";
import type { CandidateSource } from "@/lib/server/discovery/sources";

/** The governed research entry point, injected so tests never reach the network. */
export interface ResearchGateway {
  /** The Phase 3 authorization for a mode (member+, entitlement, providers), without starting anything. */
  authorize(db: Db, userId: string, organizationId: string, mode: "basic" | "deep"): Promise<unknown>;
  prepare(db: Db, userId: string, organizationId: string, req: ResearchRequest): Promise<PreparedResearch>;
  run(p: Extract<PreparedResearch, { kind: "run" }>): Promise<ResearchCompletion>;
}

/** Discovery's paid web source and its entitlement, injected so tests never reach a provider. */
export interface DiscoveryGateway {
  webSource(): CandidateSource | null;
  webEntitled(organizationId: string): Promise<boolean>;
}

/** Without an injected gateway nothing paid is reachable: web discovery reports itself unconfigured. */
const noWebDiscovery: DiscoveryGateway = { webSource: () => null, webEntitled: async () => false };

export interface ToolEnv {
  db: Db;
  organizationId: string;
  userId: string;
  locale: Locale;
  agentRunId: string;
  research: ResearchGateway | null;
  /** The mission service injects the configured providers; absent → no paid web discovery. */
  discovery?: DiscoveryGateway;
}

/** A tool failure with a safe code (never a stack trace or provider message). */
export class ToolError extends Error {
  constructor(
    readonly code: "research_refused" | "research_failed" | "unavailable" | "provider_not_configured" | "search_not_permitted",
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

// ---------------------------------------------------------------------------
// Discovery tools (Phase 5)
// ---------------------------------------------------------------------------

const Text = (max: number) => z.string().max(max);
const RawCandidateSchema: z.ZodType<RawCandidate> = z.strictObject({ name: Text(300).nullable(), url: z.string().max(2000), hint: Text(500).nullable(), source: z.enum(CANDIDATE_SOURCES) });
const RejectionSchema = z.enum(REJECTION_REASONS);
const KnowledgeSchema: z.ZodType<KnowledgeIndex> = z.strictObject({
  ownDomain: Domain.nullable(),
  network: z.array(z.strictObject({ id: z.uuid(), name: Text(200), domain: Domain.nullable(), addedAt: z.string() })).max(1000),
  analyses: z.array(z.strictObject({ domain: Domain, name: Text(200), researchedAt: z.string(), mode: z.enum(["basic", "deep"]) })).max(50),
  decisions: z.array(z.strictObject({ domain: Domain, reason: RejectionSchema, at: z.string() })).max(100),
});
const SourcedCandidateSchema: z.ZodType<SourcedCandidate> = z.strictObject({
  domain: Domain,
  name: Text(200),
  website: z.url({ protocol: /^https$/ }),
  source: z.enum(CANDIDATE_SOURCES),
  hints: z.array(Text(240)).max(2),
  hits: z.number().int().min(1),
  network: z.strictObject({ companyId: z.uuid(), addedAt: z.string() }).nullable(),
  analysis: z.strictObject({ researchedAt: z.string(), mode: z.enum(["basic", "deep"]) }).nullable(),
  researchDomain: Domain,
});
const SourceOutput = z.strictObject({ candidates: z.array(RawCandidateSchema).max(40), provider: Text(40).nullable(), usage: ResearchToolOutput.shape.usage });
const QualificationSchema: z.ZodType<Qualification> = z.strictObject({
  verdict: z.enum(["qualified", "weak", "rejected"]),
  reason: RejectionSchema.nullable(),
  mechanism: QualifiedMechanismSchema.nullable(),
  evidence: z.array(EvidenceRefSchema).max(3),
  whyNow: z.array(EvidenceRefSchema).max(2),
  substantive: z.boolean(),
  geographyMatch: z.boolean().nullable(),
  marketMatch: z.boolean().nullable(),
  competitorRisk: z.boolean(),
  unknownFields: z.array(z.enum(UNDERSTANDING_FIELDS)).max(UNDERSTANDING_FIELDS.length),
  nextQuestion: Text(400).nullable(),
});
const DecisionSchema = z.strictObject({
  domain: Domain,
  verdict: z.enum(["qualified", "weak", "rejected"]),
  reason: RejectionSchema.nullable(),
  priority: z.enum(PRIORITIES).nullable(),
  dimensions: PriorityDimensionsSchema.nullable(),
});
export type DomainDecision = z.infer<typeof DecisionSchema>;
const PlanSchema = DiscoveryPlanSchema as unknown as z.ZodType<DiscoveryPlan>;

const discoveryTools = {
  build_discovery_plan: {
    input: z.strictObject({
      own: OwnContextSchema,
      objective: z.strictObject({ intent: z.enum(DISCOVERY_INTENTS), text: Text(200).nullable(), geography: Text(60).nullable(), market: Text(60).nullable() }),
    }),
    output: z.strictObject({ plan: PlanSchema }),
    async run(_env, input) {
      return { plan: buildDiscoveryPlan(input.own, input.objective) };
    },
  } satisfies ToolImpl<{ own: OwnCompanyContext; objective: Parameters<typeof buildDiscoveryPlan>[1] }, { plan: DiscoveryPlan }>,
  read_existing_company_knowledge: {
    input: z.strictObject({}),
    output: z.strictObject({ knowledge: KnowledgeSchema }),
    async run(env) {
      return { knowledge: await readCompanyKnowledge(env.db, env.organizationId) };
    },
    refs: (o) => ({ ref: { network: o.knowledge.network.length, analyses: o.knowledge.analyses.length, remembered: o.knowledge.decisions.length } }),
  } satisfies ToolImpl<Record<string, never>, { knowledge: KnowledgeIndex }>,
  source_known_candidates: {
    input: z.strictObject({ limit: z.number().int().min(1).max(30) }),
    output: SourceOutput,
    async run(env, input) {
      const k = await readCompanyKnowledge(env.db, env.organizationId);
      return { candidates: knownCandidates(k, input.limit), provider: null, usage: [] };
    },
    refs: (o) => ({ ref: { source: "workspace_knowledge", results: o.candidates.length } }),
  } satisfies ToolImpl<{ limit: number }, z.infer<typeof SourceOutput>>,
  search_web_candidates: {
    input: z.strictObject({ queries: z.array(z.string().trim().min(2).max(120)).min(1).max(DISCOVERY_LIMITS.maxQueries) }),
    output: SourceOutput,
    // Runs BEFORE approval and before any provider: never ask a human to approve what policy refuses.
    async precheck(env) {
      const gw = env.discovery ?? noWebDiscovery;
      if (!(await gw.webEntitled(env.organizationId))) throw new ToolError("search_not_permitted", "plan_required");
      if (!gw.webSource()) throw new ToolError("provider_not_configured", "provider_not_configured");
    },
    async run(env, input) {
      const gw = env.discovery ?? noWebDiscovery;
      const source = gw.webSource();
      if (!source) throw new ToolError("provider_not_configured", "provider_not_configured");
      const r = await source.find(input.queries);
      // Provider-reported usage only; attributed to this agent run (no research run is involved).
      for (const u of r.usage) await recordUsage(env.db, env.organizationId, null, u, env.agentRunId).catch((e) => console.error("[orqo] usage record failed", e instanceof Error ? e.message.slice(0, 200) : typeof e));
      return { candidates: r.candidates.slice(0, 40), provider: source.provider, usage: r.usage };
    },
    refs: (o) => ({ ref: { source: "web_search", provider: o.provider, results: o.candidates.length }, usage: o.usage }),
  } satisfies ToolImpl<{ queries: string[] }, z.infer<typeof SourceOutput>>,
  deduplicate_candidates: {
    input: z.strictObject({ raw: z.array(RawCandidateSchema).max(40), knowledge: KnowledgeSchema, reevaluate: z.boolean() }),
    output: z.strictObject({
      candidates: z.array(SourcedCandidateSchema).max(DISCOVERY_LIMITS.maxCandidates),
      duplicates: z.number().int().min(0),
      rejected: z.array(z.strictObject({ name: Text(200), domain: Domain, reason: z.enum(["duplicate", "own_company", "not_a_company_site", "previously_rejected"]), previous: z.strictObject({ reason: RejectionSchema, at: z.string() }).nullable() })).max(40),
    }),
    async run(_env, input) {
      return deduplicateCandidates(input.raw, input.knowledge, { reevaluate: input.reevaluate, now: Date.now() });
    },
    refs: (o) => ({ ref: { kept: o.candidates.length, duplicates: o.duplicates, excluded: o.rejected.length } }),
  } satisfies ToolImpl<{ raw: RawCandidate[]; knowledge: KnowledgeIndex; reevaluate: boolean }, ReturnType<typeof deduplicateCandidates>>,
  qualify_candidate: {
    input: z.strictObject({ own: OwnContextSchema, plan: PlanSchema, research: StoredResearchSchema }),
    output: z.strictObject({ qualification: QualificationSchema }),
    // Mechanism rules + Phase 3 critic over VERIFIED evidence. Retrieved text stays data: it can only match concepts.
    async run(env, input) {
      return { qualification: qualifyCandidate(input.own, input.plan, input.research.profile, input.research.hypotheses, env.locale) };
    },
    refs: (o) => ({ ref: { verdict: o.qualification.verdict, rule: o.qualification.mechanism?.rule ?? null } }),
  } satisfies ToolImpl<{ own: OwnCompanyContext; plan: DiscoveryPlan; research: StoredResearch }, { qualification: Qualification }>,
  apply_discovery_critic: {
    input: z.strictObject({ plan: PlanSchema, items: z.array(z.strictObject({ domain: Domain, qualification: QualificationSchema })).max(DISCOVERY_LIMITS.maxVerified) }),
    output: z.strictObject({ decisions: z.array(DecisionSchema).max(DISCOVERY_LIMITS.maxVerified) }),
    async run(_env, input) {
      const decided = input.items.map((i) => ({ domain: i.domain, ...criticizeCandidate(input.plan, i.qualification) }));
      const ranked = decided.filter((d): d is typeof d & { priority: NonNullable<CriticDecision["priority"]>; dimensions: NonNullable<CriticDecision["dimensions"]> } => d.priority !== null && d.dimensions !== null).sort(compareDecisions);
      return { decisions: [...ranked, ...decided.filter((d) => d.priority === null)] };
    },
  } satisfies ToolImpl<{ plan: DiscoveryPlan; items: { domain: string; qualification: Qualification }[] }, { decisions: DomainDecision[] }>,
};

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
  read_relationship_context: {
    input: z.strictObject({ companyId: z.uuid() }),
    output: z.strictObject({
      context: z
        .strictObject({
          provenance: z.literal("private_relationship_memory"),
          company: z.strictObject({ id: z.uuid(), name: z.string(), stage: z.enum(NETWORK_STAGES).nullable(), origin: z.enum(NETWORK_ORIGINS).nullable() }),
          contacts: z.array(z.strictObject({ id: z.uuid(), name: z.string(), role: z.string(), isPrimary: z.boolean() })),
          recentInteractions: z.array(z.strictObject({ kind: z.enum(INTERACTION_KINDS), occurredAt: z.string(), title: z.string(), nextStep: z.string() })),
          openFollowUps: z.array(z.strictObject({ title: z.string(), dueOn: z.string().nullable(), priority: z.enum(FOLLOW_UP_PRIORITIES) })),
        })
        .nullable(),
    }),
    // Phase 6 seam: read-only, organization-scoped, data-minimized. No agent that uses it is executable yet.
    async run(env, input) {
      return { context: await readRelationshipContext(env.db, env.organizationId, input.companyId) };
    },
    refs: (o) => ({ ref: { companyId: o.context?.company.id ?? null } }),
  } satisfies ToolImpl<{ companyId: string }, { context: RelationshipContext | null }>,
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
  ...discoveryTools,
} as unknown as Record<ToolId, ToolImpl<never, unknown>>;
