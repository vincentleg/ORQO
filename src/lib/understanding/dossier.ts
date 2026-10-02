/**
 * Company Intelligence 2.0 (Phase 15): the commercial dossier on a target
 * company, personalized with the user's own Business DNA.
 *
 * Pure and read-only. Built from two CommercialUnderstandings (stored
 * evidence + validations, Phase 14) and the scenario engine. Every sentence
 * the UI renders comes from structured parts (labels + DNA values), never
 * from free model text. Nothing here researches, calls a provider or writes.
 */
import type { Dimension } from "./ontology";
import { QUESTION_RESOLVE, type QuestionKey } from "./pairs";
import { generateScenarios, type CriticFinding, type Party, type Scenario, type ScenarioResult, type Side, type TimingEvidence } from "./scenarios";
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

export interface Dossier {
  status: "ready" | "own_missing" | "target_insufficient";
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
  /** Existing mechanisms (up to 3) and new offerings (up to 2), credible before weak. */
  scenarios: Scenario[];
  novel: Scenario[];
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

function questionsOf(s: Scenario): QuestionRef[] {
  // Questions about the partner's operations are about the partner; joint ones are asked to the target.
  return s.questions.map((key) => ({ key, scenario: s.key, about: s.partner === "own" ? "target" : s.partner, resolve: QUESTION_RESOLVE[key] }));
}

export function companyDossier(own: Party, target: Party): Dossier {
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
  const empty = { scenarios: [], novel: [], discarded: [], needs: [], whyNow: [], questions: [], nextQuestion: null };

  if (own.understanding.market.coverage === "insufficient") return { ...base, ...empty, status: "own_missing", next: { kind: "read_own_company" } };
  if (tMarket.coverage === "insufficient") return { ...base, ...empty, status: "target_insufficient", next: { kind: "learn_target", dimensions: tMarket.unknowns } };

  const result = generateScenarios(own, target);
  const existing = result.scenarios.filter((s) => s.novelty === "existing_mechanism").slice(0, MAX_EXISTING);
  const novel = result.scenarios.filter((s) => s.novelty === "new_offering").slice(0, MAX_NOVEL);
  const shown = [...existing, ...novel];
  const lead = existing[0] ?? novel[0] ?? null;

  const questions: QuestionRef[] = [];
  for (const s of shown) for (const q of questionsOf(s)) if (questions.length < MAX_QUESTIONS && !questions.some((x) => x.key === q.key)) questions.push(q);
  const nextQuestion = lead ? questionsOf(lead)[0] : null;

  let next: Investigation;
  if (!lead) next = { kind: "no_business_now", reasons: [...new Set(result.discarded.flatMap((d) => (d.findings.length ? d.findings.map((f) => f.code) : [d.mechanism])))].slice(0, 3) };
  else if (lead.verdict === "weak") next = { kind: "verify", scenario: lead.key, finding: lead.critic.find((f) => f.severity === "major")!.code };
  else next = { kind: "ask", question: nextQuestion! };

  return {
    ...base,
    status: "ready",
    executive: { ...base.executive, lead: lead ? { mechanism: lead.mechanism, provider: lead.provider, novelty: lead.novelty, verdict: lead.verdict } : null },
    scenarios: existing,
    novel,
    discarded: result.discarded,
    needs: shown.filter((s) => s.partner === "target").map((s) => ({ mechanism: s.mechanism, state: s.needShown ? ("inference" as const) : ("hypothesis" as const) })),
    whyNow: [...new Map(shown.flatMap((s) => s.whyNow).map((w) => [w.key, w])).values()].slice(0, 3),
    questions,
    nextQuestion,
    next,
  };
}
