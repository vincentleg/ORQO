import { DEMO_NOW } from "@/lib/data/seed";
import type { World } from "@/lib/domain/types";
import { evaluateRelationship, type RelationshipEvaluation } from "@/lib/engine/pipeline";
import { buildInitialWorld } from "@/lib/engine/world";

/**
 * What the unchanged engine concludes for a demo relationship, in the demo's
 * own in-memory world. Production has no signal ingestion yet (a later phase),
 * so the reference drops the demo's seeded signals to compare like with like.
 */
export function referenceEvaluation(seedRelationshipId: string): { world: World; result: RelationshipEvaluation } {
  const world = buildInitialWorld();
  world.signals = {};
  world.now = DEMO_NOW;
  return { world, result: evaluateRelationship(world, seedRelationshipId) };
}

/** Company-name based projection of a draft, independent of ids, for cross-store comparison. */
export function comparable(world: World, draft: RelationshipEvaluation["passing"][number]["draft"], critique: RelationshipEvaluation["passing"][number]["critique"]) {
  const name = (id: string) => world.companies[id]?.name ?? id;
  return {
    title: draft.title,
    types: draft.types,
    summary: draft.summary,
    whyExists: draft.whyExists,
    whyNow: draft.whyNow,
    structure: draft.structure,
    contributions: draft.contributions.map((c) => ({ company: name(c.companyId), role: c.role, items: c.items })),
    evidence: draft.evidence.map((e) => ({ claim: e.claim, epistemic: e.epistemic, visibility: e.visibility, company: name(e.companyId) })),
    missingCapabilities: draft.missingCapabilities,
    verdict: critique.report.verdict,
    checks: critique.report.checks.map((c) => ({ id: c.id, result: c.result, note: c.note })),
    confidence: critique.confidence,
  };
}
