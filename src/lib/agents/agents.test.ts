import { describe, expect, test } from "bun:test";
import { FEATURES } from "@/lib/entitlements/plans";
import { AgentBudget, AgentBudgetExceeded } from "./budget";
import { MissionTypeSchema, parseMissionInput } from "./contracts";
import { decideMission, decideTool, mayDecideApproval, mayRecommend, type MissionPolicyInput } from "./policy";
import { AGENT_ORDER, AGENT_REGISTRY, CAPABILITIES, childrenOf, getAgent, MISSION_ROUTES, requiredPlan } from "./registry";
import { assertTransition, canTransition, InvalidTransitionError, isTerminal, RUN_TRANSITIONS } from "./state";
import { TOOLS } from "./tools";
import { AGENT_IDS, MISSION_TYPES, RUN_STATUSES, TOOL_IDS } from "./types";

const base: MissionPolicyInput = { agentId: null, missionType: "analyze_company", role: "member", entitledPlan: "free", preview: false, requestedAutonomy: null };

describe("Agent Registry", () => {
  test("defines every Phase 2 agent once, with stable ids and catalog order", () => {
    expect(Object.keys(AGENT_REGISTRY).sort()).toEqual([...AGENT_IDS].sort());
    expect(AGENT_ORDER).toEqual(["orchestrator", "partnership", "sales", "relationship", "research", "prospecting", "followUp", "signal", "event", "technical", "market", "custom"]);
    for (const id of AGENT_IDS) expect(AGENT_REGISTRY[id].id).toBe(id);
    expect(getAgent("toString")).toBeNull();
    expect(getAgent("nope")).toBeNull();
  });

  test("hierarchy: one orchestrator → managers → specialists; every parent exists", () => {
    expect(AGENT_ORDER.filter((a) => AGENT_REGISTRY[a].tier === "orchestrator")).toEqual(["orchestrator"]);
    expect(childrenOf("orchestrator").filter((a) => a.tier === "manager").map((a) => a.id)).toEqual(["partnership", "sales"]);
    for (const a of Object.values(AGENT_REGISTRY)) {
      if (a.parent) expect(AGENT_REGISTRY[a.parent]).toBeDefined();
      if (a.tier === "specialist") expect(a.parent).not.toBeNull();
    }
  });

  test("entitlement metadata matches the plan presentation model", () => {
    for (const a of Object.values(AGENT_REGISTRY)) expect(FEATURES[a.feature]).toBeDefined();
    expect(requiredPlan(AGENT_REGISTRY.research)).toBe("pro");
    expect(requiredPlan(AGENT_REGISTRY.partnership)).toBe("business");
    // The UI availability flag agrees with the registry status.
    for (const a of Object.values(AGENT_REGISTRY)) expect(FEATURES[a.feature].availability === "available").toBe(a.status === "available");
  });

  test("only the Research Agent, Partnership Manager and (Phase 5) Prospecting Agent execute; nobody gets Execute (3)", () => {
    expect(AGENT_ORDER.filter((a) => AGENT_REGISTRY[a].status === "available")).toEqual(["partnership", "research", "prospecting"]);
    for (const a of Object.values(AGENT_REGISTRY)) {
      expect(a.autonomy.max).toBeLessThan(3);
      expect(a.limits.maxRetries).toBe(0);
      if (a.status !== "available") expect([a.tools.length, a.missionTypes.length, a.limits.maxToolCalls]).toEqual([0, 0, 0]);
    }
  });

  test("allowed tools are registered and covered by the agent's capabilities", () => {
    for (const a of Object.values(AGENT_REGISTRY)) {
      for (const t of a.tools) {
        expect(TOOL_IDS).toContain(t);
        expect(a.capabilities.some((c) => CAPABILITIES[c].tools.includes(t))).toBe(true);
      }
    }
    // The Partnership Manager explains stored analysis only: no web, no paid tool.
    expect(AGENT_REGISTRY.partnership.tools.some((t) => TOOLS[t].externalNetwork)).toBe(false);
  });

  test("mission routing is deterministic and owned by agents that accept it", () => {
    for (const t of MISSION_TYPES) expect(AGENT_REGISTRY[MISSION_ROUTES[t].agent].missionTypes).toContain(t);
  });
});

describe("Tool Registry", () => {
  test("variable-cost tools need approval below Execute and a higher autonomy; free tools never do", () => {
    for (const t of Object.values(TOOLS)) {
      if (t.variableCost) {
        expect(t.costClass).toBe("variable");
        expect(t.approval).not.toBe("never");
        expect(t.minAutonomy).toBeGreaterThanOrEqual(2);
      } else expect(t.approval).toBe("never");
      if (!t.externalNetwork) expect(t.limits.maxExternalRequests).toBe(0);
    }
  });
});

describe("mission policy", () => {
  test("Free workspace: every agent is plan-locked", () => {
    expect(decideMission(base)).toEqual({ ok: false, reason: "plan_required", requiredPlan: "pro" });
    expect(decideMission({ ...base, missionType: "explain_opportunities" })).toEqual({ ok: false, reason: "plan_required", requiredPlan: "business" });
  });

  test("Pro unlocks the Research Agent; Business also the Partnership Manager; operator preview unlocks both", () => {
    expect(decideMission({ ...base, entitledPlan: "pro" })).toMatchObject({ ok: true, autonomy: 1, capability: "company_research" });
    expect(decideMission({ ...base, entitledPlan: "pro", missionType: "explain_opportunities" })).toMatchObject({ ok: false, reason: "plan_required" });
    expect(decideMission({ ...base, entitledPlan: "business", missionType: "explain_opportunities" })).toMatchObject({ ok: true, capability: "opportunity_qualification" });
    expect(decideMission({ ...base, preview: true, missionType: "explain_opportunities" })).toMatchObject({ ok: true });
  });

  test("viewer cannot execute; member+ can", () => {
    expect(decideMission({ ...base, preview: true, role: "viewer" })).toMatchObject({ ok: false, reason: "role" });
    for (const role of ["member", "admin", "owner"] as const) expect(decideMission({ ...base, preview: true, role }).ok).toBe(true);
  });

  test("forged agent: unknown, coming soon, or not owning the mission → refused", () => {
    expect(decideMission({ ...base, preview: true, agentId: "superAgent" })).toMatchObject({ reason: "unknown_agent" });
    expect(decideMission({ ...base, preview: true, agentId: "__proto__" })).toMatchObject({ reason: "unknown_agent" });
    expect(decideMission({ ...base, preview: true, agentId: "followUp" })).toMatchObject({ reason: "agent_unavailable" });
    // An available agent cannot take another agent's mission.
    expect(decideMission({ ...base, preview: true, agentId: "prospecting" })).toMatchObject({ reason: "mission_not_supported" });
    expect(decideMission({ ...base, preview: true, agentId: "partnership" })).toMatchObject({ reason: "mission_not_supported" });
  });

  test("forged autonomy above the agent's range (or below) → refused", () => {
    expect(decideMission({ ...base, preview: true, requestedAutonomy: 3 })).toMatchObject({ ok: false, reason: "autonomy_not_allowed" });
    expect(decideMission({ ...base, entitledPlan: "business", requestedAutonomy: 3 })).toMatchObject({ ok: false, reason: "autonomy_not_allowed" });
    expect(decideMission({ ...base, preview: true, requestedAutonomy: 2 })).toMatchObject({ ok: true, autonomy: 2 });
  });

  test("approvals are decided by admins only; Observe never recommends", () => {
    expect(["viewer", "member", "admin", "owner"].map((r) => mayDecideApproval(r as never))).toEqual([false, false, true, true]);
    expect([0, 1, 2, 3].map((l) => mayRecommend(l as never))).toEqual([false, true, true, true]);
  });
});

describe("tool policy", () => {
  const research = AGENT_REGISTRY.research;
  const partnership = AGENT_REGISTRY.partnership;

  test("allowed tool passes; read tools never need approval", () => {
    expect(decideTool(research, "company_research", "read_stored_research", 0)).toEqual({ ok: true, approval: "not_required" });
    expect(decideTool(research, "company_research", "official_site_research", 1)).toEqual({ ok: true, approval: "not_required" });
  });

  test("unregistered, not-granted, out-of-capability and disallowed tools are denied", () => {
    expect(decideTool(research, "company_research", "send_email", 2)).toEqual({ ok: false, reason: "tool_not_registered" });
    expect(decideTool(research, "company_research", "constructor", 2)).toEqual({ ok: false, reason: "tool_not_registered" });
    expect(decideTool(research, "market_research", "read_stored_research", 2)).toEqual({ ok: false, reason: "capability_not_granted" });
    expect(decideTool(research, "business_relevance", "official_site_research", 2)).toEqual({ ok: false, reason: "tool_not_in_capability" });
    expect(decideTool(partnership, "opportunity_qualification", "official_site_research", 2)).toEqual({ ok: false, reason: "tool_not_in_capability" });
  });

  test("autonomy gates tools: Observe cannot fetch; deep research needs Prepare AND approval", () => {
    expect(decideTool(research, "company_research", "official_site_research", 0)).toEqual({ ok: false, reason: "autonomy_too_low" });
    expect(decideTool(research, "company_research", "deep_company_research", 1)).toEqual({ ok: false, reason: "autonomy_too_low" });
    expect(decideTool(research, "company_research", "deep_company_research", 2)).toEqual({ ok: true, approval: "required" });
  });
});

describe("run state machine", () => {
  test("valid transitions", () => {
    for (const [from, to] of [
      ["queued", "running"],
      ["running", "waiting_for_approval"],
      ["waiting_for_approval", "running"],
      ["running", "completed"],
      ["running", "failed"],
      ["queued", "cancelled"],
      ["waiting_for_approval", "cancelled"],
      ["waiting_for_approval", "failed"],
    ] as const)
      expect(canTransition(from, to)).toBe(true);
  });

  test("invalid transitions are rejected; terminal states are final; running cannot be cancelled", () => {
    expect(() => assertTransition("completed", "running")).toThrow(InvalidTransitionError);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("running", "cancelled")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    for (const s of RUN_STATUSES) expect(isTerminal(s)).toBe(["completed", "failed", "cancelled"].includes(s));
    for (const targets of Object.values(RUN_TRANSITIONS)) for (const t of targets) expect(RUN_STATUSES).toContain(t);
  });
});

describe("agent budget", () => {
  const limits = { maxToolCalls: 2, maxModelCalls: 0, maxExternalRequests: 5, maxRetries: 0, maxDurationMs: 1000, maxVariableCostUsd: 0.5 };

  test("reserves each tool's worst case and refuses before exceeding", () => {
    const b = new AgentBudget(limits, () => 0);
    b.reserve(TOOLS.official_site_research);
    expect(b.used).toMatchObject({ toolCalls: 1, externalRequests: 5 });
    expect(() => b.reserve(TOOLS.official_site_research)).toThrow(AgentBudgetExceeded);
    expect(b.used.toolCalls).toBe(1);
    b.reserve(TOOLS.read_stored_research);
    expect(() => b.reserve(TOOLS.read_stored_research)).toThrow(expect.objectContaining({ dimension: "toolCalls" }) as never);
  });

  test("model calls, deadline and reported cost are bounded", () => {
    expect(() => new AgentBudget(limits, () => 0).reserve(TOOLS.deep_company_research)).toThrow(AgentBudgetExceeded);
    let now = 0;
    const b = new AgentBudget(limits, () => now);
    now = 1001;
    expect(() => b.reserve(TOOLS.read_stored_research)).toThrow(expect.objectContaining({ dimension: "duration" }) as never);
    const c = new AgentBudget(limits, () => 0);
    c.addCost(null);
    c.addCost(0.4);
    expect(() => c.addCost(0.2)).toThrow(expect.objectContaining({ dimension: "variableCost" }) as never);
  });
});

describe("mission contracts", () => {
  test("strict input: forged plan, budget, tools, autonomy or organization fields are rejected", () => {
    expect(parseMissionInput("analyze_company", { target: { query: "example.com" } })).toEqual({ target: { query: "example.com" }, depth: "basic", refresh: false });
    for (const forged of [
      { target: { query: "example.com" }, plan: "business" },
      { target: { query: "example.com" }, budget: { maxToolCalls: 999 } },
      { target: { query: "example.com" }, tools: ["deep_company_research"] },
      { target: { query: "example.com", organizationId: "00000000-0000-0000-0000-000000000000" } },
      { target: { query: "" } },
      { target: { companyId: "not-a-uuid" } },
      { target: { query: "example.com" }, depth: "unlimited" },
    ])
      expect(parseMissionInput("analyze_company", forged)).toBeNull();
    expect(MissionTypeSchema.safeParse("send_email").success).toBe(false);
  });
});
