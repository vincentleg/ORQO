import { describe, expect, test } from "bun:test";
import { DEMO_FUTURE, futureSignal } from "@/lib/data/seed";
import { discoverMultiParty, createFromProposal } from "./network";
import { respond, stageFor } from "./orchestration";
import { commitEvaluation, evaluateRelationship } from "./pipeline";
import { applySignal, reevaluate } from "./reevaluation";
import { buildInitialWorld } from "./world";

const OEM = "opp-oem-appliance-edgevision-eurocompute";
const CHANNEL = "opp-channel-distribution-edgevision-securechannel";

function connected() {
  const world = buildInitialWorld();
  return commitEvaluation(world, evaluateRelationship(world, "r-maya-lukas"), { kind: "connection" }).world;
}

function afterSignal() {
  const world = connected();
  world.now = DEMO_FUTURE;
  return reevaluate(applySignal(world, futureSignal), futureSignal.id);
}

describe("initial network", () => {
  test("SecureChannel relationship starts dormant: critic held the channel idea back", () => {
    const world = buildInitialWorld();
    const rel = world.relationships["r-maya-sophie"];
    expect(rel.status).toBe("dormant");
    expect(rel.evaluations[0].rejectedHypotheses.map((h) => h.patternId)).toContain("channel-distribution");
    expect(rel.evaluations[0].watchConditions.map((w) => w.tags).flat()).toContain("eu-support");
  });

  test("marketing-language need is rejected", () => {
    const world = buildInitialWorld();
    const h = world.relationships["r-maya-rosa"].evaluations[0].rejectedHypotheses[0];
    expect(h.verdict).toBe("reject");
  });

  test("stale exploratory need is weak, not an opportunity", () => {
    const world = buildInitialWorld();
    expect(world.relationships["r-maya-daniel"].evaluations[0].rejectedHypotheses[0].verdict).toBe("weak");
  });
});

describe("connect agents", () => {
  test("EdgeVision + EuroCompute yields the European Edge AI Appliance Partnership", () => {
    const world = buildInitialWorld();
    const result = evaluateRelationship(world, "r-maya-lukas");
    expect(result.passing.map((p) => p.draft.title)).toEqual(["European Edge AI Appliance Partnership"]);
    expect(result.passing[0].critique.confidence.level).toBe("moderate");
    expect(result.passing[0].draft.missingCapabilities).toContain("eu-enterprise-distribution");
  });

  test("no 3-way proposal while the distribution need is exploratory", () => {
    expect(discoverMultiParty(connected()).proposals).toHaveLength(0);
  });
});

describe("bilateral consent", () => {
  test("one response stays private; both Interested creates a match and brief", () => {
    const first = respond(connected(), OEM, "p-maya", "interested");
    expect(first.matched).toBe(false);
    expect(stageFor(first.world, first.world.opportunities[OEM], "p-lukas")).toBe("discovered");
    expect(stageFor(first.world, first.world.opportunities[OEM], "p-maya")).toBe("interested");
    const second = respond(first.world, OEM, "p-lukas", "interested");
    expect(second.matched).toBe(true);
    expect(second.world.briefs[OEM].agenda.length).toBeGreaterThan(2);
  });
});

describe("fast forward +6 months", () => {
  test("signal re-activates the dormant SecureChannel relationship and strengthens the OEM deal", () => {
    const { world, report } = afterSignal();
    const affected = report.scans.filter((s) => s.affected).map((s) => s.relationshipId);
    expect(affected.sort()).toEqual(["r-maya-lukas", "r-maya-sophie"]);
    expect(report.created).toEqual([CHANNEL]);
    expect(report.strengthened).toEqual([OEM]);
    expect(world.opportunities[CHANNEL].delta?.whyNotBefore).toContain("EU-based support");
  });

  test("network search covers every participant's network, not just the current viewer's", () => {
    let world = connected();
    world = respond(world, OEM, "p-maya", "interested").world;
    world = respond(world, OEM, "p-lukas", "interested").world;
    world.viewerId = "p-lukas";
    world.now = DEMO_FUTURE;
    const { world: after } = reevaluate(applySignal(world, futureSignal), futureSignal.id);
    const { proposals } = discoverMultiParty(after, futureSignal);
    expect(proposals.map((p) => p.candidateCompanyId)).toEqual(["c-securechannel"]);
    expect(proposals[0].opportunity.delta?.whyNowRelevant).toContain("Maya Chen's network");
  });

  test("network search finds SecureChannel and composes a 3-way program", () => {
    const { world } = afterSignal();
    const { world: next, proposals } = discoverMultiParty(world, futureSignal);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].candidateCompanyId).toBe("c-securechannel");
    expect(proposals[0].opportunity.critic.verdict).toBe("pass");
    const created = createFromProposal(next, proposals[0].id);
    const opp = created.opportunities[proposals[0].opportunity.id];
    expect(opp.companyIds).toHaveLength(3);
    expect(opp.title).toBe("European Edge AI Appliance Program");
  });
});
