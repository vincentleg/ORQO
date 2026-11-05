/**
 * Deterministic scorer for one completion against one example. Provider-neutral and pure: no model, no
 * network. Shared by the evaluator (eval/run.ts) and the reward (rewards/reward.ts), so training and
 * evaluation optimise and measure the same thing.
 *
 * Objective checks (exact): JSON + schema validity, evidence-id existence, verbatim quotes, named entities
 * present in cited evidence, forbidden fabrications, contact patterns, gold labels (fit, signals, maturity,
 * confidence, required unknowns, must-remain-unknown, conflicts, relationship, next action, role functions).
 * Subjective quality (depth of understanding, quality of the commercial thesis) is approximated here and can
 * be refined by an external judge through eval/judge.ts.
 */
import { DIMENSIONS, type Dimension, type PenaltyKind } from "../configs/config";
import { allStrings, containsPrefix, containsTerm, norm } from "../dataset/io";
import type { Example } from "../dataset/schema/example";
import { claimsOf, CompanyIntelligenceSchema, SIGNALS, type CompanyIntelligence, type FitClass } from "../dataset/schema/output";

export const SCORER_VERSION = "ci-scorer/v1";

export type ParseResult = { ok: true; output: CompanyIntelligence; wrapped: boolean } | { ok: false; stage: "json" | "schema"; errors: string[] };

/** Strict JSON. A fenced or prose-wrapped object is accepted but marked `wrapped` (schema score reduced). */
export function parseCompletion(text: string): ParseResult {
  let body = text.trim();
  let wrapped = false;
  const fence = body.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) {
    body = fence[1].trim();
    wrapped = true;
  } else if (!body.startsWith("{")) {
    const a = body.indexOf("{");
    const b = body.lastIndexOf("}");
    if (a < 0 || b <= a) return { ok: false, stage: "json", errors: ["no JSON object found"] };
    body = body.slice(a, b + 1);
    wrapped = true;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    return { ok: false, stage: "json", errors: [String((e as Error).message).slice(0, 200)] };
  }
  const r = CompanyIntelligenceSchema.safeParse(raw);
  if (!r.success) return { ok: false, stage: "schema", errors: r.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  return { ok: true, output: r.data, wrapped };
}

export interface Violation {
  kind: PenaltyKind;
  path: string;
  detail: string;
  /** Counts towards the hallucination rate (fabrication or contradiction of evidence). */
  hallucination: boolean;
}

export interface ExampleScore {
  id: string;
  valid: boolean;
  wrapped: boolean;
  parseErrors: string[];
  dims: Record<Dimension, number>;
  violations: Violation[];
  hallucination: boolean;
  fabricatedContact: boolean;
  predictedFit: FitClass | null;
  fitCorrect: boolean;
  claims: { total: number; grounded: number };
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const PROFILE_URL = /(linkedin\.com\/in\/|twitter\.com\/|x\.com\/|facebook\.com\/)/i;

/** Personal contact data in any string of the output. ORQO never outputs contacts. */
export function findContacts(o: unknown): string[] {
  const hits: string[] = [];
  for (const s of allStrings(o)) {
    if (EMAIL.test(s)) hits.push(`email in "${s.slice(0, 80)}"`);
    if (PROFILE_URL.test(s)) hits.push(`profile URL in "${s.slice(0, 80)}"`);
    for (const m of s.match(PHONE) ?? []) if ((m.match(/\d/g) ?? []).length >= 8) hits.push(`phone-like number "${m}"`);
  }
  return hits;
}

const FIT_ORDER: Record<Exclude<FitClass, "insufficient_evidence">, number> = { poor: 0, moderate: 1, excellent: 2 };
const CONF_ORDER = { limited: 0, moderate: 1, strong: 2 } as const;
const MATURITY_ORDER = { pre_commercial: 0, early_commercial: 1, growth: 2, established: 3 } as const;

const jaccard = <T>(a: readonly T[], b: readonly T[]) => {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / new Set([...A, ...B]).size;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function fitScore(pred: FitClass, acceptable: readonly FitClass[]): number {
  if (acceptable.includes(pred)) return 1;
  if (pred === "insufficient_evidence" || acceptable.every((a) => a === "insufficient_evidence")) return 0;
  const d = Math.min(...acceptable.filter((a) => a !== "insufficient_evidence").map((a) => Math.abs(FIT_ORDER[a as keyof typeof FIT_ORDER] - FIT_ORDER[pred as keyof typeof FIT_ORDER])));
  return d === 1 ? 0.4 : 0;
}

function maturityScore(pred: string, gold: string): number {
  if (pred === gold) return 1;
  if (pred === "unknown") return 0.5;
  if (gold === "unknown") return 0;
  return Math.abs(MATURITY_ORDER[pred as keyof typeof MATURITY_ORDER] - MATURITY_ORDER[gold as keyof typeof MATURITY_ORDER]) === 1 ? 0.5 : 0;
}

const zeroDims = (): Record<Dimension, number> => Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;

/** Significant words of the represented company's offer (for "does the thesis use what we actually sell?"). */
function ownVocabulary(e: Example): string[] {
  const rc = e.representedCompany;
  const stop = new Set(["software", "their", "which", "where", "companies", "company", "systems", "services", "management"]);
  return [...new Set([...rc.offerings, ...rc.soughtCapabilities, rc.summary].flatMap((s) => norm(s).split(" ")).filter((w) => w.length >= 5 && !stop.has(w)))];
}

export function scoreExample(e: Example, completion: string): ExampleScore {
  const parsed = parseCompletion(completion);
  if (!parsed.ok) {
    return { id: e.id, valid: false, wrapped: false, parseErrors: parsed.errors, dims: zeroDims(), violations: [], hallucination: false, fabricatedContact: false, predictedFit: null, fitCorrect: false, claims: { total: 0, grounded: 0 } };
  }
  const o = parsed.output;
  const s = e.scoring;
  const evidence = new Map(e.evidence.map((x) => [x.id, norm(x.text)]));
  const violations: Violation[] = [];
  const add = (kind: PenaltyKind, path: string, detail: string, hallucination = true) => violations.push({ kind, path, detail, hallucination });

  // ---- Grounding: every traceable statement --------------------------------------------------------------
  const claims = claimsOf(o);
  let grounded = 0;
  for (const c of claims) {
    const before = violations.length;
    const missing = c.evidence.filter((id) => !evidence.has(id));
    if (missing.length) add("fabricated_fact", c.path, `cites nonexistent evidence ${missing.join(", ")}`);
    const cited = c.evidence.filter((id) => evidence.has(id)).map((id) => evidence.get(id)!);
    if (c.quote && !cited.some((t) => t.includes(norm(c.quote!)))) add(c.kind === "location" ? "unsupported_geography" : c.kind === "signal" ? "unsupported_technical_claim" : "fabricated_fact", c.path, "quote not found verbatim in cited evidence");
    if (c.entity && !cited.some((t) => t.includes(norm(c.entity!)))) add(c.kind === "location" ? "unsupported_geography" : "fabricated_fact", c.path, `"${c.entity}" does not appear in cited evidence`);
    if (violations.length === before) grounded++;
  }
  const refs: [string, string[]][] = [["maturity", o.maturity.evidence], ...o.conflicts.map((x, i) => [`conflicts[${i}]`, x.evidence] as [string, string[]]), ...(o.opportunity ? [["opportunity", o.opportunity.evidence] as [string, string[]]] : [])];
  for (const [path, ids] of refs) {
    const missing = ids.filter((id) => !evidence.has(id));
    if (missing.length) add("fabricated_fact", path, `cites nonexistent evidence ${missing.join(", ")}`);
  }

  // ---- Fabrications: forbidden terms and contacts ------------------------------------------------------
  const strings = allStrings(o);
  const forbiddenHits = s.forbiddenTerms.filter((t) => strings.some((x) => containsTerm(x, t)));
  for (const t of forbiddenHits) add("fabricated_fact", "*", `unsupported term "${t}"`);
  const contacts = findContacts(o);
  for (const c of contacts) add("fabricated_contact", "*", c);

  // ---- Things the evidence does not support must stay unknown -------------------------------------------
  const mru = new Set(s.mustRemainUnknown);
  const respected: boolean[] = [];
  const keep = (field: string, ok: boolean, kind: PenaltyKind, path: string) => {
    if (!mru.has(field as never)) return;
    respected.push(ok);
    if (!ok) add(kind, path, `${field} is not supported by the evidence and must remain unknown`);
  };
  keep("geography", o.geography.locations.length === 0, "unsupported_geography", "geography");
  keep("customer", o.namedCustomers.length === 0, "fabricated_fact", "namedCustomers");
  keep("partnerships", o.partnerships.length === 0, "fabricated_fact", "partnerships");
  keep("product", o.products.length === 0, "fabricated_fact", "products");
  keep("maturity", o.maturity.stage === "unknown", "fabricated_fact", "maturity");
  for (const k of SIGNALS) if (mru.has(k)) respected.push(o.deployment[k].status === "unknown");

  // ---- Technical signals vs gold ----------------------------------------------------------------------
  const signalScores = SIGNALS.map((k) => {
    const gold = s.expectedSignals[k];
    const p = o.deployment[k];
    if (p.status === gold) return 1;
    if (gold === "unknown") {
      if (p.basis === "fact") add("unsupported_technical_claim", `deployment.${k}`, `asserts ${p.status} as fact; the evidence does not establish it`);
      else add("unsupported_technical_inference", `deployment.${k}`, `infers ${p.status}; the evidence does not establish it`, false);
      return 0;
    }
    if (p.status === "unknown") return 0.5;
    add("contradiction", `deployment.${k}`, `${p.status} contradicts the evidence (${gold})`);
    return 0;
  });

  // ---- Maturity, fit, confidence --------------------------------------------------------------------------
  const goldM = s.expectedMaturity;
  const predM = o.maturity.stage;
  if (goldM !== "unknown" && predM !== "unknown" && Math.abs(MATURITY_ORDER[goldM] - MATURITY_ORDER[predM]) >= 2) add("contradiction", "maturity", `${predM} contradicts the evidence (${goldM})`);

  const fit = fitScore(o.fit.class, s.acceptableFit);
  const goldFits = s.acceptableFit.filter((f) => f !== "insufficient_evidence");
  if (o.fit.class !== "insufficient_evidence" && goldFits.length && goldFits.every((g) => Math.abs(FIT_ORDER[g] - FIT_ORDER[o.fit.class as keyof typeof FIT_ORDER]) === 2)) add("contradiction", "fit.class", `${o.fit.class} is the opposite of the supported fit`, false);

  const confGap = CONF_ORDER[o.confidence.level] - CONF_ORDER[s.expectedConfidence];
  if (confGap >= 2 || (o.confidence.level === "strong" && !s.acceptableFit.includes(o.fit.class))) add("unjustified_confidence", "confidence", `${o.confidence.level} confidence is not justified (expected ${s.expectedConfidence})`, false);

  // ---- Dimensions -------------------------------------------------------------------------------------------
  const total = claims.length + forbiddenHits.length + contacts.length;
  const factual_grounding = total ? grounded / total : 0;

  const text = [o.summary.statement, ...o.products.flatMap((p) => [p.name, p.description]), ...o.markets.flatMap((m) => [m.label, m.claim.statement]), ...o.technicalSignals.map((t) => t.statement), ...o.businessModel.claims.map((c) => c.statement)].join(" \n ");
  const keyRecall = s.keyTerms.filter((t) => containsPrefix(text, t)).length / s.keyTerms.length;
  const goldBM = e.expected.businessModel;
  const company_understanding =
    0.2 * jaccard(o.businessModel.offeringForms, goldBM.offeringForms) +
    0.1 * jaccard([...o.businessModel.revenueModels, ...o.businessModel.customerScope], [...goldBM.revenueModels, ...goldBM.customerScope]) +
    0.3 * mean(signalScores) +
    0.1 * maturityScore(predM, goldM) +
    0.3 * keyRecall;

  const goldOpp = e.expected.opportunity;
  const okRel = (r: string) => (s.acceptableRelationships as readonly string[]).includes(r);
  const vocab = ownVocabulary(e);
  let relationship: number, oppEvidence: number, ownUse: number;
  if (!o.opportunity) {
    relationship = goldOpp ? 0 : 1;
    oppEvidence = ownUse = relationship;
  } else {
    relationship = goldOpp ? (okRel(o.opportunity.relationship) ? 1 : 0) : okRel(o.opportunity.relationship) ? 0.5 : 0;
    oppEvidence = o.opportunity.evidence.length && o.opportunity.evidence.every((id) => evidence.has(id)) ? 1 : 0;
    ownUse = vocab.some((w) => norm(`${o.opportunity!.ownBrings} ${o.opportunity!.thesis}`).includes(w)) ? 1 : 0;
    if (!goldOpp) oppEvidence = ownUse = Math.min(oppEvidence, ownUse, 0.5);
  }
  const nextOk = (s.acceptableNextActions as readonly string[]).includes(o.nextAction.kind) ? 1 : 0;
  const opportunity_reasoning = 0.4 * relationship + 0.15 * oppEvidence + 0.15 * ownUse + 0.3 * nextOk;

  const G = new Set(s.decisionMakerFunctions);
  const P = new Set(o.decisionMakerRoles.map((r) => r.function));
  let decision_maker_reasoning: number;
  if (!G.size) decision_maker_reasoning = P.size ? 0.3 : 1;
  else {
    const hit = [...P].filter((f) => G.has(f)).length;
    decision_maker_reasoning = 0.7 * (hit / G.size) + 0.3 * (P.size ? hit / P.size : 0);
  }
  if (findContacts(o.decisionMakerRoles).length) decision_maker_reasoning = 0;

  const confScore = Math.abs(confGap) === 0 ? 1 : Math.abs(confGap) === 1 ? 0.5 : 0;
  const listed = new Set(o.unknowns.map((u) => u.field));
  const unknownRecall = s.requiredUnknowns.length ? s.requiredUnknowns.filter((f) => listed.has(f)).length / s.requiredUnknowns.length : 1;
  const conflictScore = s.minConflicts ? Math.min(1, o.conflicts.length / s.minConflicts) : 1;
  const uncertainty_calibration = 0.4 * confScore + 0.3 * unknownRecall + 0.2 * mean(respected.map(Number)) + 0.1 * conflictScore;

  const dims: Record<Dimension, number> = {
    factual_grounding: clamp01(factual_grounding),
    opportunity_reasoning: clamp01(opportunity_reasoning),
    company_understanding: clamp01(company_understanding),
    fit_classification: fit,
    decision_maker_reasoning: clamp01(decision_maker_reasoning),
    uncertainty_calibration: clamp01(uncertainty_calibration),
    schema_compliance: parsed.wrapped ? 0.5 : 1,
  };
  return {
    id: e.id,
    valid: true,
    wrapped: parsed.wrapped,
    parseErrors: [],
    dims,
    violations,
    hallucination: violations.some((v) => v.hallucination),
    fabricatedContact: contacts.length > 0,
    predictedFit: o.fit.class,
    fitCorrect: fit === 1,
    claims: { total: claims.length, grounded },
  };
}
