/**
 * Prospecting Agent / discover_companies through the Phase 4 orchestrator,
 * with an in-memory run store (same state machine as the database), fake
 * database and research tools, and the REAL discovery tools. No network,
 * no database, no model, no paid provider.
 */
import { describe, expect, test } from "bun:test";
import { DiscoveryResult, parseMissionInput, type MissionInput } from "@/lib/agents/contracts";
import { decideMission, decideTool } from "@/lib/agents/policy";
import { AGENT_REGISTRY, CAPABILITIES, MISSION_ROUTES } from "@/lib/agents/registry";
import { assertTransition } from "@/lib/agents/state";
import { TOOLS } from "@/lib/agents/tools";
import { TOOL_IDS, type AutonomyLevel, type RunStatus, type StepKey, type ToolId } from "@/lib/agents/types";
import { knownCandidates } from "@/lib/server/discovery/knowledge";
import { INJECTED, PEER_FIXTURE, SERVICES_OWN, STRONG, TIMED, fixtureTarget } from "@/lib/discovery/fixtures";
import type { KnowledgeIndex } from "@/lib/discovery/candidates";
import { DISCOVERY_LIMITS } from "@/lib/discovery/types";
import type { OwnCompanyContext, TargetProfile } from "@/lib/intelligence/types";
import type { CandidateSource } from "@/lib/server/discovery/sources";
import { executeRun, type RunSpec } from "./orchestrator";
import type { RunStore, ToolCallRecord } from "./repository";
import { TOOL_IMPLEMENTATIONS, ToolError, type DiscoveryGateway, type StoredResearch, type ToolImpl } from "./tools";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

class MemoryStore implements RunStore {
  status: RunStatus = "queued";
  approvalState = "not_required";
  steps: { id: string; key: StepKey; status: string; summary: Record<string, unknown> }[] = [];
  calls: ToolCallRecord[] = [];
  approvals: string[] = [];
  result: unknown = null;
  failure: string | null = null;
  private to(s: RunStatus) {
    assertTransition(this.status, s);
    this.status = s;
  }
  async startRun() {
    this.to("running");
  }
  async resumeRun() {
    if (this.approvalState !== "approved") throw new Error("not approved");
    this.to("running");
  }
  async nextStepSeq() {
    return this.steps.length + 1;
  }
  async addStep(_r: string, _seq: number, key: StepKey) {
    const id = crypto.randomUUID();
    this.steps.push({ id, key, status: "running", summary: {} });
    return id;
  }
  async finishStep(id: string, status: "completed" | "failed" | "skipped", summary: Record<string, unknown>) {
    const s = this.steps.find((x) => x.id === id);
    if (!s || s.status !== "running") throw new Error("step final");
    Object.assign(s, { status, summary });
  }
  async addToolCall(_r: string, _s: string | null, c: ToolCallRecord) {
    this.calls.push(c);
  }
  async requestApproval(_r: string, toolId: ToolId) {
    this.to("waiting_for_approval");
    this.approvalState = "required";
    this.approvals.push(toolId);
    return crypto.randomUUID();
  }
  async completeRun(_r: string, _m: string, out: { result: unknown }) {
    this.to("completed");
    this.result = out.result;
  }
  async failRun(_r: string, _m: string, out: { code: string }) {
    this.to("failed");
    this.failure = out.code;
  }
}

interface World {
  own: OwnCompanyContext | null;
  /** Stored research by domain (what ORQO already knows). */
  research: Map<string, StoredResearch>;
  /** Official websites the fake governed research can read; absent → research_failed. */
  sites: Map<string, TargetProfile>;
  knowledge: KnowledgeIndex;
  researchCalls: string[];
  /** The fake research refuses (quota) after this many calls. */
  refuseAfter?: number;
}

const stored = (profile: TargetProfile, ageHours = 1): StoredResearch => ({ id: crypto.randomUUID(), mode: "basic", researchedAt: new Date(Date.now() - ageHours * 3_600_000).toISOString(), profile, hypotheses: [] });

function fakeTools(w: World): Record<ToolId, ToolImpl<never, unknown>> {
  const real = TOOL_IMPLEMENTATIONS as Record<ToolId, ToolImpl<unknown, unknown>>;
  const fake = <I, O>(id: ToolId, run: (input: I) => Promise<O>): ToolImpl<never, unknown> => ({ ...real[id], run: (_env: unknown, input: I) => run(input) }) as unknown as ToolImpl<never, unknown>;
  return {
    ...(TOOL_IMPLEMENTATIONS as Record<ToolId, ToolImpl<never, unknown>>),
    read_workspace_company: fake("read_workspace_company", async () => ({ own: w.own })),
    read_existing_company_knowledge: fake("read_existing_company_knowledge", async () => ({ knowledge: w.knowledge })),
    source_known_candidates: fake("source_known_candidates", async (i: { limit: number }) => ({ candidates: knownCandidates(w.knowledge, i.limit), provider: null, usage: [] })),
    read_stored_research: fake("read_stored_research", async (i: { domain: string }) => ({ research: w.research.get(i.domain) ?? null })),
    official_site_research: {
      ...real.official_site_research,
      precheck: undefined,
      run: async (_env: unknown, i: { query: string }) => {
        w.researchCalls.push(i.query);
        if (w.refuseAfter !== undefined && w.researchCalls.length > w.refuseAfter) throw new ToolError("research_refused", "quota_exhausted");
        const site = w.sites.get(i.query);
        if (!site) throw new ToolError("research_failed", "unreachable");
        w.research.set(site.domain, stored(site, 0));
        return { status: "completed", domain: site.domain, researchRunId: crypto.randomUUID(), usage: [] };
      },
    } as unknown as ToolImpl<never, unknown>,
  };
}

const usageRows: Record<string, unknown>[] = [];
const fakeDb = { from: () => ({ insert: async (row: Record<string, unknown>) => (usageRows.push(row), { error: null }) }) };

function spec(input: unknown, autonomy: AutonomyLevel = 1, approved: ToolId[] = []): RunSpec {
  const parsed = parseMissionInput("discover_companies", input) as MissionInput<"discover_companies">;
  if (!parsed) throw new Error("bad input");
  return { runId: crypto.randomUUID(), missionId: crypto.randomUUID(), agent: AGENT_REGISTRY.prospecting, capability: "prospect_discovery", autonomy, missionType: "discover_companies", input: parsed, approvedTools: approved, resumed: false };
}

async function run(w: World, input: unknown, opts: { autonomy?: AutonomyLevel; gateway?: DiscoveryGateway; clock?: () => number; store?: MemoryStore; fresh?: MemoryStore; approved?: ToolId[] } = {}) {
  const store = opts.store ?? opts.fresh ?? new MemoryStore();
  const s = spec(input, opts.autonomy ?? 1, opts.approved ?? []);
  const outcome = await executeRun(
    { store, tools: fakeTools(w), env: { db: fakeDb as never, organizationId: ORG, userId: crypto.randomUUID(), locale: "en", research: null, discovery: opts.gateway }, clock: opts.clock },
    opts.store ? { ...s, resumed: true } : s,
  );
  return { store, outcome, result: outcome.status === "completed" ? (outcome.result as DiscoveryResult) : null };
}

const now = new Date().toISOString();
const SILENT = fixtureTarget("silent.example", { "/": `<p>Silent Systems designs rugged edge servers and GPU appliances for defense and industrial customers.</p>`, "/products": `<p>The Q-100 rugged server packs four accelerators in a short-depth chassis for harsh environments.</p>` });

/** A workspace that analyzed STRONG and PEER in Search, and recorded SILENT and an unreachable company in its Network. */
function world(over: Partial<World> = {}): World {
  return {
    own: SERVICES_OWN,
    research: new Map([
      ["strong.example", stored(STRONG)],
      ["peer.example", stored(PEER_FIXTURE)],
    ]),
    sites: new Map([["silent.example", SILENT]]),
    knowledge: {
      ownDomain: "own.example",
      network: [
        { id: "33333333-3333-4333-8333-333333333333", name: "Silent Systems", domain: "silent.example", addedAt: now },
        { id: "44444444-4444-4444-8444-444444444444", name: "Ghost Co", domain: "ghost.example", addedAt: now },
        { id: "55555555-5555-4555-8555-555555555555", name: "Strong Systems", domain: "strong.example", addedAt: now },
      ],
      analyses: [
        { domain: "strong.example", name: "Strong Systems", researchedAt: now, mode: "basic" },
        { domain: "peer.example", name: "Peer Labs", researchedAt: now, mode: "basic" },
      ],
      decisions: [],
    },
    researchCalls: [],
    ...over,
  };
}

describe("Prospecting Agent — registry and policy", () => {
  test("registered, routed deterministically, Pro (or preview) only, never Execute", () => {
    expect(MISSION_ROUTES.discover_companies).toEqual({ agent: "prospecting", capability: "prospect_discovery" });
    const a = AGENT_REGISTRY.prospecting;
    expect(a.status).toBe("available");
    expect(a.missionTypes).toEqual(["discover_companies"]);
    expect(a.autonomy.max).toBe(2);
    expect(a.modelTasks).toEqual([]);
    const base = { agentId: null, missionType: "discover_companies" as const, role: "member" as const, entitledPlan: "free" as const, preview: false, requestedAutonomy: null };
    expect(decideMission(base)).toMatchObject({ ok: false, reason: "plan_required", requiredPlan: "pro" });
    expect(decideMission({ ...base, preview: true })).toMatchObject({ ok: true, capability: "prospect_discovery", autonomy: 1 });
    expect(decideMission({ ...base, entitledPlan: "pro" })).toMatchObject({ ok: true });
    expect(decideMission({ ...base, preview: true, role: "viewer" })).toMatchObject({ reason: "role" });
    expect(decideMission({ ...base, preview: true, requestedAutonomy: 3 })).toMatchObject({ reason: "autonomy_not_allowed" });
    expect(decideMission({ ...base, preview: true, agentId: "research" })).toMatchObject({ reason: "mission_not_supported" });
  });

  test("tools: only discovery tools, paid search needs Prepare and approval, no deep research or model", () => {
    const a = AGENT_REGISTRY.prospecting;
    for (const t of a.tools) expect(CAPABILITIES.prospect_discovery.tools).toContain(t);
    expect(decideTool(a, "prospect_discovery", "deep_company_research", 2)).toEqual({ ok: false, reason: "tool_not_in_capability" });
    expect(decideTool(a, "prospect_discovery", "send_email", 2)).toEqual({ ok: false, reason: "tool_not_registered" });
    expect(decideTool(a, "prospect_discovery", "search_web_candidates", 1)).toEqual({ ok: false, reason: "autonomy_too_low" });
    expect(decideTool(a, "prospect_discovery", "search_web_candidates", 2)).toEqual({ ok: true, approval: "required" });
    expect(decideTool(a, "prospect_discovery", "official_site_research", 0)).toEqual({ ok: false, reason: "autonomy_too_low" });
    expect(decideTool(AGENT_REGISTRY.research, "company_research", "search_web_candidates", 2)).toEqual({ ok: false, reason: "tool_not_in_capability" });
    // Every registered tool has an implementation, and every discovery tool declares cost and network honestly.
    for (const id of TOOL_IDS) expect(TOOL_IMPLEMENTATIONS[id]).toBeDefined();
    expect(TOOLS.search_web_candidates).toMatchObject({ costClass: "variable", externalNetwork: true, variableCost: true });
    for (const id of ["build_discovery_plan", "deduplicate_candidates", "qualify_candidate", "apply_discovery_critic"] as const) expect(TOOLS[id]).toMatchObject({ costClass: "none", externalNetwork: false });
    // Worst case of the bounded plan fits the agent budget.
    const L = a.limits;
    expect(TOOLS.search_web_candidates.limits.maxExternalRequests + DISCOVERY_LIMITS.maxNewResearch * TOOLS.official_site_research.limits.maxExternalRequests).toBeLessThanOrEqual(L.maxExternalRequests);
    expect(5 + DISCOVERY_LIMITS.maxVerified + 2 * DISCOVERY_LIMITS.maxNewResearch + DISCOVERY_LIMITS.maxVerified + 2).toBeLessThanOrEqual(L.maxToolCalls);
  });
});

describe("discover_companies — workspace knowledge source", () => {
  test("plan → knowledge → candidates → dedup → verify → qualify → critic → result, with real step order", async () => {
    const w = world();
    const { store, outcome, result } = await run(w, { intent: "customers" });
    expect(outcome.status).toBe("completed");
    expect(store.steps.map((s) => s.key)).toEqual(["load_workspace_context", "build_discovery_plan", "read_existing_knowledge", "find_candidates", "deduplicate_candidates", "verify_candidates", "qualify_candidates", "apply_critic", "produce_result"]);
    expect(DiscoveryResult.safeParse(result).success).toBe(true);
    const r = result!;
    expect(r.source).toEqual({ id: "workspace_knowledge", provider: null, live: false });
    // A — qualified, with evidence, network marker and reused research.
    const strong = r.companies.find((c) => c.domain === "strong.example");
    expect(strong?.network?.companyId).toBe("55555555-5555-4555-8555-555555555555");
    expect(strong?.research.reused).toBe(true);
    expect(strong?.evidence.length).toBeGreaterThan(0);
    // F — Network company without research: verified by ONE governed official-site analysis.
    expect(w.researchCalls).toEqual(expect.arrayContaining(["silent.example", "ghost.example"]));
    expect(r.companies.find((c) => c.domain === "silent.example")?.research.reused).toBe(false);
    // B — no mechanism: rejected with a reason. G — unreachable site: identity unverified, never presented.
    expect(r.rejected.find((x) => x.domain === "peer.example")?.reason).toMatch(/no_concrete_mechanism|insufficient_evidence|category_overlap_only/);
    expect(r.rejected.find((x) => x.domain === "ghost.example")).toMatchObject({ stage: "verification", reason: "identity_unverified", inNetwork: true });
    expect(r.companies.some((c) => c.domain === "ghost.example" || c.domain === "peer.example")).toBe(false);
    // Stored knowledge is used first: no research for companies already analyzed.
    expect(w.researchCalls).not.toContain("strong.example");
    expect(r.funnel).toMatchObject({ sourced: 4, duplicates: 0, considered: 4, verified: 3 });
    expect(r.nextAction?.kind).toBe("investigate");
    // No model, no paid provider, nothing variable-cost.
    expect(store.calls.some((c) => c.costClass === "variable")).toBe(false);
    expect(outcome.counters.modelCalls).toBe(0);
  });

  test("Observe never fetches the web: unknown companies stay unverified and no action is proposed", async () => {
    const w = world();
    const { result } = await run(w, { intent: "customers" }, { autonomy: 0 });
    expect(w.researchCalls).toEqual([]);
    expect(result?.unverified.map((u) => u.reason)).toEqual(["observe_only", "observe_only"]);
    expect(result?.nextAction).toBeNull();
    expect(result?.companies.every((c) => c.nextQuestion === null)).toBe(true);
  });

  test("plan infeasible: nothing is sourced, the missing profile fields are named", async () => {
    const w = world();
    const { store, result } = await run(w, { intent: "suppliers" });
    expect(result?.status).toBe("plan_infeasible");
    expect(result?.nextAction).toMatchObject({ kind: "complete_profile", fields: expect.arrayContaining(["soughtCapabilities"]) });
    expect(store.calls.map((c) => c.toolId)).toEqual(["read_workspace_company", "build_discovery_plan"]);
  });

  test("own profile missing fails truthfully before any work", async () => {
    const { outcome, store } = await run(world({ own: null }), {});
    expect(outcome).toMatchObject({ status: "failed", code: "own_profile_missing" });
    expect(store.calls).toHaveLength(1);
  });

  test("verification is bounded: at most 3 new analyses, the rest reported unverified", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: crypto.randomUUID(), name: `Co ${i}`, domain: `co${i}.example`, addedAt: now }));
    const w = world({ research: new Map(), sites: new Map(many.map((c) => [c.domain, fixtureTarget(c.domain, { "/": `<p>${c.name} designs rugged edge servers and GPU appliances for defense and industrial customers.</p>`, "/products": `<p>The X-100 rugged server packs four accelerators in a short-depth chassis for harsh environments.</p>` }, c.name)])) });
    w.knowledge = { ...w.knowledge, network: many, analyses: [] };
    const { result, outcome } = await run(w, { intent: "customers" });
    expect(w.researchCalls).toHaveLength(DISCOVERY_LIMITS.maxNewResearch);
    expect(result?.funnel.verified).toBe(3);
    expect(result?.unverified.every((u) => u.reason === "verification_limit")).toBe(true);
    expect(result?.partialReason).toBe("verification_limit");
    expect(outcome.counters.externalRequests).toBeLessThanOrEqual(AGENT_REGISTRY.prospecting.limits.maxExternalRequests);
    expect(outcome.counters.toolCalls).toBeLessThanOrEqual(AGENT_REGISTRY.prospecting.limits.maxToolCalls);
  });

  test("time budget: no new analysis starts without enough time left → labeled partial result", async () => {
    // Time jumps to 100 s (of 130 s) when verification starts: 30 s left < the 45 s a new analysis needs.
    let late = false;
    const fresh = new MemoryStore();
    const addStep = fresh.addStep.bind(fresh);
    fresh.addStep = async (r, seq, key) => ((late ||= key === "verify_candidates"), addStep(r, seq, key));
    const { result } = await run(world(), { intent: "customers" }, { clock: () => (late ? 100_000 : 0), fresh });
    expect(result?.status).toBe("partial");
    expect(result?.partialReason).toBe("budget");
    expect(result?.unverified.some((u) => u.reason === "budget")).toBe(true);
  });

  test("a quota refusal stops verification and is reported, not hidden", async () => {
    const { result } = await run(world({ refuseAfter: 0 }), { intent: "customers" });
    expect(result?.partialReason).toBe("verification_refused");
    expect(result?.unverified.map((u) => u.reason)).toContain("verification_refused");
  });

  test("rejection memory skips a recently rejected company unless re-evaluation is asked", async () => {
    const w = world();
    w.knowledge = { ...w.knowledge, analyses: w.knowledge.analyses.map((a) => ({ ...a, researchedAt: new Date(Date.now() - 86_400_000 * 2).toISOString() })), decisions: [{ domain: "peer.example", reason: "no_concrete_mechanism", at: new Date(Date.now() - 86_400_000).toISOString() }] };
    const a = await run(w, { intent: "customers" });
    expect(a.result?.rejected.find((x) => x.domain === "peer.example")).toMatchObject({ stage: "sourcing", reason: "previously_rejected", previous: { reason: "no_concrete_mechanism" } });
    const b = await run(world({ knowledge: w.knowledge }), { intent: "customers", reevaluate: true });
    expect(b.result?.rejected.find((x) => x.domain === "peer.example")?.stage).toBe("qualification");
  });

  test("J. prompt-injected page text cannot change tools, autonomy, approvals or priority", async () => {
    const w = world({ research: new Map([["injected.example", stored(INJECTED)]]) });
    w.knowledge = { ...w.knowledge, network: [], analyses: [{ domain: "injected.example", name: "Injected", researchedAt: now, mode: "basic" }] };
    const { store, result } = await run(w, { intent: "customers" });
    expect(store.calls.map((c) => c.toolId)).not.toContain("search_web_candidates");
    expect(store.approvals).toEqual([]);
    expect(store.calls.every((c) => c.outcome === "succeeded")).toBe(true);
    const leaked = JSON.stringify(result);
    expect(leaked).not.toContain(OTHER_ORG);
    expect(result?.companies[0]?.nextQuestion ?? "").not.toMatch(/ignore|autonomy/i);
  });

  test("I. Why now appears only with dated evidence", async () => {
    const w = world({ own: { ...SERVICES_OWN, markets: ["Europe"] }, research: new Map([["timed.example", stored(TIMED)], ["strong.example", stored(STRONG)]]) });
    w.knowledge = { ...w.knowledge, network: [], analyses: [{ domain: "timed.example", name: "Timed", researchedAt: now, mode: "basic" }, { domain: "strong.example", name: "Strong", researchedAt: now, mode: "basic" }] };
    const { result } = await run(w, { intent: "customers" });
    expect(result?.companies.find((c) => c.domain === "timed.example")?.whyNow.length).toBeGreaterThan(0);
    expect(result?.companies.find((c) => c.domain === "strong.example")?.whyNow).toEqual([]);
    // Dated timing ranks first among equals.
    expect(result?.companies[0].domain).toBe("timed.example");
  });
});

describe("discover_companies — web search source (paid)", () => {
  const hits = (domains: string[]): CandidateSource => ({
    id: "web_search",
    provider: "fixture",
    async find(queries) {
      return {
        candidates: domains.map((d, i) => ({ name: `${d.split(".")[0]} | Rugged hardware`, url: `https://${d}/p${i}`, hint: `Search snippet for ${d}`, source: "web_search" as const })),
        usage: queries.map(() => ({ provider: "fixture", service: "web/search", operation: "web_search" as const, succeeded: true, units: { queries: 1 }, costUsd: null })),
      };
    },
  });
  let providerCalls = 0;
  const gateway = (entitled: boolean, configured: boolean, domains: string[] = []): DiscoveryGateway => ({
    webEntitled: async () => entitled,
    webSource: () => {
      if (!configured) return null;
      const s = hits(domains);
      return { ...s, find: (q) => ((providerCalls += 1), s.find(q)) };
    },
  });

  test("Recommend autonomy cannot reach the paid tool", async () => {
    const { outcome } = await run(world(), { source: "web_search" }, { autonomy: 1, gateway: gateway(true, true) });
    expect(outcome).toMatchObject({ status: "failed", code: "tool_denied" });
  });

  test("no provider configured → truthful failure, no approval requested, no provider call", async () => {
    providerCalls = 0;
    const { outcome, store } = await run(world(), { source: "web_search" }, { autonomy: 2, gateway: gateway(true, false) });
    expect(outcome).toMatchObject({ status: "failed", code: "provider_not_configured" });
    expect(store.approvals).toEqual([]);
    expect(providerCalls).toBe(0);
  });

  test("not entitled (Free or agent preview only) → refused before approval and before any provider call", async () => {
    providerCalls = 0;
    const { outcome, store } = await run(world(), { source: "web_search" }, { autonomy: 2, gateway: gateway(false, true) });
    expect(outcome).toMatchObject({ status: "failed", code: "search_not_permitted" });
    expect(store.approvals).toEqual([]);
    expect(providerCalls).toBe(0);
  });

  test("absent gateway means no paid discovery at all", async () => {
    const { outcome } = await run(world(), { source: "web_search" }, { autonomy: 2 });
    expect(outcome).toMatchObject({ status: "failed", code: "search_not_permitted" });
  });

  test("entitled + configured → waits for approval with nothing spent; once approved, snippets stay hints and usage is attributed", async () => {
    providerCalls = 0;
    usageRows.length = 0;
    const gw = gateway(true, true, ["strong.example", "www.strong.example", "linkedin.com", "own.example", "silent.example"]);
    const w = world();
    const store = new MemoryStore();
    const first = await run(w, { source: "web_search", intent: "customers" }, { autonomy: 2, gateway: gw });
    expect(first.outcome.status).toBe("waiting_for_approval");
    expect(first.store.approvals).toEqual(["search_web_candidates"]);
    expect(providerCalls).toBe(0);

    // Resume as the server does: approval read from the database, tool listed in approvedTools.
    store.status = "waiting_for_approval";
    store.approvalState = "approved";
    const second = await run(w, { source: "web_search", intent: "customers" }, { autonomy: 2, gateway: gw, store, approved: ["search_web_candidates"] });
    expect(second.outcome.status).toBe("completed");
    expect(providerCalls).toBe(1);
    const r = second.result!;
    expect(r.source).toEqual({ id: "web_search", provider: "fixture", live: true });
    expect(r.funnel.duplicates).toBe(1);
    expect(r.rejected.map((x) => x.reason)).toEqual(expect.arrayContaining(["not_a_company_site", "own_company"]));
    const strong = r.companies.find((c) => c.domain === "strong.example");
    expect(strong?.hints[0]).toContain("Search snippet");
    // The snippet is never evidence: evidence comes from the retrieved official pages only.
    expect(strong?.evidence.every((e) => !e.text.includes("Search snippet") && e.url?.startsWith("https://strong.example"))).toBe(true);
    expect(usageRows.length).toBeGreaterThan(0);
    expect(usageRows.every((u) => u.agent_run_id && u.research_run_id === null && u.cost_usd === null && u.organization_id === ORG)).toBe(true);
    expect(store.calls.find((c) => c.toolId === "search_web_candidates" && c.outcome === "succeeded")?.costClass).toBe("variable");
  });
});
