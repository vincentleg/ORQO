/**
 * Business relevance: TARGET company vs the workspace's OWN company.
 *
 * Candidates come from two places:
 * - deterministic rules over the shared concept lexicon (always available, no model);
 * - model hypotheses (deep research only), which are untrusted proposals.
 * Every candidate then goes through the same deterministic critic. A candidate
 * without evidence on the target side, own-company context, a specific driver
 * and a concrete mechanism is rejected, whatever produced it.
 */
import { concept, conceptsIn, foldText, isGeneric } from "./concepts";
import { isSourcedEvidence } from "./extract";
import type { Claim, ConfidenceLevel, ModelHypothesis, OwnCompanyContext, OwnProfileField, RelationshipType, TargetProfile, UnderstandingField } from "./types";

export const RULES = ["segment_customer", "sought_capability", "channel", "complementary", "oem_build"] as const;
export type RuleCode = (typeof RULES)[number];

export interface OwnFact {
  field: OwnProfileField;
  value: string;
}

export interface Candidate {
  id: string;
  relationship: RelationshipType;
  origin: "rules" | "model";
  rule?: RuleCode;
  /** Concept keys, or "~phrase" for a literal phrase from the own profile found on the target's pages. */
  drivers: string[];
  ownBrings: OwnFact[];
  targetClaimIds: string[];
  whyNowClaimIds: string[];
  /** Model wording (deep research). Rule candidates are rendered from i18n templates instead. */
  narrative?: Pick<ModelHypothesis, "title" | "mechanism" | "ownBrings" | "targetBrings" | "assumptions" | "questions" | "nextStep">;
}

export type CheckId = "target_evidence" | "own_context" | "specificity" | "mechanism" | "goal_fit" | "corroboration" | "timing";
export type CheckResult = "pass" | "warn" | "fail" | "info";
export interface Check {
  id: CheckId;
  result: CheckResult;
  /** i18n note code, e.g. "missing", "generic". */
  code: string;
}

export type Verdict = "pass" | "weak" | "reject";

export interface EvaluatedCandidate extends Candidate {
  verdict: Verdict;
  checks: Check[];
  confidence: ConfidenceLevel;
}

export interface Insight {
  code: "possible_competitor";
  drivers: string[];
  claimIds: string[];
}

export type AnalysisStatus = "opportunities" | "hypotheses_only" | "none" | "own_profile_missing";

export interface RelevanceAnalysis {
  status: AnalysisStatus;
  opportunities: EvaluatedCandidate[];
  hypotheses: EvaluatedCandidate[];
  rejected: EvaluatedCandidate[];
  insights: Insight[];
  /** Own-profile fields whose absence limits the comparison. */
  ownGaps: OwnProfileField[];
  targetUnknowns: UnderstandingField[];
}

export const MAX_OPPORTUNITIES = 3;
export const MAX_HYPOTHESES = 3;
export const MAX_REJECTED = 6;

const GENERIC_LANGUAGE =
  /\b(synerg\w*|leverage each other|collaborat\w* to (create|drive|unlock)|both (companies )?(use|leverage|are in|work in|operate in|focus on) (ai|artificial intelligence|technology|tech|innovation|the tech)|win-win|explore (potential |possible )?(opportunities|collaboration|synergies)|strategic synergies|could partner to innovate)\b/i;

export function hasGenericLanguage(text: string): boolean {
  return GENERIC_LANGUAGE.test(text);
}

interface TargetIndex {
  profile: TargetProfile;
  evidence: Claim[];
  byConcept: Map<string, Claim[]>;
}

function indexTarget(profile: TargetProfile): TargetIndex {
  const evidence = profile.claims.filter((c) => isSourcedEvidence(c, profile.sources));
  const byConcept = new Map<string, Claim[]>();
  for (const c of evidence) for (const k of c.concepts) byConcept.set(k, [...(byConcept.get(k) ?? []), c]);
  return { profile, evidence, byConcept };
}

function targetConcepts(ix: TargetIndex, categories: string[]): Set<string> {
  return new Set([...ix.byConcept.keys()].filter((k) => categories.includes(concept(k)?.category ?? "")));
}

function claimsFor(ix: TargetIndex, drivers: string[]): string[] {
  const ids = new Set<string>();
  for (const d of drivers) {
    if (d.startsWith("~")) {
      const phrase = d.slice(1);
      for (const c of ix.evidence) if (c.excerpt && foldText(c.excerpt).includes(phrase)) ids.add(c.id);
    } else for (const c of ix.byConcept.get(d) ?? []) ids.add(c.id);
  }
  return [...ids].slice(0, 8);
}

function facts(own: OwnCompanyContext, field: Exclude<OwnProfileField, "summary" | "partnershipGoals">, only?: Set<string>): OwnFact[] {
  return own[field].filter((v) => !only || conceptsIn([v]).some((k) => only.has(k))).map((value) => ({ field, value }));
}

const intersect = (a: Iterable<string>, b: Set<string>) => [...new Set(a)].filter((x) => b.has(x));

/** Deterministic candidates from the concept lexicon. */
export function ruleCandidates(own: OwnCompanyContext, profile: TargetProfile): Candidate[] {
  const ix = indexTarget(profile);
  const out: Candidate[] = [];
  const offerText = [...own.offerings, ...(own.offerings.length === 0 && own.summary ? [own.summary] : [])];
  const ownOffer = new Set(conceptsIn(offerText));
  const ownTypes = new Set([...ownOffer].filter((k) => concept(k)?.category === "offering_type"));
  const ownSegments = new Set(conceptsIn([...own.customerSegments, ...own.markets]).filter((k) => ["industry", "customer_type"].includes(concept(k)?.category ?? "")));
  const ownGeo = new Set(conceptsIn([...own.geographies, ...own.markets], "geography"));
  const tIndustry = targetConcepts(ix, ["industry", "customer_type"]);
  const tTypes = targetConcepts(ix, ["offering_type"]);
  const tTech = targetConcepts(ix, ["technology"]);
  const tGeo = targetConcepts(ix, ["geography"]);
  const ownOfferFacts: OwnFact[] = own.offerings.length > 0 ? own.offerings.slice(0, 4).map((value) => ({ field: "offerings", value })) : own.summary ? [{ field: "summary", value: own.summary.slice(0, 300) }] : [];
  // Timing only from dated strategy statements that touch the candidate's drivers or the own company's markets.
  const strategy = ix.evidence.filter((c) => c.field === "strategy" && c.epistemic === "fact");
  const whyNow = (drivers: string[]) => {
    const relevant = new Set([...drivers, ...ownSegments, ...ownGeo]);
    return strategy.filter((c) => c.concepts.some((k) => relevant.has(k))).map((c) => c.id).slice(0, 2);
  };
  const push = (c: Omit<Candidate, "id" | "origin" | "whyNowClaimIds" | "targetClaimIds"> & { targetClaimIds?: string[] }) =>
    out.push({ ...c, id: `r-${c.rule}`, origin: "rules", targetClaimIds: c.targetClaimIds ?? claimsFor(ix, c.drivers), whyNowClaimIds: whyNow(c.drivers) });

  // 1. The target operates in a segment the own company sells to → potential customer.
  const segments = intersect(ownSegments, tIndustry);
  if (segments.length > 0 && ownOfferFacts.length > 0) {
    push({ relationship: "customer", rule: "segment_customer", drivers: segments, ownBrings: [...ownOfferFacts, ...facts(own, "customerSegments", new Set(segments)), ...facts(own, "markets", new Set(segments))] });
  }

  // 2. The target offers something the own company is looking for → potential supplier.
  const soughtConcepts = new Set(conceptsIn(own.soughtCapabilities));
  const soughtHits = intersect(soughtConcepts, new Set([...tTypes, ...tTech]));
  const phraseHits = own.soughtCapabilities
    .map((s) => foldText(s))
    .filter((p) => p.length >= 5 && ix.evidence.some((c) => c.excerpt && foldText(c.excerpt).includes(p)))
    .map((p) => `~${p}`);
  if (soughtHits.length + phraseHits.length > 0) {
    push({ relationship: "supplier", rule: "sought_capability", drivers: [...soughtHits, ...phraseHits], ownBrings: own.soughtCapabilities.map((value) => ({ field: "soughtCapabilities", value })) });
  }

  // 3. The target resells / integrates in a segment or region the own company targets → channel.
  if (tTypes.has("distribution") && ownOfferFacts.length > 0) {
    const reach = [...segments, ...intersect(ownGeo, tGeo)];
    if (reach.length > 0) push({ relationship: "channel", rule: "channel", drivers: ["distribution", ...reach], ownBrings: [...ownOfferFacts, ...facts(own, "geographies", new Set(reach))] });
  }

  // 4. Same segment or technology, complementary offering types → technology / integration partner.
  const sharedTech = intersect([...ownOffer].filter((k) => concept(k)?.category === "technology"), tTech).filter((k) => !isGeneric(k));
  const shared = [...segments.filter((k) => !isGeneric(k)), ...sharedTech];
  const ownOnly = [...ownTypes].filter((k) => !tTypes.has(k) && !isGeneric(k));
  const targetOnly = [...tTypes].filter((k) => !ownTypes.has(k) && !isGeneric(k) && k !== "distribution");
  if (shared.length > 0 && ownOnly.length > 0 && targetOnly.length > 0) {
    push({
      relationship: sharedTech.length > 0 ? "integration" : "technology_partner",
      rule: "complementary",
      drivers: [...shared, ...targetOnly],
      ownBrings: [...ownOfferFacts],
    });
  }

  // 5. The own company builds hardware for others; the target sells hardware → OEM/ODM.
  const builds = intersect(["manufacturing", "oem_odm"], ownTypes);
  const hw = intersect(["hardware", "servers", "components"], tTypes);
  if (builds.length > 0 && hw.length > 0) push({ relationship: "oem", rule: "oem_build", drivers: [...builds.filter((k) => ownOffer.has(k)), ...hw], targetClaimIds: claimsFor(ix, hw), ownBrings: ownOfferFacts });

  return out;
}

/** Converts model hypotheses into candidates, keeping only references that exist. */
export function modelCandidates(hypotheses: readonly ModelHypothesis[], own: OwnCompanyContext, profile: TargetProfile): Candidate[] {
  const ix = indexTarget(profile);
  const known = new Set(ix.evidence.map((c) => c.id));
  return hypotheses.slice(0, 5).map((h, i) => {
    const ownBrings: OwnFact[] = [];
    for (const f of h.ownFields) {
      if (f === "summary") {
        if (own.summary) ownBrings.push({ field: f, value: own.summary.slice(0, 300) });
      } else if (f === "partnershipGoals") {
        if (own.partnershipGoals.length) ownBrings.push({ field: f, value: own.partnershipGoals.join(", ") });
      } else for (const value of own[f].slice(0, 4)) ownBrings.push({ field: f, value });
    }
    const targetClaimIds = h.targetClaimIds.filter((id) => known.has(id));
    const claimConcepts = ix.evidence.filter((c) => targetClaimIds.includes(c.id)).flatMap((c) => c.concepts);
    const textConcepts = conceptsIn([h.mechanism, h.targetBrings]);
    return {
      id: `m-${i + 1}`,
      relationship: h.relationship,
      origin: "model" as const,
      drivers: [...new Set(claimConcepts.filter((k) => textConcepts.includes(k) || !isGeneric(k)))],
      ownBrings,
      targetClaimIds,
      whyNowClaimIds: h.whyNowClaimIds.filter((id) => known.has(id)),
      narrative: { title: h.title, mechanism: h.mechanism, ownBrings: h.ownBrings, targetBrings: h.targetBrings, assumptions: h.assumptions, questions: h.questions, nextStep: h.nextStep },
    };
  });
}

/** The quality gate. Deterministic: the same inputs always produce the same verdict. */
export function critique(candidate: Candidate, own: OwnCompanyContext, profile: TargetProfile): EvaluatedCandidate {
  const ix = indexTarget(profile);
  const checks: Check[] = [];
  const add = (id: CheckId, result: CheckResult, code: string) => checks.push({ id, result, code });
  const support = ix.evidence.filter((c) => candidate.targetClaimIds.includes(c.id));

  add("target_evidence", support.length > 0 ? "pass" : "fail", support.length > 0 ? "sourced" : "missing");
  add("own_context", candidate.ownBrings.length > 0 ? "pass" : "fail", candidate.ownBrings.length > 0 ? "profile" : "missing");

  const specific = candidate.drivers.some((d) => d.startsWith("~") || !isGeneric(d));
  const words = candidate.narrative ? `${candidate.narrative.title} ${candidate.narrative.mechanism}` : "";
  if (candidate.narrative && hasGenericLanguage(words)) add("specificity", "fail", "generic_language");
  else add("specificity", specific ? "pass" : "fail", specific ? "specific" : "generic");

  const mechanismDefined = candidate.narrative
    ? candidate.narrative.ownBrings.trim().length >= 8 && candidate.narrative.targetBrings.trim().length >= 8 && !hasGenericLanguage(`${candidate.narrative.ownBrings} ${candidate.narrative.targetBrings}`)
    : Boolean(candidate.rule);
  add("mechanism", mechanismDefined ? "pass" : "fail", mechanismDefined ? "defined" : "undefined");

  if (own.partnershipGoals.length === 0) add("goal_fit", "warn", "unset");
  else add("goal_fit", own.partnershipGoals.includes(candidate.relationship) ? "pass" : "warn", own.partnershipGoals.includes(candidate.relationship) ? "aligned" : "outside");

  const distinct = new Set(support.map((c) => c.excerpt)).size;
  add("corroboration", distinct >= 2 ? "pass" : "warn", distinct >= 2 ? "multiple" : "single");
  add("timing", candidate.whyNowClaimIds.length > 0 ? "pass" : "info", candidate.whyNowClaimIds.length > 0 ? "evidence" : "unknown");

  const fails = checks.filter((c) => c.result === "fail").length;
  const warns = checks.filter((c) => c.result === "warn").length;
  const verdict: Verdict = fails > 0 ? "reject" : warns >= 2 ? "weak" : "pass";
  const thirdParty = support.some((c) => profile.sources.find((s) => s.key === c.sourceKey)?.authority === "third_party");
  const confidence: ConfidenceLevel =
    verdict !== "pass" ? "limited" : warns === 0 && candidate.whyNowClaimIds.length > 0 && thirdParty ? "strong" : warns === 0 ? "moderate" : "limited";
  return { ...candidate, verdict, checks, confidence };
}

export function ownProfileGaps(own: OwnCompanyContext): OwnProfileField[] {
  const gaps: OwnProfileField[] = [];
  if (own.offerings.length === 0) gaps.push("offerings");
  if (own.customerSegments.length === 0 && own.markets.length === 0) gaps.push("customerSegments");
  if (own.geographies.length === 0) gaps.push("geographies");
  if (own.soughtCapabilities.length === 0) gaps.push("soughtCapabilities");
  if (own.partnershipGoals.length === 0) gaps.push("partnershipGoals");
  if (!own.summary && own.offerings.length === 0) gaps.unshift("summary");
  return gaps;
}

function possibleCompetitor(own: OwnCompanyContext, profile: TargetProfile): Insight | null {
  const ix = indexTarget(profile);
  const ownOffer = conceptsIn([...own.offerings]).filter((k) => ["offering_type", "technology"].includes(concept(k)?.category ?? "") && !isGeneric(k));
  const shared = intersect(ownOffer, targetConcepts(ix, ["offering_type", "technology"]));
  if (shared.length < 2) return null;
  return { code: "possible_competitor", drivers: shared, claimIds: claimsFor(ix, shared) };
}

const RANK: Record<ConfidenceLevel, number> = { strong: 0, moderate: 1, limited: 2 };

export function analyzeRelevance(own: OwnCompanyContext | null, profile: TargetProfile, hypotheses: readonly ModelHypothesis[] = []): RelevanceAnalysis {
  if (!own || (own.offerings.length === 0 && !own.summary)) {
    return {
      status: "own_profile_missing",
      opportunities: [],
      hypotheses: [],
      rejected: [],
      insights: [],
      ownGaps: own ? ownProfileGaps(own) : ["summary", "offerings", "customerSegments", "geographies", "soughtCapabilities", "partnershipGoals"],
      targetUnknowns: profile.unknowns,
    };
  }
  const evaluated = [...ruleCandidates(own, profile), ...modelCandidates(hypotheses, own, profile)].map((c) => critique(c, own, profile));
  const byStrength = (a: EvaluatedCandidate, b: EvaluatedCandidate) => RANK[a.confidence] - RANK[b.confidence] || b.targetClaimIds.length - a.targetClaimIds.length;
  const opportunities = evaluated.filter((c) => c.verdict === "pass").sort(byStrength).slice(0, MAX_OPPORTUNITIES);
  const weak = evaluated.filter((c) => c.verdict === "weak").sort(byStrength).slice(0, MAX_HYPOTHESES);
  const competitor = possibleCompetitor(own, profile);
  return {
    status: opportunities.length > 0 ? "opportunities" : weak.length > 0 ? "hypotheses_only" : "none",
    opportunities,
    hypotheses: weak,
    rejected: evaluated.filter((c) => c.verdict === "reject").slice(0, MAX_REJECTED),
    insights: competitor ? [competitor] : [],
    ownGaps: ownProfileGaps(own),
    targetUnknowns: profile.unknowns,
  };
}
