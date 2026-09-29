/**
 * Signal Monitoring & Re-Evaluation. Applies a company signal to the graph,
 * determines which existing relationships it touches (via the watch conditions
 * the Critic left behind and the tags of live opportunities), and re-runs the
 * pipeline on exactly those relationships.
 */
import type { Evaluation, Signal, WatchCondition, World } from "@/lib/domain/types";
import { tagLabel, type Tag } from "@/lib/domain/taxonomy";
import { isUrgent, lowerFirst, offersAny, uniq } from "./context";
import { commitEvaluation, evaluateRelationship, logActivity } from "./pipeline";

export interface RelationshipScan {
  relationshipId: string;
  affected: boolean;
  reasons: string[];
}

export interface ReevaluationReport {
  signalId: string;
  scans: RelationshipScan[];
  created: string[];
  strengthened: string[];
  unchanged: string[];
}

export function signalTags(signal: Signal, world: World): Tag[] {
  const company = world.companies[signal.companyId];
  const fromCaps = (signal.effect.addCapabilities ?? []).flatMap((c) => c.tags);
  const fromNeeds = (signal.effect.escalateNeeds ?? []).flatMap((e) => company.needs.find((n) => n.id === e.needId)?.tags ?? []);
  return uniq([...fromCaps, ...fromNeeds]);
}

/** Returns a new world with the signal's effects written into the company graph. */
export function applySignal(input: World, signal: Signal): World {
  const world = structuredClone(input);
  const company = world.companies[signal.companyId];
  const { addCapabilities = [], escalateNeeds = [], addObjectives = [], addGeographies = [] } = signal.effect;
  company.offers = [...company.offers.filter((c) => !addCapabilities.some((a) => a.id === c.id)), ...addCapabilities];
  company.needs = company.needs.map((n) => {
    const e = escalateNeeds.find((x) => x.needId === n.id);
    return e
      ? { ...n, intensity: e.intensity, evidence: [...n.evidence, e.evidence], observedAt: signal.occurredAt, disclosure: e.disclosure ?? n.disclosure }
      : n;
  });
  company.objectives = [...company.objectives, ...addObjectives.filter((o) => !company.objectives.some((x) => x.id === o.id))];
  company.geographies = uniq([...company.geographies, ...addGeographies]);
  world.signals[signal.id] = { ...signal };
  logActivity(world, "reevaluation", `Signal detected: ${signal.headline}`, [signal.id, company.id]);
  return world;
}

function conditionMet(world: World, w: WatchCondition): boolean {
  const company = world.companies[w.companyId];
  if (w.kind === "capability") return offersAny(company, w.tags);
  return company.needs.some((n) => isUrgent(n) && n.tags.some((t) => w.tags.includes(t)));
}

function latest(evaluations: Evaluation[]): Evaluation | undefined {
  return evaluations[evaluations.length - 1];
}

/** Which evaluated relationships a signal could change, and why. */
export function scanRelationships(world: World, signal: Signal): RelationshipScan[] {
  const tags = signalTags(signal, world);
  return Object.values(world.relationships)
    .filter((r) => r.evaluations.length > 0)
    .map((r) => {
      const last = latest(r.evaluations);
      const reasons: string[] = [];
      for (const w of last?.watchConditions ?? []) {
        if (conditionMet(world, w)) reasons.push(`Watch condition met: ${w.description}`);
      }
      for (const oppId of last?.opportunityIds ?? []) {
        const opp = world.opportunities[oppId];
        if (!opp) continue;
        const needs = opp.companyIds.flatMap((id) => world.companies[id].needs).filter((n) => opp.drivingNeedIds.includes(n.id));
        const touched = uniq([...needs.flatMap((n) => n.tags), ...opp.missingCapabilities].filter((t) => tags.includes(t)));
        if (touched.length > 0) reasons.push(`${opp.title} depends on ${touched.slice(0, 3).map((t) => lowerFirst(tagLabel(t))).join(", ")}`);
      }
      if (reasons.length === 0) {
        const other = world.companies[r.companyIds.find((id) => id !== signal.companyId) ?? r.companyIds[1]];
        reasons.push(`Nothing in the ${other.name} relationship depends on what changed`);
        return { relationshipId: r.id, affected: false, reasons };
      }
      return { relationshipId: r.id, affected: true, reasons };
    });
}

export function reevaluate(input: World, signalId: string): { world: World; report: ReevaluationReport } {
  let world = structuredClone(input);
  const signal = world.signals[signalId];
  const scans = scanRelationships(world, signal);
  const affected = scans.filter((s) => s.affected);
  world.signals[signalId] = { ...signal, affectedRelationshipIds: affected.map((s) => s.relationshipId) };
  logActivity(world, "reevaluation", `${affected.length} of ${scans.length} relationships affected by "${signal.headline}"`, [signalId]);

  const report: ReevaluationReport = { signalId, scans, created: [], strengthened: [], unchanged: [] };

  for (const scan of affected) {
    const before = world;
    const prev = latest(before.relationships[scan.relationshipId].evaluations);
    const result = evaluateRelationship(world, scan.relationshipId);
    const commit = commitEvaluation(world, result, { kind: "signal", signalId });
    world = commit.world;

    for (const id of commit.created) {
      const opp = world.opportunities[id];
      const prior = prev?.rejectedHypotheses.find((h) => h.patternId === opp.patternId);
      const met = scan.reasons.filter((r) => r.startsWith("Watch condition met")).map((r) => r.replace("Watch condition met: ", ""));
      opp.delta = {
        whatChanged: `${signal.headline}.${met.length > 0 ? ` ${met.join("; ")}.` : ""}`,
        whyNowRelevant: opp.whyNow,
        whyNotBefore: prior && prev
          ? `The agents tested this in ${new Date(prev.at).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })} and the critic held it back: ${prior.reasons.join(" ")}`
          : "No structure was supported by both sides before this signal.",
      };
      report.created.push(id);
    }
    for (const id of commit.updated) {
      const was = before.opportunities[id];
      const now = world.opportunities[id];
      if (was.confidence.level !== now.confidence.level || was.whyNow !== now.whyNow) {
        now.delta = {
          whatChanged: `${signal.headline}.`,
          whyNowRelevant: now.whyNow,
          whyNotBefore: `Confidence was ${was.confidence.level}: ${was.confidence.rationale} Now ${now.confidence.level}.`,
        };
        logActivity(world, "reevaluation", `Opportunity strengthened: ${now.title} (${was.confidence.level} → ${now.confidence.level})`, [id]);
        report.strengthened.push(id);
      }
    }
    if (commit.created.length === 0 && !commit.updated.some((id) => report.strengthened.includes(id))) report.unchanged.push(scan.relationshipId);
  }

  return { world, report };
}
