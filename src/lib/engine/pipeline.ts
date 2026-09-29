/**
 * Relationship evaluation pipeline:
 * research → bilateral reasoning → opportunity discovery → critic/qualification → ranking.
 * `evaluateRelationship` is pure and returns stage reports for the UI;
 * `commitEvaluation` writes the result into the world.
 */
import type {
  AgentActivity,
  AgentModule,
  Evaluation,
  EvaluationTrigger,
  Opportunity,
  RejectedHypothesis,
  WatchCondition,
  World,
} from "@/lib/domain/types";
import { matchNeeds, monthYear, uniq } from "./context";
import { critique, type Critique } from "./critic";
import { PATTERNS, type OpportunityDraft } from "./patterns";
import { understandCompany } from "./research";

export interface StageReport {
  id: string;
  module: AgentModule;
  label: string;
  detail: string;
  items: string[];
}

export interface PatternTest {
  patternId: string;
  name: string;
  result: "fit" | "not-applicable" | "subsumed";
  reason: string;
}

export interface EvaluatedDraft {
  draft: OpportunityDraft;
  critique: Critique;
}

export interface RelationshipEvaluation {
  relationshipId: string;
  stages: StageReport[];
  tests: PatternTest[];
  evaluated: EvaluatedDraft[];
  passing: EvaluatedDraft[];
}

export function opportunityId(patternId: string, companyIds: readonly string[]): string {
  return `opp-${patternId}-${[...companyIds].sort().map((id) => id.replace(/^c-/, "")).join("-")}`;
}

export function discover(world: World, aId: string, bId: string): { tests: PatternTest[]; drafts: OpportunityDraft[] } {
  const a = world.companies[aId];
  const b = world.companies[bId];
  const claimed = new Set<string>();
  const tests: PatternTest[] = [];
  const drafts: OpportunityDraft[] = [];

  for (const pattern of PATTERNS) {
    let test: PatternTest | undefined;
    const reasons: string[] = [];
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const result = pattern.evaluate({ world, a: x, b: y, aNeedsMet: matchNeeds(x, y), bNeedsMet: matchNeeds(y, x), claimed });
      if (!result.fit) {
        reasons.push(result.reason);
        continue;
      }
      const fresh = result.draft.drivingNeeds.filter((d) => !claimed.has(d.need.id));
      if (fresh.length === 0) {
        test ??= { patternId: pattern.id, name: pattern.name, result: "subsumed", reason: "Covered by a stronger structure." };
        continue;
      }
      result.draft.drivingNeeds.forEach((d) => claimed.add(d.need.id));
      drafts.push(result.draft);
      test = { patternId: pattern.id, name: pattern.name, result: "fit", reason: result.draft.title };
    }
    tests.push(test ?? { patternId: pattern.id, name: pattern.name, result: "not-applicable", reason: reasons[0] ?? "No fit." });
  }
  return { tests, drafts };
}

const RANK = { strong: 0, moderate: 1, limited: 2 } as const;

/**
 * `override` lets a live reasoning provider (e.g. OpenRouter) supply the drafted
 * structures; the Critic and ranking still run here, identically.
 */
export function evaluateRelationship(
  world: World,
  relationshipId: string,
  override?: { tests: PatternTest[]; drafts: OpportunityDraft[] },
): RelationshipEvaluation {
  const rel = world.relationships[relationshipId];
  const [pa, pb] = rel.personIds.map((id) => world.people[id]);
  const [a, b] = rel.companyIds.map((id) => world.companies[id]);
  const ua = understandCompany(world, a.id);
  const ub = understandCompany(world, b.id);
  const aNeedsMet = matchNeeds(a, b);
  const bNeedsMet = matchNeeds(b, a);
  const { tests, drafts } = override ?? discover(world, a.id, b.id);
  const evaluated = drafts.map((draft) => ({ draft, critique: critique(draft, world) }));
  const passing = evaluated
    .filter((e) => e.critique.report.verdict === "pass")
    .sort((x, y) => RANK[x.critique.confidence.level] - RANK[y.critique.confidence.level] || y.critique.confidence.facts - x.critique.confidence.facts);

  const withheld = [...a.needs, ...b.needs].filter((n) => n.visibility === "agent-only" || n.visibility === "private").length;
  const urgent = [...a.needs, ...b.needs].filter((n) => n.intensity !== "exploring").length;
  const alignment = (m: (typeof aNeedsMet)[number]) =>
    `${world.companies[m.capabilityCompanyId].name} · ${m.capability.label} → ${world.companies[m.needCompanyId].name} · ${m.need.label}`;

  const stages: StageReport[] = [
    {
      id: "connect",
      module: "orchestration",
      label: "Connection established",
      detail: `${pa.name} ↔ ${pb.name} · met at ${rel.encounter.event}, ${monthYear(rel.encounter.date)}`,
      items: [],
    },
    { id: "understand-a", module: "research", label: `Understanding ${a.name}`, detail: ua.summary, items: ua.highlights },
    { id: "understand-b", module: "research", label: `Understanding ${b.name}`, detail: ub.summary, items: ub.highlights },
    {
      id: "capabilities",
      module: "bilateral",
      label: "Mapping capabilities",
      detail: `${aNeedsMet.length + bNeedsMet.length} capability → need alignments`,
      items: uniq([...aNeedsMet, ...bNeedsMet].map(alignment)).slice(0, 6),
    },
    {
      id: "needs",
      module: "bilateral",
      label: "Mapping strategic needs",
      detail: `${urgent} active needs · ${withheld} held agent-only and never disclosed verbatim`,
      items: [...a.objectives, ...b.objectives].slice(0, 3).map((o) => o.statement),
    },
    {
      id: "bilateral",
      module: "bilateral",
      label: "Agents reasoning bilaterally",
      detail: `${b.name} can meet ${uniq(aNeedsMet.map((m) => m.need.id)).length} of ${a.name}'s needs · ${a.name} can meet ${uniq(bNeedsMet.map((m) => m.need.id)).length} of ${b.name}'s`,
      items: [],
    },
    {
      id: "structures",
      module: "discovery",
      label: "Testing possible business structures",
      detail: `${tests.length} structures tested · ${drafts.length} drafted`,
      items: tests.map((t) => `${t.name}: ${t.result === "fit" ? t.reason : t.result === "subsumed" ? "merged into stronger structure" : t.reason}`),
    },
    {
      id: "critic",
      module: "critic",
      label: "Qualifying opportunities",
      detail:
        evaluated.length === 0
          ? "Nothing to qualify"
          : `${passing.length} passed · ${evaluated.length - passing.length} held back by the critic`,
      items: evaluated.map((e) => `${e.draft.title}: ${e.critique.report.verdict.toUpperCase()} — ${e.critique.report.summary}`),
    },
    {
      id: "result",
      module: "discovery",
      label: passing.length > 0 ? "Opportunity discovered" : "No strong opportunity yet",
      detail:
        passing.length > 0
          ? passing.map((p) => p.draft.title).join(" · ")
          : "The agents will keep watching this relationship for changes.",
      items: [],
    },
  ];

  return { relationshipId, stages, tests, evaluated, passing };
}

export function toOpportunity(
  id: string,
  draft: OpportunityDraft,
  c: Critique,
  meta: { relationshipIds: string[]; trigger: EvaluationTrigger; at: string; engine: Opportunity["engine"] },
): Opportunity {
  return {
    id,
    relationshipIds: meta.relationshipIds,
    companyIds: draft.companyIds,
    patternId: draft.patternId,
    kind: draft.kind,
    roles: draft.roles,
    drivingNeedIds: draft.drivingNeeds.map((d) => d.need.id),
    title: draft.title,
    types: draft.types,
    summary: draft.summary,
    whyExists: draft.whyExists,
    whyNow: draft.whyNow,
    contributions: draft.contributions,
    structure: draft.structure,
    evidence: draft.evidence.map((e, i) => ({ ...e, id: `${id}-e${i}` })),
    assumptions: draft.assumptions,
    unknowns: draft.unknowns,
    questions: draft.questions,
    risks: draft.risks,
    nextStep: draft.nextStep,
    missingCapabilities: draft.missingCapabilities,
    confidence: c.confidence,
    critic: c.report,
    stage: "discovered",
    stageHistory: [{ stage: "discovered", at: meta.at, reason: "Passed critic review." }],
    discoveredAt: meta.at,
    trigger: meta.trigger,
    engine: meta.engine,
  };
}

export function logActivity(world: World, module: AgentModule, message: string, relatedIds: string[] = []): void {
  const entry: AgentActivity = { id: `act-${world.activity.length + 1}`, at: world.now, module, message, relatedIds };
  world.activity = [entry, ...world.activity];
}

export interface CommitResult {
  world: World;
  created: string[];
  updated: string[];
  evaluation: Evaluation;
}

/** Writes an evaluation into a copy of the world. Existing opportunities keep their lifecycle stage. */
export function commitEvaluation(
  input: World,
  result: RelationshipEvaluation,
  trigger: EvaluationTrigger,
  engine: Opportunity["engine"] = "deterministic",
): CommitResult {
  const world = structuredClone(input);
  const rel = world.relationships[result.relationshipId];
  const created: string[] = [];
  const updated: string[] = [];

  for (const { draft, critique: c } of result.passing) {
    const id = opportunityId(draft.patternId, draft.companyIds);
    const fresh = toOpportunity(id, draft, c, { relationshipIds: [rel.id], trigger, at: world.now, engine });
    const existing = world.opportunities[id];
    if (existing) {
      world.opportunities[id] = { ...fresh, stage: existing.stage, stageHistory: existing.stageHistory, discoveredAt: existing.discoveredAt, trigger: existing.trigger, delta: existing.delta };
      updated.push(id);
    } else {
      world.opportunities[id] = fresh;
      created.push(id);
    }
  }

  const rejected: RejectedHypothesis[] = result.evaluated
    .filter((e) => e.critique.report.verdict !== "pass")
    .map((e) => ({
      title: e.draft.title,
      patternId: e.draft.patternId,
      verdict: e.critique.report.verdict,
      reasons: e.critique.report.checks.filter((k) => k.result !== "pass").map((k) => k.note),
    }));
  const watch: WatchCondition[] = uniq(result.evaluated.flatMap((e) => e.critique.watchConditions)).filter(
    (w, i, all) => all.findIndex((x) => x.id === w.id) === i,
  );
  const opportunityIds = result.passing.map((p) => opportunityId(p.draft.patternId, p.draft.companyIds));
  const [a, b] = rel.companyIds.map((id) => world.companies[id].name);

  const evaluation: Evaluation = {
    id: `${rel.id}-ev${rel.evaluations.length + 1}`,
    at: world.now,
    trigger,
    outcome: opportunityIds.length > 0 ? "opportunity" : "no-strong-opportunity",
    opportunityIds,
    rejectedHypotheses: rejected,
    watchConditions: watch,
    summary:
      opportunityIds.length > 0
        ? `${opportunityIds.length} opportunity found between ${a} and ${b}.`
        : rejected.length > 0
          ? `No strong opportunity yet. ${rejected.length} hypothesis held back by the critic.`
          : `No complementary capabilities or needs between ${a} and ${b}.`,
    engine,
  };

  rel.evaluations = [...rel.evaluations, evaluation];
  rel.agentsConnectedAt ??= world.now;
  const matched = opportunityIds.some((id) => world.opportunities[id]?.stage === "mutual-interest");
  rel.status = matched ? "matched" : opportunityIds.length > 0 ? "active" : "dormant";

  logActivity(world, "critic", `${a} ↔ ${b}: ${evaluation.summary}`, [rel.id, ...opportunityIds]);
  for (const id of created) logActivity(world, "discovery", `Opportunity discovered: ${world.opportunities[id].title}`, [id, rel.id]);

  return { world, created, updated, evaluation };
}
