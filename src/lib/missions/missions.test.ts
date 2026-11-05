/**
 * Phase 17B mission contracts (pure): templates are deterministic and strict, children are free only, the
 * frozen contract and every step are re-verifiable, findings are deterministic and idempotent by key,
 * fan-out is bounded, the recovery table and state machines mirror the database.
 */
import { describe, expect, test } from "bun:test";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { RUN_STATUSES } from "@/lib/agents/types";
import { buildAuthority } from "@/lib/governance/authority";
import { resolveEntitlementFrom } from "@/lib/governance/entitlement";
import { contractMatches, FREE_ENVELOPE, freeChildInput, isFreeAuthority, planMission, verifyStep, type MissionContract } from "./contracts";
import { compileSummary, findingsFromResult, planFanout, type StoredFinding } from "./findings";
import { childAction, isRetryable } from "./recovery";
import { canMissionTransition, canStepTransition, isMissionTerminal, MISSION_TRANSITIONS, STEP_TRANSITIONS } from "./state";
import { MISSION_LIMITS, MISSION_STATUSES, MISSION_STEP_STATUSES, MISSION_TEMPLATES } from "./types";
import { GOLDEN_MISSIONS } from "./golden";

const ORG = "7e570000-0000-4000-8000-0000000000aa";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("templates and contracts", () => {
  test("every golden mission plans deterministically (same input → identical plan)", () => {
    for (const g of GOLDEN_MISSIONS) {
      const a = planMission(g.template, g.input);
      const b = planMission(g.template, structuredClone(g.input));
      expect(a).not.toBeNull();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a?.contract.envelope).toEqual({ maxCostUsd: 0, network: "official_sites", paidProviders: false, webSearch: false, deepResearch: false });
      expect(a?.contract.steps.at(-1)?.kind).toBe("compile");
    }
    expect(MISSION_TEMPLATES).toEqual(["research_company", "prospect_known_candidates", "prospect_and_research"]);
  });

  test("plans: explicit steps, seq gaps for fan-out, free child inputs only", () => {
    const r = planMission("research_company", { target: { query: "strong.example" } });
    expect(r?.contract.steps).toEqual([
      { seq: 10, key: "research", kind: "child_run", required: true, maxAttempts: 2, spec: { kind: "child_run", missionType: "analyze_company", input: { target: { query: "strong.example" }, depth: "basic", refresh: false } } },
      { seq: 20, key: "compile", kind: "compile", required: true, maxAttempts: 2, spec: { kind: "compile" } },
    ]);
    expect(r?.missionTypes).toEqual(["analyze_company"]);
    const p = planMission("prospect_and_research", { intent: "customers", market: " Defense\u0000 ", researchTop: 3 });
    expect(p?.contract.steps.map((s) => [s.seq, s.key, s.kind])).toEqual([
      [10, "prospect", "child_run"],
      [20, "research_top", "fanout"],
      [30, "compile", "compile"],
    ]);
    expect(p?.contract.steps[0].spec).toEqual({ kind: "child_run", missionType: "discover_companies", input: { intent: "customers", market: "Defense", source: "workspace_knowledge", maxResults: 5, reevaluate: false } });
    expect(p?.contract.limits).toEqual({ maxSteps: MISSION_LIMITS.maxSteps, maxChildRuns: 4 });
    expect(p?.missionTypes.sort()).toEqual(["analyze_company", "discover_companies"]);
    expect(p?.objective).toBe("prospect_and_research · customers · Defense");
  });

  test("strict inputs: no depth, source, steps, budget, tools, organization, unknown template or oversize values", () => {
    for (const [t, input] of [
      ["research_company", { target: { query: "x.example" }, depth: "deep" }],
      ["research_company", { target: { query: "x.example" }, steps: [] }],
      ["research_company", { target: { url: "x.example" } }],
      ["prospect_known_candidates", { intent: "customers", source: "web_search" }],
      ["prospect_known_candidates", { intent: "customers", budget: 10 }],
      ["prospect_known_candidates", { intent: "customers", tools: ["search_web_candidates"] }],
      ["prospect_known_candidates", { intent: "customers", organizationId: ORG }],
      ["prospect_known_candidates", { intent: "send_email" }],
      ["prospect_known_candidates", { maxResults: 50 }],
      ["prospect_and_research", { researchTop: 9 }],
      ["deep_research", {}],
      ["web_search", {}],
    ] as const)
      expect(planMission(t, input)).toBeNull();
  });

  test("free-only child inputs: Research Basic and Prospecting over workspace knowledge", () => {
    expect(freeChildInput("analyze_company", { target: { query: "a.example" } })).toEqual({ target: { query: "a.example" }, depth: "basic", refresh: false });
    expect(freeChildInput("analyze_company", { target: { query: "a.example" }, depth: "deep" })).toBeNull();
    expect(freeChildInput("analyze_company", { target: { query: "a.example" }, refresh: true })).toBeNull();
    expect(freeChildInput("discover_companies", { source: "web_search" })).toBeNull();
    expect(freeChildInput("discover_companies", {})).toMatchObject({ source: "workspace_knowledge" });
    expect(freeChildInput("explain_opportunities", { target: { query: "a.example" } })).toBeNull();
  });

  test("the frozen contract must equal the server's rebuild (tampering is detected)", () => {
    const plan = planMission("prospect_and_research", { intent: "customers" })!;
    const stored = { template: plan.template, templateVersion: plan.templateVersion, input: plan.input, contract: JSON.parse(JSON.stringify(plan.contract)) };
    expect(contractMatches(stored)).not.toBeNull();
    const tampered = structuredClone(stored);
    (tampered.contract.steps[0].spec.input as Record<string, unknown>).source = "web_search";
    expect(contractMatches(tampered)).toBeNull();
    expect(contractMatches({ ...stored, contract: { ...stored.contract, envelope: { ...stored.contract.envelope, maxCostUsd: 5 } } })).toBeNull();
    expect(contractMatches({ ...stored, templateVersion: 2 })).toBeNull();
    expect(contractMatches({ ...stored, input: { ...stored.input, researchTop: 3 } })).toBeNull();
    expect(contractMatches({ ...stored, template: "deep_research" })).toBeNull();
  });

  test("verifyStep: contract steps must be identical; other steps only valid fan-out research children", () => {
    const c = planMission("prospect_and_research", { intent: "customers", researchTop: 2 })!.contract as MissionContract;
    const s = (over: Record<string, unknown>) => ({ ...c.steps[0], ...over });
    expect(verifyStep(c, c.steps[0])).toEqual(c.steps[0].spec);
    expect(verifyStep(c, s({ required: false }))).toBeNull();
    expect(verifyStep(c, s({ spec: { ...c.steps[0].spec, input: { source: "web_search" } } }))).toBeNull();
    const child = { seq: 21, key: "research_top_1", kind: "child_run", required: false, maxAttempts: 2, spec: { kind: "child_run", missionType: "analyze_company", input: { target: { query: "strong.example" }, depth: "basic", refresh: false } } };
    expect(verifyStep(c, child)).toEqual(child.spec as never);
    expect(verifyStep(c, { ...child, seq: 23 })).toBeNull(); // beyond the fan-out's max
    expect(verifyStep(c, { ...child, seq: 31 })).toBeNull(); // not inside a fan-out gap
    expect(verifyStep(c, { ...child, required: true })).toBeNull();
    expect(verifyStep(c, { ...child, spec: { ...child.spec, input: { target: { query: "x.example" }, depth: "deep" } } })).toBeNull();
    expect(verifyStep(c, { ...child, spec: { kind: "child_run", missionType: "discover_companies", input: {} } })).toBeNull();
    const single = planMission("research_company", { target: { query: "a.example" } })!.contract;
    expect(verifyStep(single, { ...child, seq: 11 })).toBeNull(); // no fan-out in this plan
  });

  test("child authority with the free envelope is free, even for an Internal workspace with a budget", () => {
    const entitlement = resolveEntitlementFrom(ORG, "free", { ORQO_INTERNAL_ORGS: ORG, ORQO_INTERNAL_BUDGET_USD: "100" });
    for (const [agent, capability] of [
      [AGENT_REGISTRY.research, "company_research"],
      [AGENT_REGISTRY.prospecting, "prospect_discovery"],
    ] as const) {
      const free = buildAuthority({ principal: { organizationId: ORG, userId: USER }, entitlement, agent, capability, autonomy: 1, envelope: { ...FREE_ENVELOPE } });
      expect(isFreeAuthority(free)).toBe(true);
      expect(free.tools).not.toContain("deep_company_research");
      expect(free.tools).not.toContain("search_web_candidates");
      expect(free.limits.maxCostUsd).toBe(0);
      // The ordinary paid envelope is NOT free: the guard would refuse it.
      const paid = buildAuthority({ principal: { organizationId: ORG, userId: USER }, entitlement, agent, capability, autonomy: 2, envelope: { maxCostUsd: 0.25 } });
      expect(isFreeAuthority(paid)).toBe(false);
    }
  });
});

describe("state machines (mirror the database triggers)", () => {
  test("missions and steps move forward only; terminal states are final", () => {
    expect(Object.keys(MISSION_TRANSITIONS)).toEqual([...MISSION_STATUSES]);
    expect(Object.keys(STEP_TRANSITIONS)).toEqual([...MISSION_STEP_STATUSES]);
    expect(canMissionTransition("planned", "running")).toBe(true);
    expect(canMissionTransition("running", "planned")).toBe(false);
    expect(canMissionTransition("completed", "running")).toBe(false);
    expect(canMissionTransition("cancelled", "running")).toBe(false);
    for (const s of ["completed", "failed", "cancelled"] as const) expect(isMissionTerminal(s)).toBe(true);
    expect(canStepTransition("leased", "pending")).toBe(true);
    expect(canStepTransition("completed", "pending")).toBe(false);
    expect(canStepTransition("pending", "completed")).toBe(false);
  });
});

describe("recovery table", () => {
  const prev = (status: (typeof RUN_STATUSES)[number], createdBy = USER, errorCode: string | null = null) => ({ id: "r1", status, createdBy, hasAuthority: true, errorCode });
  test("adopt completed work, report unreported failures, resume own queued runs, interrupt the rest", () => {
    expect(childAction(null, USER)).toEqual({ kind: "new" });
    expect(childAction(prev("completed"), USER)).toEqual({ kind: "adopt", runId: "r1" });
    expect(childAction(prev("failed", USER, "target_not_found"), USER)).toEqual({ kind: "adopt_failure", runId: "r1", code: "target_not_found" });
    expect(childAction(prev("cancelled"), USER)).toEqual({ kind: "adopt_failure", runId: "r1", code: "cancelled" });
    expect(childAction(prev("queued"), USER)).toEqual({ kind: "resume", runId: "r1" });
    expect(childAction(prev("queued", "someone-else"), USER)).toEqual({ kind: "interrupt", runId: "r1" });
    expect(childAction(prev("running"), USER)).toEqual({ kind: "interrupt", runId: "r1" });
    expect(childAction(prev("waiting_for_approval"), USER)).toEqual({ kind: "interrupt", runId: "r1" });
  });
  test("only transient failures are retried", () => {
    for (const c of ["internal", "interrupted", "research_failed"]) expect(isRetryable(c)).toBe(true);
    for (const c of ["target_not_found", "own_profile_missing", "research_refused", "plan_required", "cancelled", "tool_denied", "quota_exhausted"]) expect(isRetryable(c)).toBe(false);
  });
});

describe("findings", () => {
  const analysis = {
    kind: "company_analysis" as const,
    target: { name: "Strong Systems", domain: "strong.example" },
    intelligenceId: "11111111-1111-4111-8111-111111111111",
    researchRunId: null,
    reusedResearch: true,
    researchedAt: "2026-10-01T00:00:00Z",
    researchMode: "basic" as const,
    analysisStatus: "opportunities" as const,
    opportunities: [{ relationship: "customer" as const, rule: null, verdict: "pass" as const, confidence: "strong" as const, claimIds: ["c1"], validation: [] }],
    hypotheses: [],
    rejectedCount: 1,
    unknowns: [],
    ownGaps: ["markets" as const],
    evidence: { sources: 2, facts: 3, inferences: 1 },
    nextAction: null,
  };

  test("an analysis gives one keyed finding (+ the profile gap), deterministic", () => {
    const a = findingsFromResult("research", analysis as never);
    expect(a.map((f) => [f.key, f.kind, f.subjectDomain])).toEqual([
      ["analysis:strong.example", "company_analysis", "strong.example"],
      ["gap:own_profile", "profile_gap", null],
    ]);
    expect(a[0].payload).toMatchObject({ analysisStatus: "opportunities", opportunities: [{ relationship: "customer", verdict: "pass" }], evidence: { facts: 3 } });
    expect(JSON.stringify(a[0].payload)).not.toContain("claimIds");
    expect(findingsFromResult("research", analysis as never)).toEqual(a);
  });

  const stored = (key: string, kind: StoredFinding["kind"], payload: Record<string, unknown>, stepKey = "prospect"): StoredFinding => ({ id: key, stepId: "s", stepKey, agentRunId: null, key, kind, subjectDomain: (payload.domain as string) ?? null, payload, createdAt: "" });

  test("fan-out: best non-weak prospects of the named step, bounded, inside the seq gap", () => {
    const f = [
      stored("prospect:c.example", "prospect", { rank: 1, domain: "c.example", name: "C", priority: "worth_investigating" }),
      stored("prospect:a.example", "prospect", { rank: 2, domain: "a.example", name: "A", priority: "high" }),
      stored("prospect:w.example", "prospect", { rank: 3, domain: "w.example", name: "W", priority: "weak" }),
      stored("prospect:b.example", "prospect", { rank: 4, domain: "b.example", name: "B", priority: "high" }),
      stored("prospect:z.example", "prospect", { rank: 1, domain: "z.example", name: "Z", priority: "high" }, "other_step"),
    ];
    const steps = planFanout({ seq: 20, key: "research_top" }, { kind: "fanout", from: "prospect", missionType: "analyze_company", max: 3 }, f);
    expect(steps.map((s) => [s.seq, s.key, s.required, (s.spec as unknown as { input: { target: { query: string } } }).input.target.query])).toEqual([
      [21, "research_top_1", false, "a.example"],
      [22, "research_top_2", false, "b.example"],
      [23, "research_top_3", false, "c.example"],
    ]);
    expect(planFanout({ seq: 20, key: "research_top" }, { kind: "fanout", from: "prospect", missionType: "analyze_company", max: 1 }, f)).toHaveLength(1);
    expect(planFanout({ seq: 20, key: "research_top" }, { kind: "fanout", from: "prospect", missionType: "analyze_company", max: 3 }, [])).toEqual([]);
  });

  test("compile: counts steps and findings, lists failures, stable ordering", () => {
    const f = [stored("prospect:a.example", "prospect", { rank: 1, domain: "a.example", name: "A", priority: "high" }), stored("gap:own_profile", "profile_gap", { fields: ["markets"] })];
    const s = compileSummary(
      [
        { key: "prospect", kind: "child_run", status: "completed", errorCode: null },
        { key: "research_top_1", kind: "child_run", status: "failed", errorCode: "research_refused" },
        { key: "compile", kind: "compile", status: "leased", errorCode: null },
      ],
      f,
    );
    expect(s).toEqual({
      key: "summary",
      kind: "mission_summary",
      subjectDomain: null,
      payload: { steps: { total: 2, completed: 1, failed: 1, skipped: 0 }, failedSteps: [{ key: "research_top_1", error: "research_refused" }], findings: { profile_gap: 1, prospect: 1 }, prospects: [{ domain: "a.example", name: "A", priority: "high" }], analyses: [], gaps: ["markets"] },
    });
  });
});
