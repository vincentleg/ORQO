import { describe, expect, test } from "bun:test";
import { AGENTS, AGENT_KEYS } from "./agents";
import { FEATURES, PLAN_COMPARISON, PLAN_COMPARISON_ROWS, PLANS, featureAccess, isPlan, planAtLeast, upgradeTarget, type FeatureKey } from "./plans";

describe("plans", () => {
  test("ordering", () => {
    expect(planAtLeast("free", "free")).toBe(true);
    expect(planAtLeast("free", "pro")).toBe(false);
    expect(planAtLeast("pro", "free")).toBe(true);
    expect(planAtLeast("pro", "business")).toBe(false);
    expect(planAtLeast("business", "pro")).toBe(true);
    expect(isPlan("pro")).toBe(true);
    expect(isPlan("enterprise")).toBe(false);
  });

  test("free features are never locked", () => {
    for (const key of Object.keys(FEATURES) as FeatureKey[]) {
      if (FEATURES[key].minPlan === "free") expect(featureAccess("free", key).state).not.toBe("locked");
    }
  });

  test("premium features lock on Free and name the required plan", () => {
    expect(featureAccess("free", "agents.prospecting")).toEqual({ state: "locked", feature: "agents.prospecting", requiredPlan: "pro" });
    expect(featureAccess("pro", "agents.orchestrator")).toEqual({ state: "locked", feature: "agents.orchestrator", requiredPlan: "business" });
    expect(upgradeTarget("free", "agents.orchestrator")).toBe("business");
    expect(upgradeTarget("business", "agents.orchestrator")).toBeNull();
  });

  test("an entitled but unbuilt feature presents as coming soon, never as available", () => {
    expect(featureAccess("pro", "agents.prospecting").state).toBe("coming_soon");
    expect(featureAccess("business", "agents.orchestrator").state).toBe("coming_soon");
    expect(featureAccess("free", "network.companies").state).toBe("available");
  });

  test("no agent is presented as runnable in Phase 2", () => {
    for (const plan of PLANS) for (const agent of AGENTS) expect(featureAccess(plan, agent.feature).state).not.toBe("available");
  });

  test("agent catalog is complete and unique", () => {
    expect(new Set(AGENTS.map((a) => a.key)).size).toBe(AGENTS.length);
    expect([...AGENTS.map((a) => a.key)].sort()).toEqual([...AGENT_KEYS].sort());
    expect(AGENTS.filter((a) => a.tier === "orchestrator")).toHaveLength(1);
  });

  test("comparison covers every row and plan, and higher plans never offer less", () => {
    const order = ["none", "essentials", "limited", "included", "expanded", "advanced"];
    for (const row of PLAN_COMPARISON_ROWS) {
      const levels = PLANS.map((p) => order.indexOf(PLAN_COMPARISON[row][p]));
      expect(levels.every((l) => l >= 0)).toBe(true);
      expect(levels[1]).toBeGreaterThanOrEqual(levels[0]);
      expect(levels[2]).toBeGreaterThanOrEqual(levels[1]);
    }
  });
});
