/**
 * Tracked opportunity model (Phase 16A), pure and shared: the server repository persists it, the product and
 * the public guided tour render it. Nothing here touches a database.
 */
import type { Dossier } from "@/lib/understanding/dossier";
import type { RelationshipAssessment } from "@/lib/understanding/relationship";
import type { Scenario } from "@/lib/understanding/scenarios";

export const TRACKED_STATUSES = ["investigating", "validated", "paused", "closed"] as const;
export type TrackedStatus = (typeof TRACKED_STATUSES)[number];

const TEXT_MAX = 300;
const clip = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s);

/** What ORQO knew when the opportunity was tracked. Built by the server from its own dossier. */
export interface TrackedSnapshot {
  v: 1;
  ownName: string;
  targetName: string;
  asOf: string | null;
  scenario: Scenario;
  relationship: Pick<RelationshipAssessment, "status" | "roles"> & { links: { role: string; state: string; source: string; statement: string | null }[] };
}

export interface TrackedOpportunity {
  id: string;
  targetCompanyId: string;
  targetName: string;
  scenarioKey: string;
  mechanism: string;
  status: TrackedStatus;
  snapshot: TrackedSnapshot;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** The snapshot keeps the scenario as computed, with long texts clipped (evidence is quoted, not copied). */
export function snapshotOf(d: Dossier, s: Scenario): TrackedSnapshot {
  const support = (c: Scenario["contributions"]["provider"]) => ({ ...c, support: c.support.slice(0, 6).map((x) => ({ ...x, value: clip(x.value) })) });
  return {
    v: 1,
    ownName: d.ownName,
    targetName: d.targetName,
    asOf: d.asOf,
    scenario: { ...s, contributions: { provider: support(s.contributions.provider), partner: support(s.contributions.partner) }, whyNow: s.whyNow.map((w) => ({ ...w, statement: clip(w.statement) })) },
    relationship: { status: d.relationship.status, roles: d.relationship.roles, links: d.relationship.links.map((l) => ({ role: l.role, state: l.state, source: l.source, statement: l.statement ? clip(l.statement) : null })) },
  };
}
