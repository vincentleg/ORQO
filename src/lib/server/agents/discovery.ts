/**
 * The discover_companies step plan (Phase 5), executed by the Phase 4
 * orchestrator: every step is recorded, every tool call crosses the same
 * gate (permission → autonomy → schemas → precheck → approval → budget →
 * ledger). Fixed and bounded:
 *
 *   load_workspace_context → build_discovery_plan → read_existing_knowledge
 *   → find_candidates (one source) → deduplicate_candidates (stage 1)
 *   → verify_candidates (stored research first, then ≤ 3 governed official-site analyses)
 *   → qualify_candidates (Phase 3 rules + critic) → apply_critic (discovery critic + priority)
 *   → produce_result
 *
 * No recursion and no self-expansion. Control flow reads only typed tool
 * outputs (verdicts, counts, ids) — never retrieved web text or snippets.
 * Running out of time or verification allowance yields a labeled partial
 * result, not an unbounded run.
 */
import { DiscoveryResult, type DiscoveredCompany, type MissionInput } from "@/lib/agents/contracts";
import { AgentBudgetExceeded } from "@/lib/agents/budget";
import { mayRecommend } from "@/lib/agents/policy";
import { registrableDomain, type KnowledgeIndex, type RawCandidate, type SourcedCandidate, type StageOneRejection } from "@/lib/discovery/candidates";
import type { DiscoveryPlan } from "@/lib/discovery/plan";
import type { Qualification } from "@/lib/discovery/qualify";
import { DISCOVERY_LIMITS, type UnverifiedReason } from "@/lib/discovery/types";
import type { OwnCompanyContext } from "@/lib/intelligence/types";
import type { ProviderUsage } from "@/lib/server/research/types";
import { RunFailed, type RunSpec, type StepFn, type ToolFn } from "./orchestrator";
import type { DomainDecision, StoredResearch } from "./tools";

interface Ctx {
  spec: RunSpec;
  step: StepFn;
  callTool: ToolFn;
  remainingMs: () => number;
}

type Verified = { c: SourcedCandidate; research: StoredResearch; reused: boolean; researchRunId: string | null };
type Rejected = DiscoveryResult["rejected"][number];

export async function runDiscovery({ spec, step, callTool, remainingMs }: Ctx): Promise<DiscoveryResult> {
  const input = spec.input as MissionInput<"discover_companies">;
  const objective = { intent: input.intent, text: input.objective ?? null, geography: input.geography ?? null, market: input.market ?? null };

  const own = await step("load_workspace_context", async () => {
    const r = await callTool<{ own: OwnCompanyContext | null }>("read_workspace_company", {});
    return { value: r.own, summary: { ownProfile: r.own !== null } };
  });
  // Discovery is relative to the workspace: without what it offers, nothing can be qualified.
  if (!own || (own.offerings.length === 0 && !own.summary)) throw new RunFailed("own_profile_missing");

  const plan = await step("build_discovery_plan", async () => {
    const r = await callTool<{ plan: DiscoveryPlan }>("build_discovery_plan", { own, objective });
    return { value: r.plan, summary: { mechanisms: r.plan.mechanisms, queries: r.plan.queries.length, unsupported: r.plan.unsupported.length } };
  });

  const funnel = { sourced: 0, duplicates: 0, excluded: 0, considered: 0, verified: 0, unverified: 0, qualified: 0, weak: 0, rejected: 0 };
  const sourceInfo = { id: input.source, provider: null as string | null, live: input.source === "web_search" };
  const recommend = mayRecommend(spec.autonomy);
  const base = (over: Partial<DiscoveryResult>): DiscoveryResult => ({
    kind: "company_discovery",
    objective,
    source: sourceInfo,
    status: "completed",
    partialReason: null,
    plan,
    funnel,
    companies: [],
    rejected: [],
    unverified: [],
    ownGaps: plan.gaps,
    nextAction: null,
    ...over,
  });
  const finish = (r: DiscoveryResult) =>
    step("produce_result", async () => {
      // Contract check before anything is persisted.
      const checked = DiscoveryResult.safeParse(r);
      if (!checked.success) throw new RunFailed("internal", "invalid_result");
      return { value: checked.data, summary: { status: checked.data.status, qualified: checked.data.companies.length, rejected: checked.data.funnel.rejected } };
    });

  // The workspace profile cannot support any requested mechanism: say which fields are missing, search nothing.
  if (plan.mechanisms.length === 0) {
    const fields = [...new Set([...plan.unsupported.map((u) => u.field), ...plan.gaps])];
    return finish(base({ status: "plan_infeasible", nextAction: recommend ? { kind: "complete_profile", fields } : null }));
  }

  const knowledge = await step("read_existing_knowledge", async () => {
    const r = await callTool<{ knowledge: KnowledgeIndex }>("read_existing_company_knowledge", {});
    return { value: r.knowledge, summary: { network: r.knowledge.network.length, analyses: r.knowledge.analyses.length, remembered: r.knowledge.decisions.length } };
  });

  const raw = await step("find_candidates", async () => {
    // Exactly one source per mission; web search is paid and approval-gated by the registry.
    const r =
      input.source === "web_search"
        ? await callTool<{ candidates: RawCandidate[]; provider: string | null; usage: ProviderUsage[] }>("search_web_candidates", { queries: plan.queries })
        : await callTool<{ candidates: RawCandidate[]; provider: string | null; usage: ProviderUsage[] }>("source_known_candidates", { limit: 30 });
    sourceInfo.provider = r.provider;
    return { value: r.candidates, summary: { source: input.source, provider: r.provider, results: r.candidates.length } };
  });
  funnel.sourced = raw.length;

  const stage1 = await step("deduplicate_candidates", async () => {
    const r = await callTool<{ candidates: SourcedCandidate[]; duplicates: number; rejected: StageOneRejection[] }>("deduplicate_candidates", { raw, knowledge, reevaluate: input.reevaluate });
    return { value: r, summary: { kept: r.candidates.length, duplicates: r.duplicates, excluded: r.rejected.length } };
  });
  funnel.duplicates = stage1.duplicates;
  funnel.excluded = stage1.rejected.length;
  funnel.considered = stage1.candidates.length;
  const inNetwork = (domain: string) => knowledge.network.some((n) => n.domain !== null && registrableDomain(n.domain) === domain);
  const rejected: Rejected[] = stage1.rejected.map((r) => ({ name: r.name, domain: r.domain, stage: "sourcing", reason: r.reason, inNetwork: inNetwork(r.domain), previous: r.previous }));

  if (stage1.candidates.length === 0) {
    funnel.rejected = rejected.length;
    return finish(base({ status: "no_candidates", rejected: rejected.slice(0, DISCOVERY_LIMITS.maxListedRejections), nextAction: recommend ? { kind: "broaden" } : null }));
  }

  // Stage 2 — verification. Existing knowledge first (the dedup step ranks stored analyses first).
  const unverified: DiscoveryResult["unverified"] = [];
  let stopped: Extract<UnverifiedReason, "budget" | "verification_refused"> | null = null;
  const verified = await step("verify_candidates", async () => {
    const out: Verified[] = [];
    let newResearch = 0;
    let limitHit = false;
    const skip = (c: SourcedCandidate, reason: UnverifiedReason) => unverified.push({ name: c.name, domain: c.domain, reason, inNetwork: c.network !== null });
    for (const [i, c] of stage1.candidates.entries()) {
      if (i >= DISCOVERY_LIMITS.maxVerified) {
        skip(c, "verification_limit");
        limitHit = true;
        continue;
      }
      if (stopped) {
        skip(c, stopped);
        continue;
      }
      try {
        const stored = await callTool<{ research: StoredResearch | null }>("read_stored_research", { domain: c.researchDomain });
        if (stored.research) {
          out.push({ c, research: stored.research, reused: true, researchRunId: null });
          continue;
        }
        // Observe never fetches the web; the company stays unverified rather than being guessed.
        if (spec.autonomy < 1) {
          skip(c, "observe_only");
          continue;
        }
        if (newResearch >= DISCOVERY_LIMITS.maxNewResearch) {
          skip(c, "verification_limit");
          limitHit = true;
          continue;
        }
        if (remainingMs() < DISCOVERY_LIMITS.minTimeForResearchMs) {
          stopped = "budget";
          skip(c, "budget");
          continue;
        }
        newResearch += 1;
        // The governed Phase 3 Basic analysis: official website only, SSRF-safe, robots.txt, quota and hard limits.
        const r = await callTool<{ status: "cached" | "completed"; domain: string; researchRunId: string | null }>("official_site_research", { query: c.domain, refresh: false });
        const after = await callTool<{ research: StoredResearch | null }>("read_stored_research", { domain: r.domain });
        // Identity: the analyzed site must be the candidate's own domain (not a redirect elsewhere).
        if (!after.research || registrableDomain(after.research.profile.domain) !== c.domain) {
          rejected.push({ name: c.name, domain: c.domain, stage: "verification", reason: "identity_unverified", inNetwork: c.network !== null, previous: null });
          continue;
        }
        out.push({ c, research: after.research, reused: r.status === "cached", researchRunId: r.researchRunId });
      } catch (e) {
        if (e instanceof RunFailed && e.code === "research_failed") {
          // Unreachable, parked or unidentifiable site: the company is not presented.
          rejected.push({ name: c.name, domain: c.domain, stage: "verification", reason: "identity_unverified", inNetwork: c.network !== null, previous: null });
        } else if (e instanceof RunFailed && e.code === "research_refused") {
          stopped = "verification_refused";
          skip(c, "verification_refused");
        } else if (e instanceof AgentBudgetExceeded) {
          stopped = "budget";
          skip(c, "budget");
        } else throw e;
      }
    }
    return { value: { out, limitHit }, summary: { verified: out.length, newResearch, unverified: unverified.length, stopped } };
  });
  funnel.verified = verified.out.length;
  funnel.unverified = unverified.length;

  const qualified = await step("qualify_candidates", async () => {
    const out: { v: Verified; q: Qualification }[] = [];
    for (const v of verified.out) {
      const r = await callTool<{ qualification: Qualification }>("qualify_candidate", { own, plan, research: v.research });
      out.push({ v, q: r.qualification });
    }
    return { value: out, summary: { qualified: out.filter((x) => x.q.verdict === "qualified").length, weak: out.filter((x) => x.q.verdict === "weak").length, rejected: out.filter((x) => x.q.verdict === "rejected").length } };
  });

  const decisions = await step("apply_critic", async () => {
    const r = await callTool<{ decisions: DomainDecision[] }>("apply_discovery_critic", { plan, items: qualified.map((x) => ({ domain: x.v.c.domain, qualification: x.q })) });
    return { value: r.decisions, summary: { kept: r.decisions.filter((d) => d.priority !== null).length, rejected: r.decisions.filter((d) => d.priority === null).length } };
  });

  const byDomain = new Map(qualified.map((x) => [x.v.c.domain, x]));
  const companies: DiscoveredCompany[] = [];
  for (const d of decisions) {
    const x = byDomain.get(d.domain);
    if (!x) continue;
    const { c, research } = x.v;
    if (d.priority === null || d.dimensions === null || !x.q.mechanism) {
      rejected.push({ name: c.name, domain: c.domain, stage: "qualification", reason: d.reason ?? "no_concrete_mechanism", inNetwork: c.network !== null, previous: null });
      continue;
    }
    if (d.verdict === "qualified") funnel.qualified += 1;
    else funnel.weak += 1;
    if (companies.length >= input.maxResults) continue;
    companies.push({
      name: research.profile.name.slice(0, 200),
      domain: c.domain,
      website: research.profile.website,
      source: c.source,
      hints: c.hints,
      network: c.network,
      research: { intelligenceId: research.id, researchedAt: research.researchedAt, mode: research.mode, reused: x.v.reused, researchRunId: x.v.researchRunId },
      priority: d.priority,
      dimensions: d.dimensions,
      mechanism: x.q.mechanism,
      evidence: x.q.evidence,
      whyNow: x.q.whyNow,
      unknowns: x.q.unknownFields,
      nextQuestion: recommend ? x.q.nextQuestion : null,
    });
  }
  funnel.rejected = rejected.length;

  const top = companies.find((c) => c.priority !== "weak");
  const nextAction: DiscoveryResult["nextAction"] = !recommend ? null : top ? { kind: "investigate", domain: top.domain, name: top.name, question: top.nextQuestion } : unverified.length > 0 ? { kind: "verify_more" } : { kind: "broaden" };
  return finish(
    base({
      status: stopped ? "partial" : "completed",
      partialReason: stopped ?? (verified.limitHit ? "verification_limit" : null),
      companies,
      rejected: rejected.slice(0, DISCOVERY_LIMITS.maxListedRejections),
      unverified: unverified.slice(0, DISCOVERY_LIMITS.maxCandidates),
      nextAction,
    }),
  );
}
