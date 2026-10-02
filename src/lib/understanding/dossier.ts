/**
 * Company Intelligence 2.0 (Phase 15): the commercial dossier on a target
 * company, personalized with the user's own Business DNA.
 *
 * Pure and read-only. Built from two CommercialUnderstandings (stored
 * evidence + validations, Phase 14) and the scenario engine. Every sentence
 * the UI renders comes from structured parts (labels + DNA values), never
 * from free model text. Nothing here researches, calls a provider or writes.
 *
 * Phase 16 verdict:
 * - opportunity: at least one CREDIBLE scenario;
 * - no_credible_opportunity: enough is known, and nothing deserves BD time. This is a
 *   successful result: it explains the existing relationship, why the company still
 *   matters, what was considered and rejected, what is unknown, and what would change the conclusion;
 * - insufficient: not enough is known about one side.
 * Weak scenarios are "considered", never recommended, prioritized or trackable. There is no minimum count.
 */
import type { Dimension } from "./ontology";
import { PAIR_MECHANISMS, QUESTION_RESOLVE, type QuestionKey } from "./pairs";
import { assessRelationship, NO_STATED_RELATIONSHIP, type RelationshipAssessment, type StatedRelationship } from "./relationship";
import { generateScenarios, sharedContext, type CriticCode, type CriticFinding, type Party, type Scenario, type ScenarioResult, type Side, type TimingEvidence } from "./scenarios";
import type { BusinessDna, MarketModel } from "./types";

export interface QuestionRef {
  key: QuestionKey;
  scenario: string;
  /** The company the question is about. */
  about: Side;
  resolve: "ask" | "research";
}

export type Investigation =
  | { kind: "read_own_company" }
  | { kind: "learn_target"; dimensions: Dimension[] }
  | { kind: "no_business_now"; reasons: string[] }
  | { kind: "verify"; scenario: string; finding: CriticFinding["code"] }
  | { kind: "ask"; question: QuestionRef };

export type DossierVerdict = "opportunity" | "no_credible_opportunity" | "insufficient";

/** Why a company with no credible new opportunity still matters, and what would change the conclusion. */
export interface NegativeResult {
  /** What the two share: the context that makes the company relevant. */
  shared: Scenario["shared"];
  /** Why the ideas were not recommended: critic codes (most decisive first), or "similarity_only". */
  reasons: (CriticCode | "similarity_only")[];
  /** Ideas ORQO considered (weak or rejected), with who would provide them. */
  consideredMechanisms: { mechanism: string; provider: Side }[];
  /** Market-signal types that would justify reconsidering (from the considered mechanisms). */
  reconsiderIf: string[];
  /** The decisive unknowns of the considered ideas. */
  unknowns: QuestionRef[];
}

export interface Dossier {
  status: "ready" | "own_missing" | "target_insufficient";
  verdict: DossierVerdict;
  relationship: RelationshipAssessment;
  /** Ask the user how the target works with them today: high value, and not answered yet. */
  askRelationship: boolean;
  ownName: string;
  targetName: string;
  /** The building blocks of the executive assessment. */
  executive: {
    roles: string[];
    forms: string[];
    scopes: string[];
    routes: string[];
    lead: { mechanism: string; provider: Side; novelty: Scenario["novelty"]; verdict: Scenario["verdict"] } | null;
  };
  targetDna: BusinessDna;
  targetMarket: MarketModel;
  /** CREDIBLE existing mechanisms (up to 3) and credible new offerings (up to 2). Only these are opportunities. */
  scenarios: Scenario[];
  novel: Scenario[];
  /** Weak ideas: shown collapsed as "considered, not recommended". */
  considered: Scenario[];
  negative: NegativeResult | null;
  discarded: ScenarioResult["discarded"];
  /** What the target may need: inference when a cue in its evidence shows it, hypothesis otherwise, unknown when nothing does. */
  needs: { mechanism: string; state: "inference" | "hypothesis" }[];
  whyNow: TimingEvidence[];
  questions: QuestionRef[];
  nextQuestion: QuestionRef | null;
  next: Investigation;
  asOf: string | null;
}

const MAX_EXISTING = 3;
const MAX_NOVEL = 2;
const MAX_QUESTIONS = 4;
const MAX_CONSIDERED = 4;
const SEVERITY = { kill: 0, major: 1, minor: 2 } as const;
/** The most decisive reasons first when several ideas were rejected. */
const REASON_ORDER: CriticCode[] = ["restates_existing", "reverses_relationship", "already_does", "no_credible_payer", "need_not_shown", "possible_competitor", "channel_conflict", "atypical_mechanism"];

function questionsOf(s: Scenario): QuestionRef[] {
  // Questions about the partner's operations are about the partner; joint ones are asked to the target.
  return s.questions.map((key) => ({ key, scenario: s.key, about: s.partner === "own" ? "target" : s.partner, resolve: QUESTION_RESOLVE[key] }));
}

function negativeOf(own: Party, target: Party, considered: Scenario[], discarded: ScenarioResult["discarded"]): NegativeResult {
  const findings = [...considered.flatMap((s) => s.critic), ...discarded.flatMap((d) => d.findings)].filter((f) => f.severity !== "minor");
  const codes = [...new Set(findings.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]).map((f) => f.code))];
  const reasons: NegativeResult["reasons"] = REASON_ORDER.filter((c) => codes.includes(c)).slice(0, 3);
  if (discarded.some((d) => d.mechanism === "similarity_only")) reasons.push("similarity_only");
  const ideas = [...new Map([...considered.map((s) => ({ mechanism: s.mechanism, provider: s.provider })), ...discarded.flatMap((d) => (d.provider ? [{ mechanism: d.mechanism, provider: d.provider }] : []))].map((x) => [`${x.mechanism}:${x.provider}`, x])).values()];
  const reconsiderIf = [...new Set(ideas.flatMap((x) => PAIR_MECHANISMS.find((m) => m.key === x.mechanism)?.timing ?? []))].slice(0, 3);
  const unknowns: QuestionRef[] = [];
  for (const s of considered) {
    const q = questionsOf(s)[0];
    if (q && unknowns.length < 3 && !unknowns.some((x) => x.key === q.key)) unknowns.push(q);
  }
  return { shared: sharedContext(own.understanding, target.understanding), reasons, consideredMechanisms: ideas.slice(0, 4), reconsiderIf, unknowns };
}

export function companyDossier(own: Party, target: Party, stated: StatedRelationship = NO_STATED_RELATIONSHIP): Dossier {
  const relationship = assessRelationship(own, target, stated);
  const tDna = target.understanding.dna;
  const tMarket = target.understanding.market;
  const base = {
    ownName: own.name,
    targetName: target.name,
    targetDna: tDna,
    targetMarket: tMarket,
    asOf: tDna.basis.researchedAt,
    executive: {
      roles: tMarket.roles.map((r) => r.value),
      forms: tMarket.archetype.offering_form.values,
      scopes: tMarket.archetype.customer_scope.values,
      routes: tMarket.items.filter((i) => i.section === "route").sort((a, b) => (a.state === b.state ? 0 : a.state === "inference" ? -1 : 1)).slice(0, 2).map((i) => i.key),
      lead: null,
    },
  };
  const empty = { scenarios: [], novel: [], considered: [], negative: null, discarded: [], needs: [], whyNow: [], questions: [], nextQuestion: null, verdict: "insufficient" as const, relationship, askRelationship: false };

  if (own.understanding.market.coverage === "insufficient") return { ...base, ...empty, status: "own_missing", next: { kind: "read_own_company" } };
  if (tMarket.coverage === "insufficient") return { ...base, ...empty, status: "target_insufficient", next: { kind: "learn_target", dimensions: tMarket.unknowns } };

  const result = generateScenarios(own, target, relationship);
  const credible = result.scenarios.filter((s) => s.verdict === "credible");
  const considered = result.scenarios.filter((s) => s.verdict === "weak").slice(0, MAX_CONSIDERED);
  const existing = credible.filter((s) => s.novelty === "existing_mechanism").slice(0, MAX_EXISTING);
  const novel = credible.filter((s) => s.novelty === "new_offering").slice(0, MAX_NOVEL);
  const shown = [...existing, ...novel];
  const lead = existing[0] ?? novel[0] ?? null;

  const questions: QuestionRef[] = [];
  for (const s of shown) for (const q of questionsOf(s)) if (questions.length < MAX_QUESTIONS && !questions.some((x) => x.key === q.key)) questions.push(q);
  const nextQuestion = lead ? questionsOf(lead)[0] : null;

  let next: Investigation;
  const negative = lead ? null : negativeOf(own, target, considered, result.discarded);
  // The lead is always credible (weak ideas are only considered), so the next step is its decisive question.
  if (!lead) next = { kind: "no_business_now", reasons: negative!.reasons.slice(0, 3) };
  else next = { kind: "ask", question: nextQuestion! };

  return {
    ...base,
    status: "ready",
    verdict: lead ? "opportunity" : "no_credible_opportunity",
    relationship,
    // Worth asking only when the answer can change the conclusion: a lead to confirm, or a relationship read from evidence.
    askRelationship: !relationship.answered && relationship.status !== "none" && (lead !== null || relationship.status === "known"),
    executive: { ...base.executive, lead: lead ? { mechanism: lead.mechanism, provider: lead.provider, novelty: lead.novelty, verdict: lead.verdict } : null },
    scenarios: existing,
    novel,
    considered,
    negative,
    discarded: result.discarded,
    needs: shown.filter((s) => s.partner === "target").map((s) => ({ mechanism: s.mechanism, state: s.needShown ? ("inference" as const) : ("hypothesis" as const) })),
    whyNow: [...new Map(shown.flatMap((s) => s.whyNow).map((w) => [w.key, w])).values()].slice(0, 3),
    questions,
    nextQuestion,
    next,
  };
}

/** The only scenarios a user may track: a CREDIBLE scenario of a dossier whose verdict is "opportunity". */
export function trackableScenario(d: Dossier, key: string): Scenario | null {
  if (d.status !== "ready" || d.verdict !== "opportunity") return null;
  return [...d.scenarios, ...d.novel].find((s) => s.key === key && s.verdict === "credible") ?? null;
}
