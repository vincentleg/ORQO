import type { World } from "@/lib/domain/types";
import { DEMO_NOW, VIEWER_ID, preEvaluated, seedCompanies, seedPeople, seedRelationships, seedSignals, seedSources } from "@/lib/data/seed";
import { commitEvaluation, evaluateRelationship, logActivity } from "./pipeline";

const byId = <T extends { id: string }>(xs: T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]));

/**
 * Builds the demo world. Relationships evaluated "in the past" are run through
 * the real pipeline at their historical timestamps, so their dormant state and
 * watch conditions are engine output rather than hand-written data.
 */
export function buildInitialWorld(): World {
  let world: World = {
    now: DEMO_NOW,
    viewerId: VIEWER_ID,
    people: byId(structuredClone(seedPeople)),
    companies: byId(structuredClone(seedCompanies)),
    sources: byId(structuredClone(seedSources)),
    relationships: byId(structuredClone(seedRelationships)),
    opportunities: {},
    consents: [],
    briefs: {},
    signals: byId(structuredClone(seedSignals)),
    outcomes: [],
    activity: [],
    proposals: {},
  };

  for (const { relationshipId, at } of [...preEvaluated].sort((a, b) => a.at.localeCompare(b.at))) {
    world.now = at;
    logActivity(world, "orchestration", `Agents connected: ${relationshipLabel(world, relationshipId)}`, [relationshipId]);
    world = commitEvaluation(world, evaluateRelationship(world, relationshipId), { kind: "connection" }).world;
  }
  world.now = DEMO_NOW;
  return world;
}

export function relationshipLabel(world: World, relationshipId: string): string {
  const r = world.relationships[relationshipId];
  return r.personIds.map((p) => world.people[p].name).join(" ↔ ");
}
