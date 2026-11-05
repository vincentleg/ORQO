/**
 * Phase 17C mission experience (pure): the execution-driver policy (bounded, terminal stop, busy/yielded,
 * errors, auth) and the derivation of phase, progress, title, work cards and the ORQO Briefing from REAL
 * golden mission state (Phase 17B executor + orchestrator in memory) and from failed, stopped, partial and
 * empty missions. Nothing is invented: every briefing line is backed by a step or a finding.
 */
import { describe, expect, test } from "bun:test";
import { analysisCards, buildBriefing, currentStep, failureCode, missionPhase, missionTitle, progressPercent, prospectCards, retryHref, stepLabel, visibleSteps } from "./briefing";
import { DRIVER_LIMITS, initialDriverState, nextDecision, shouldDrive, type DriverDecision, type ExecuteOutcome } from "./driver";
import { goldenView } from "./fixtures";
import type { MissionView } from "./view";

/** Plays a scripted sequence of execute outcomes through the policy, like the live view does. */
function play(outcomes: ExecuteOutcome[]) {
  let st = initialDriverState();
  const decisions: DriverDecision[] = [];
  for (const o of outcomes) {
    const r = nextDecision(st, o);
    st = r.state;
    decisions.push(r.decision);
    if (r.decision.action === "stop") break;
  }
  return decisions;
}
const S = (state: string): ExecuteOutcome => ({ kind: "state", state });

describe("execution driver policy", () => {
  test("yielded continues at once; a terminal state stops", () => {
    const d = play([S("yielded"), S("yielded"), S("completed"), S("yielded")]);
    expect(d).toEqual([
      { action: "execute", delayMs: 0, waiting: false, retrying: false },
      { action: "execute", delayMs: 0, waiting: false, retrying: false },
      { action: "stop", reason: "terminal" },
    ]);
    for (const t of ["failed", "cancelled"]) expect(play([S(t)])).toEqual([{ action: "stop", reason: "terminal" }]);
  });

  test("busy / in_progress / lease_lost / 409 / 429 back off and are bounded", () => {
    const d = play([S("busy"), S("in_progress"), S("lease_lost"), { kind: "http", status: 409 }, { kind: "http", status: 429 }]);
    expect(d.map((x) => (x.action === "execute" ? [x.delayMs, x.waiting] : x.reason))).toEqual([
      [3000, true],
      [6000, true],
      [12000, true],
      [24000, true],
      [30000, true],
    ]);
    const forever = play(Array.from({ length: 30 }, () => S("busy")));
    expect(forever.at(-1)).toEqual({ action: "stop", reason: "waiting" });
    expect(forever).toHaveLength(DRIVER_LIMITS.maxWaits + 1);
    // Progress resets the wait streak.
    expect(play([S("busy"), S("yielded"), S("busy")]).at(-1)).toMatchObject({ delayMs: 3000 });
  });

  test("errors and network failures retry a few times, then stop; auth and access stop at once", () => {
    const errs = play([S("error"), { kind: "network" }, { kind: "http", status: 500 }, { kind: "http", status: 502 }]);
    expect(errs.map((x) => (x.action === "execute" ? x.retrying : x.reason))).toEqual([true, true, true, "errors"]);
    expect(play([{ kind: "http", status: 401 }])).toEqual([{ action: "stop", reason: "unauthenticated" }]);
    expect(play([{ kind: "http", status: 403 }])).toEqual([{ action: "stop", reason: "forbidden" }]);
    expect(play([{ kind: "http", status: 404 }])).toEqual([{ action: "stop", reason: "not_found" }]);
  });

  test("a hard call budget per page session: never an unbounded loop", () => {
    const d = play(Array.from({ length: 100 }, () => S("yielded")));
    expect(d).toHaveLength(DRIVER_LIMITS.maxCalls);
    expect(d.at(-1)).toEqual({ action: "stop", reason: "budget" });
    // Alternating waits and progress still hit the budget.
    expect(play(Array.from({ length: 100 }, (_, i) => S(i % 2 ? "busy" : "yielded"))).at(-1)).toEqual({ action: "stop", reason: "budget" });
  });

  test("only members drive, and only executable missions", () => {
    expect(shouldDrive("planned", true)).toBe(true);
    expect(shouldDrive("running", true)).toBe(true);
    expect(shouldDrive("running", false)).toBe(false);
    for (const s of ["completed", "failed", "cancelled"]) expect(shouldDrive(s, true)).toBe(false);
  });
});

describe("phase, progress and steps from real mission state", () => {
  test("planned → preparing; mid-mission phases follow the real current step", async () => {
    const planned = await goldenView("prospect_and_research", { intent: "customers", researchTop: 2 }, { slices: 0 });
    expect(missionPhase(planned.view)).toBe("preparing");
    expect(progressPercent(planned.view)).toBe(0);
    // One slice: prospecting done, fan-out done, the next step is the first research child.
    const mid = await goldenView("prospect_and_research", { intent: "customers", researchTop: 2 }, { slices: 1 });
    expect(mid.view.mission.status).toBe("running");
    expect(missionPhase(mid.view)).toBe("researching");
    expect(currentStep(mid.view)).toMatchObject({ key: "research_top_1", subject: { query: expect.any(String) } });
    expect(progressPercent(mid.view)).toBe(40); // 2 of 5 steps
    expect(visibleSteps(mid.view).map((s) => stepLabel(s).kind)).toEqual(["prospect", "plan_research", "research", "research", "compile"]);
  });

  test("completed missions: 100%, completed phase; an optional failure shows as completed with gaps", async () => {
    const done = await goldenView("research_company", { target: { query: "strong.example" } });
    expect([missionPhase(done.view), progressPercent(done.view)]).toEqual(["completed", 100]);
    const gaps = await goldenView("prospect_and_research", { intent: "customers", researchTop: 2 }, { prepare: (_s, c) => (c.inject.research_top_1 = () => ({ status: "failed", runId: null, code: "research_refused", retry: false })) });
    expect(gaps.view.mission.status).toBe("completed");
    expect(missionPhase(gaps.view)).toBe("completed_with_gaps");
  });

  test("failed → needs attention; cancelled → stopped; titles come from the founder's input", async () => {
    const failed = await goldenView("research_company", { target: { query: "unknown-target.example" } });
    expect(missionPhase(failed.view)).toBe("needs_attention");
    expect(missionTitle(failed.view)).toEqual({ kind: "research", target: { query: "unknown-target.example" } });
    const stopped = await goldenView("prospect_known_candidates", { intent: "customers", market: "Defense" }, { slices: 0 });
    stopped.store.cancel();
    const v = { ...stopped.view, mission: { ...stopped.view.mission, status: "cancelled" as const } };
    expect(missionPhase(v)).toBe("cancelled");
    expect(missionTitle(v)).toEqual({ kind: "prospect", intent: "customers", market: "Defense", geography: null, objective: null });
  });
});

describe("the ORQO Briefing from real findings", () => {
  test("research: did / matters / next / cards all trace back to the company_analysis finding", async () => {
    const { view } = await goldenView("research_company", { target: { query: "strong.example" } });
    const b = buildBriefing(view);
    const a = analysisCards(view);
    expect(b.compiled).toBe(true);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ domain: "strong.example", evidence: { facts: expect.any(Number) } });
    expect(b.did).toEqual([{ kind: "researched", count: 1, names: [a[0].name] }]);
    const finding = view.findings.find((f) => f.kind === "company_analysis")!;
    const status = finding.payload.analysisStatus as string;
    if (status === "opportunities") expect(b.matters).toContainEqual(expect.objectContaining({ kind: "opportunity", company: a[0].name }));
    else expect(b.matters.some((m) => m.kind === "hypotheses_only" || m.kind === "no_opportunity")).toBe(true);
    expect(b.prospects).toEqual([]);
    expect(b.failedSteps).toEqual([]);
  });

  test("prospect and research: prospects ranked by priority, top ones researched, no duplicate next actions", async () => {
    const { view } = await goldenView("prospect_and_research", { intent: "customers", researchTop: 2 });
    const b = buildBriefing(view);
    const p = prospectCards(view);
    expect(p.length).toBeGreaterThan(0);
    expect(p.map((x) => x.domain)).not.toContain("peer.example");
    const ranks = p.map((x) => ["high", "worth_investigating", "weak"].indexOf(x.priority));
    expect([...ranks].sort((x, y) => x - y)).toEqual(ranks);
    expect(b.did).toEqual([
      { kind: "reviewed", considered: expect.any(Number), presented: p.length },
      { kind: "researched", count: 2, names: expect.any(Array) },
    ]);
    const researched = new Set(b.analyses.map((x) => x.domain));
    // A researched prospect is not also suggested as "look into".
    for (const n of b.next) if (n.kind === "ask" || n.kind === "investigate") expect(researched.has(new URL(n.href, "http://x").searchParams.get("q") ?? "")).toBe(false);
    expect(b.next.length).toBeLessThanOrEqual(5);
    expect(new Set(b.next.map((n) => JSON.stringify(n))).size).toBe(b.next.length);
  });

  test("a failed mission explains the failure and offers to start again with the same input", async () => {
    const { view } = await goldenView("research_company", { target: { query: "unknown-target.example" } });
    const b = buildBriefing(view);
    expect(b.compiled).toBe(false);
    expect(b.failedSteps).toEqual([{ key: "research", error: "research_refused", label: { kind: "research", subject: { query: "unknown-target.example" } } }]);
    expect(b.did).toEqual([{ kind: "incomplete", count: 1 }]);
    expect(b.next).toEqual([{ kind: "retry", href: "/workspace/missions?template=research_company&target=unknown-target.example#delegate" }]);
    expect(failureCode("research_refused")).toBe("research_refused");
    expect(failureCode("weird_internal_thing")).toBe("generic");
  });
});

describe("partial, empty and gap states (hand-built views)", () => {
  const base = (over: Partial<MissionView> & { findings: MissionView["findings"] }): MissionView => ({
    mission: { id: "m", template: "prospect_known_candidates", templateVersion: 1, objective: "x", input: { intent: "suppliers", objective: "rugged GPUs" }, status: "completed", failureReason: null, createdAt: "2026-10-05T10:00:00Z", startedAt: null, finishedAt: "2026-10-05T10:01:00Z" },
    progress: { total: 2, pending: 0, leased: 0, completed: 2, failed: 0, skipped: 0, cancelled: 0 },
    steps: [],
    authority: { maxCostUsd: 0, paidProviders: false, webSearch: false, deepResearch: false },
    spend: { committedUsd: 0, settledUsd: 0, calls: 0 },
    ...over,
  });
  const f = (kind: MissionView["findings"][number]["kind"], key: string, payload: Record<string, unknown>) => ({ id: key, key, kind, subjectDomain: null, stepKey: "prospect", agentRunId: null, payload, createdAt: "" });

  test("zero prospects: says so plainly and proposes broadening — no invented candidates", () => {
    const v = base({ findings: [f("prospecting_summary", "prospecting:prospect", { status: "no_candidates", partialReason: null, funnel: { considered: 0, qualified: 0, weak: 0, rejected: 0 }, presented: 0, nextAction: "broaden" }), f("mission_summary", "summary", {})] });
    const b = buildBriefing(v);
    expect(b.prospects).toEqual([]);
    expect(b.matters).toEqual([{ kind: "no_prospects" }]);
    expect(b.next).toEqual([{ kind: "broaden", href: retryHref(v) }]);
    expect(retryHref(v)).toBe("/workspace/missions?template=prospect_known_candidates&intent=suppliers&objective=rugged+GPUs#delegate");
  });

  test("profile gap: surfaced as a matter and as the first next action", () => {
    const b = buildBriefing(base({ findings: [f("profile_gap", "gap:own_profile", { fields: ["markets", "geographies"] })] }));
    expect(b.gaps).toEqual(["markets", "geographies"]);
    expect(b.matters).toEqual([{ kind: "profile_gap", count: 2 }]);
    expect(b.next[0]).toEqual({ kind: "complete_profile", fields: ["markets", "geographies"], href: "/workspace/company" });
  });

  test("partial prospecting is flagged; a stopped mission says it was stopped", () => {
    const partial = buildBriefing(base({ findings: [f("prospecting_summary", "prospecting:prospect", { status: "partial", partialReason: "budget", funnel: { considered: 4 }, presented: 0 })] }));
    expect(partial.matters).toContainEqual({ kind: "partial", reason: "budget" });
    const stopped = buildBriefing(base({ mission: { ...base({ findings: [] }).mission, status: "cancelled" }, findings: [] }));
    expect(stopped.did).toEqual([{ kind: "stopped" }]);
    expect(stopped.matters).toEqual([]);
    expect(stopped.compiled).toBe(false);
  });

  test("malformed payloads never crash and never produce content", () => {
    const b = buildBriefing(base({ findings: [f("prospect", "prospect:x", { rank: "nope" }), f("company_analysis", "analysis:y", { opportunities: "x" })] }));
    expect(b.prospects[0]).toMatchObject({ priority: "weak", relationship: null, nextQuestion: null });
    expect(b.analyses[0]).toMatchObject({ top: null, opportunities: 0 });
    expect(b.next).toEqual([]);
  });
});
