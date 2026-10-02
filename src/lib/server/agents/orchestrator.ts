/**
 * ORQO Orchestrator (Phase 4, minimum viable).
 *
 * Not an autonomous super-agent. It executes ONE structured mission for ONE
 * registered agent through a fixed, bounded step plan:
 *
 *   mission (validated) → run → steps → governed tool calls → validated result
 *
 * Every tool call crosses the same gate (callTool): registry permission →
 * autonomy → input schema → policy precheck → approval → budget reservation
 * → execution → output schema → ledger. Control flow depends only on the registry, the
 * mission input and typed tool outputs — never on text found in web content
 * or model output, which stays untrusted data.
 *
 * Persistence (RunStore) and tools are injected, so the orchestrator runs
 * identically against the database and against in-memory fakes in tests.
 */
import { CompanyAnalysisResult, type AgentResult, type MissionInput } from "@/lib/agents/contracts";
import { AgentBudget, AgentBudgetExceeded } from "@/lib/agents/budget";
import { decideTool, mayRecommend } from "@/lib/agents/policy";
import type { AgentDefinition } from "@/lib/agents/registry";
import { TOOLS } from "@/lib/agents/tools";
import { isRegisteredTool } from "@/lib/agents/tools";
import type { AutonomyLevel, CapabilityId, MissionType, RunFailure, StepKey, ToolId } from "@/lib/agents/types";
import type { Locale } from "@/lib/i18n/config";
import type { RelevanceAnalysis, EvaluatedCandidate } from "@/lib/intelligence/relevance";
import type { OwnCompanyContext } from "@/lib/intelligence/types";
import { validationQuestion } from "@/lib/intelligence/wording";
import { parseSearchQuery } from "@/lib/search/query";
import { cacheStatus } from "@/lib/server/research/config";
import { runDiscovery } from "./discovery";
import { noopObserver, type AgentObserver } from "./observability";
import type { RunCounters, RunStore } from "./repository";
import { ToolError, type StoredResearch, type ToolEnv, type ToolImpl } from "./tools";
import { errorSummary, recordOperation } from "@/lib/server/observability";

export class RunFailed extends Error {
  constructor(
    readonly code: RunFailure,
    readonly detail: string | null = null,
  ) {
    super(code);
  }
}

class WaitingForApproval extends Error {
  constructor(readonly approvalId: string) {
    super("waiting_for_approval");
  }
}

export interface RunSpec {
  runId: string;
  missionId: string;
  agent: AgentDefinition;
  capability: CapabilityId;
  autonomy: AutonomyLevel;
  missionType: MissionType;
  input: MissionInput<"analyze_company"> | MissionInput<"explain_opportunities"> | MissionInput<"discover_companies">;
  /** Tools a human approved for this run (read from the database by the caller, never from a payload). */
  approvedTools: readonly ToolId[];
  resumed: boolean;
}

export interface OrchestratorDeps {
  store: RunStore;
  tools: Record<ToolId, ToolImpl<never, unknown>>;
  env: Omit<ToolEnv, "agentRunId">;
  observer?: AgentObserver;
  clock?: () => number;
  /** Real-time step events (streamed to the UI). */
  onStep?: (event: { key: StepKey; status: "running" | "completed" | "failed" | "skipped" }) => void;
}

export type RunOutcome =
  | { status: "completed"; result: AgentResult; counters: RunCounters; durationMs: number }
  | { status: "failed"; code: RunFailure; counters: RunCounters; durationMs: number }
  | { status: "waiting_for_approval"; approvalId: string; counters: RunCounters; durationMs: number };

/** Executes (or resumes) a run to a terminal state or an approval gate. Never throws for business failures. */
export async function executeRun(deps: OrchestratorDeps, spec: RunSpec): Promise<RunOutcome> {
  const clock = deps.clock ?? Date.now;
  const observer = deps.observer ?? noopObserver;
  const started = clock();
  const budget = new AgentBudget(spec.agent.limits, clock);
  const env: ToolEnv = { ...deps.env, agentRunId: spec.runId };
  let seq = await deps.store.nextStepSeq(spec.runId);
  let currentStep: string | null = null;

  if (spec.resumed) await deps.store.resumeRun(spec.runId, spec.missionId);
  else await deps.store.startRun(spec.runId, spec.missionId);
  observer.runStarted({ runId: spec.runId, agentId: spec.agent.id, missionType: spec.missionType, autonomy: spec.autonomy });

  const counters = (): RunCounters => budget.snapshot();
  const elapsed = () => clock() - started;

  async function step<T>(key: StepKey, fn: () => Promise<{ value: T; summary: Record<string, unknown>; skipped?: boolean }>): Promise<T> {
    const id = await deps.store.addStep(spec.runId, seq++, key);
    currentStep = id;
    deps.onStep?.({ key, status: "running" });
    try {
      const r = await fn();
      const status = r.skipped ? "skipped" : "completed";
      await deps.store.finishStep(id, status, r.summary);
      deps.onStep?.({ key, status });
      observer.step({ runId: spec.runId, key, status });
      return r.value;
    } catch (e) {
      if (e instanceof WaitingForApproval) {
        await deps.store.finishStep(id, "skipped", { waitingForApproval: true });
        deps.onStep?.({ key, status: "skipped" });
      } else {
        await deps.store.finishStep(id, "failed", { error: e instanceof RunFailed ? e.code : e instanceof AgentBudgetExceeded ? "budget_exhausted" : "internal" }).catch(() => undefined);
        deps.onStep?.({ key, status: "failed" });
        observer.step({ runId: spec.runId, key, status: "failed" });
      }
      throw e;
    } finally {
      currentStep = null;
    }
  }

  /** The single gate every tool call crosses. */
  async function callTool<O>(toolId: string, input: unknown): Promise<O> {
    const t0 = clock();
    const decision = decideTool(spec.agent, spec.capability, toolId, spec.autonomy);
    const meta = isRegisteredTool(toolId) ? TOOLS[toolId] : null;
    const record = (outcome: "succeeded" | "failed" | "denied" | "approval_required", detail: string | null, extra: { researchRunId?: string | null; ref?: Record<string, string | number | boolean | null> } = {}) =>
      deps.store.addToolCall(spec.runId, currentStep, {
        toolId,
        outcome,
        detail,
        costClass: meta?.costClass ?? "none",
        externalNetwork: meta?.externalNetwork ?? false,
        researchRunId: extra.researchRunId ?? null,
        ref: extra.ref ?? {},
        durationMs: clock() - t0,
      });
    if (!decision.ok || !meta || !isRegisteredTool(toolId)) {
      await record("denied", decision.ok ? "tool_not_registered" : decision.reason);
      observer.toolCall({ runId: spec.runId, toolId, outcome: "denied" });
      throw new RunFailed("tool_denied", decision.ok ? "tool_not_registered" : decision.reason);
    }
    const impl = deps.tools[toolId];
    const parsedInput = impl.input.safeParse(input);
    if (!parsedInput.success) {
      await record("failed", "invalid_input");
      throw new RunFailed("internal", "invalid_tool_input");
    }
    if (impl.precheck) {
      try {
        await (impl as ToolImpl<unknown, unknown>).precheck?.(env, parsedInput.data);
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        await record("denied", /^[a-z_]{1,40}$/.test(e.detail) ? e.detail : "policy");
        observer.toolCall({ runId: spec.runId, toolId, outcome: "denied" });
        throw new RunFailed(e.code === "unavailable" ? "research_refused" : e.code, e.detail);
      }
    }
    if (decision.approval === "required" && !spec.approvedTools.includes(toolId)) {
      const approvalId = await deps.store.requestApproval(spec.runId, toolId, { toolId, costClass: meta.costClass, variableCost: meta.variableCost, externalNetwork: meta.externalNetwork, maxModelCalls: meta.limits.maxModelCalls, maxExternalRequests: meta.limits.maxExternalRequests });
      await record("approval_required", null);
      observer.toolCall({ runId: spec.runId, toolId, outcome: "approval_required" });
      throw new WaitingForApproval(approvalId);
    }
    try {
      budget.reserve(meta);
    } catch (e) {
      await record("failed", "budget_exhausted");
      throw e;
    }
    let raw: unknown;
    try {
      raw = await (impl as ToolImpl<unknown, unknown>).run(env, parsedInput.data);
    } catch (e) {
      const detail = e instanceof ToolError ? e.detail : "tool_error";
      await record("failed", /^[a-z_]{1,40}$/.test(detail) ? detail : "tool_error");
      observer.toolCall({ runId: spec.runId, toolId, outcome: "failed" });
      if (e instanceof ToolError) throw new RunFailed(e.code === "unavailable" ? "research_refused" : e.code, e.detail);
      throw e;
    }
    // Malformed output never becomes run state.
    const parsed = impl.output.safeParse(raw);
    if (!parsed.success) {
      await record("failed", "invalid_output");
      observer.toolCall({ runId: spec.runId, toolId, outcome: "failed" });
      throw new RunFailed("invalid_tool_output");
    }
    const refs = (impl as ToolImpl<unknown, unknown>).refs?.(parsed.data) ?? {};
    for (const u of refs.usage ?? []) budget.addCost(u.costUsd);
    await record("succeeded", null, { researchRunId: refs.researchRunId ?? null, ref: refs.ref });
    observer.toolCall({ runId: spec.runId, toolId, outcome: "succeeded" });
    budget.assertTime();
    return parsed.data as O;
  }

  try {
    // Deterministic routing by mission type; both plans use the same governed step and tool gates.
    const result = spec.missionType === "discover_companies" ? await runDiscovery({ spec, step, callTool, remainingMs: () => budget.remainingMs() }) : await runPlan(spec, step, callTool, deps.env.locale);
    const durationMs = elapsed();
    await deps.store.completeRun(spec.runId, spec.missionId, { result, counters: counters(), durationMs, summary: summarize(result) });
    observer.runFinished({ runId: spec.runId, status: "completed", durationMs });
    recordOperation({ operation: "agent.run", outcome: "succeeded", runId: spec.runId, agentId: spec.agent.id, durationMs });
    return { status: "completed", result, counters: counters(), durationMs };
  } catch (e) {
    const durationMs = elapsed();
    if (e instanceof WaitingForApproval) {
      observer.runFinished({ runId: spec.runId, status: "waiting_for_approval", durationMs });
      return { status: "waiting_for_approval", approvalId: e.approvalId, counters: counters(), durationMs };
    }
    const code: RunFailure = e instanceof RunFailed ? e.code : e instanceof AgentBudgetExceeded ? "budget_exhausted" : "internal";
    if (code === "internal") console.error("[orqo] agent run failed", spec.runId, errorSummary(e));
    await deps.store.failRun(spec.runId, spec.missionId, { code, counters: counters(), durationMs }).catch((err) => console.error("[orqo] agent run fail-record failed", spec.runId, errorSummary(err)));
    observer.runFinished({ runId: spec.runId, status: "failed", durationMs });
    recordOperation({ operation: "agent.run", outcome: "failed", runId: spec.runId, agentId: spec.agent.id, durationMs, errorCategory: code });
    return { status: "failed", code, counters: counters(), durationMs };
  }
}

export type StepFn = <T>(key: StepKey, fn: () => Promise<{ value: T; summary: Record<string, unknown>; skipped?: boolean }>) => Promise<T>;
export type ToolFn = <O>(toolId: string, input: unknown) => Promise<O>;

/** The bounded step plan. Deterministic: the same mission and data always produce the same calls. */
async function runPlan(spec: RunSpec, step: StepFn, callTool: ToolFn, locale: Locale): Promise<AgentResult> {
  if (!("target" in spec.input)) throw new RunFailed("internal", "invalid_input");
  const input0 = spec.input;
  const own = await step("load_workspace_context", async () => {
    const r = await callTool<{ own: OwnCompanyContext | null }>("read_workspace_company", {});
    return { value: r.own, summary: { ownProfile: r.own !== null } };
  });

  // Context assembly: only the referenced target, resolved inside this organization.
  const target = await step("resolve_target", async () => {
    const ref = input0.target;
    let query: string;
    if ("companyId" in ref) {
      const r = await callTool<{ company: { id: string; name: string; website: string | null } | null }>("read_network_company", { companyId: ref.companyId });
      if (!r.company) throw new RunFailed("target_not_found");
      query = r.company.website ?? r.company.name;
    } else {
      query = ref.query;
    }
    const parsed = parseSearchQuery(query);
    if (!parsed) throw new RunFailed("target_invalid");
    const key = parsed.kind === "website" ? { domain: parsed.domain } : { name: parsed.name };
    return { value: { query, key }, summary: { kind: parsed.kind, ...(parsed.kind === "website" ? { domain: parsed.domain } : {}) } };
  });

  const readStored = () => callTool<{ research: StoredResearch | null }>("read_stored_research", target.key);

  let stored = await step("retrieve_existing_research", async () => {
    const r = await readStored();
    const fresh = r.research ? !cacheStatus(r.research.researchedAt).stale : false;
    return { value: r.research, summary: { found: r.research !== null, fresh, mode: r.research?.mode ?? null } };
  });

  let researchRunId: string | null = null;
  let reused = true;
  if (spec.missionType === "analyze_company") {
    const input = spec.input as MissionInput<"analyze_company">;
    const sufficient = stored !== null && (input.depth === "basic" || stored.mode === "deep");
    const fresh = stored !== null && !cacheStatus(stored.researchedAt).stale;
    const needed = !stored || !sufficient || !fresh || input.refresh;
    stored = await step("run_research", async () => {
      if (!needed) return { value: stored, summary: { reused: true }, skipped: true };
      // Observe (0) never triggers new web activity; it works from what is stored.
      if (spec.autonomy < 1) {
        if (stored) return { value: stored, summary: { reused: true, reason: "observe_only" }, skipped: true };
        throw new RunFailed("research_not_permitted");
      }
      const tool = input.depth === "deep" ? "deep_company_research" : "official_site_research";
      const r = await callTool<{ status: "cached" | "completed"; domain: string; researchRunId: string | null }>(tool, { query: target.query, refresh: input.refresh });
      researchRunId = r.researchRunId;
      reused = r.status === "cached";
      const after = await callTool<{ research: StoredResearch | null }>("read_stored_research", { domain: r.domain });
      if (!after.research) throw new RunFailed("research_failed", "not_stored");
      return { value: after.research, summary: { tool, status: r.status, researchRunId: r.researchRunId, domain: r.domain } };
    });
  } else if (!stored) {
    // Explaining opportunities works from existing analysis only.
    throw new RunFailed("research_required");
  }
  const research = stored as StoredResearch;

  const analysis = await step("evaluate_relevance", async () => {
    const r = await callTool<{ analysis: RelevanceAnalysis }>("evaluate_business_relevance", { own, profile: research.profile, hypotheses: research.hypotheses });
    const a = r.analysis;
    return { value: a, summary: { status: a.status, opportunities: a.opportunities.length, hypotheses: a.hypotheses.length, rejected: a.rejected.length } };
  });

  return step("produce_result", async () => {
    const result = buildResult(spec, research, analysis, own, researchRunId, reused, locale);
    // Contract check before anything is persisted.
    const checked = CompanyAnalysisResult.safeParse(result);
    if (!checked.success) throw new RunFailed("internal", "invalid_result");
    return { value: checked.data, summary: { analysisStatus: checked.data.analysisStatus, nextAction: checked.data.nextAction?.kind ?? null } };
  });
}

function summarizeCandidate(c: EvaluatedCandidate) {
  return {
    relationship: c.relationship,
    rule: c.rule ?? null,
    verdict: c.verdict === "pass" ? ("pass" as const) : ("weak" as const),
    confidence: c.confidence,
    claimIds: c.targetClaimIds.slice(0, 12),
    validation: c.validation.slice(0, 6),
  };
}

function buildResult(spec: RunSpec, research: StoredResearch, a: RelevanceAnalysis, own: OwnCompanyContext | null, researchRunId: string | null, reused: boolean, locale: Locale): CompanyAnalysisResult {
  const p = research.profile;
  const top = a.opportunities[0] ?? a.hypotheses[0];
  let nextAction: CompanyAnalysisResult["nextAction"] = null;
  if (mayRecommend(spec.autonomy)) {
    if (a.status === "own_profile_missing") nextAction = { kind: "complete_profile" };
    else if (top) nextAction = { kind: "validate", relationship: top.relationship, validationKey: top.validation[0] ?? null, text: validationQuestion(top, p.name, own?.name ?? "", locale)?.slice(0, 400) ?? null };
  }
  return {
    kind: "company_analysis",
    target: { name: p.name.slice(0, 200), domain: p.domain },
    intelligenceId: research.id,
    researchRunId,
    reusedResearch: reused,
    researchedAt: research.researchedAt,
    researchMode: research.mode,
    analysisStatus: a.status,
    opportunities: a.opportunities.slice(0, 3).map(summarizeCandidate),
    hypotheses: a.hypotheses.slice(0, 3).map(summarizeCandidate),
    rejectedCount: a.rejected.length,
    unknowns: a.targetUnknowns,
    ownGaps: a.ownGaps,
    evidence: { sources: p.sources.length, facts: p.claims.filter((c) => c.epistemic === "fact").length, inferences: p.claims.filter((c) => c.epistemic === "inference").length },
    nextAction,
  };
}

/** Deterministic one-line summary (language-neutral; the UI renders the localized view from the structured result). */
function summarize(r: AgentResult): string {
  if (r.kind === "company_discovery") return `discover ${r.objective.intent} (${r.source.id}): ${r.funnel.qualified} qualified, ${r.funnel.weak} weak, ${r.funnel.rejected} rejected of ${r.funnel.considered} considered`;
  return `${r.target.domain}: ${r.analysisStatus}, ${r.opportunities.length} opportunities, ${r.hypotheses.length} hypotheses`;
}
