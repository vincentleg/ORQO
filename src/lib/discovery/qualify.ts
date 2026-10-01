/**
 * Stage 2 of the discovery funnel — narrow and evidence-based.
 *
 * qualifyCandidate: the VERIFIED target profile (retrieved official sources,
 * Phase 3 extraction) goes through the unchanged Phase 3 mechanism rules and
 * critic, restricted to the mechanisms of the Discovery Plan.
 *
 * criticizeCandidate: the discovery critic on top — requested geography and
 * market, a substantive-evidence floor, competitor risk — then an explainable
 * priority tier from explicit dimensions. No score, no probability.
 */
import type { Locale } from "@/lib/i18n/config";
import { concept, foldText } from "@/lib/intelligence/concepts";
import { isSourcedEvidence } from "@/lib/intelligence/extract";
import { analyzeRelevance, evidenceWeight, type EvaluatedCandidate, type ValidationKey } from "@/lib/intelligence/relevance";
import type { Claim, ConfidenceLevel, ModelHypothesis, OwnCompanyContext, RelationshipType, TargetProfile, UnderstandingField } from "@/lib/intelligence/types";
import { validationQuestion } from "@/lib/intelligence/wording";
import type { DiscoveryMechanism, DiscoveryPlan, PlanFilter } from "./plan";
import type { Priority, RejectionReason } from "./types";

export interface EvidenceRef {
  text: string;
  source: string | null;
  url: string | null;
  epistemic: "fact" | "inference";
  /** The company describing itself (authoritative about positioning, not independent proof). */
  selfDescribed: boolean;
}

export interface QualifiedMechanism {
  rule: DiscoveryMechanism;
  relationship: RelationshipType;
  /** Concept keys or "~phrase": what drives the mechanism. */
  drivers: string[];
  /** Own value-chain services the mechanism relies on (concept keys). */
  ownServices: string[];
  geographies: string[];
  /** Own-profile values the workspace contributes. */
  ownBrings: string[];
  validation: ValidationKey[];
  confidence: ConfidenceLevel;
  /** Matches a partnership type the workspace selected (true when none are selected). */
  aligned: boolean;
  goalsSet: boolean;
  corroborated: boolean;
}

export interface Qualification {
  verdict: "qualified" | "weak" | "rejected";
  reason: RejectionReason | null;
  mechanism: QualifiedMechanism | null;
  evidence: EvidenceRef[];
  /** Dated, sourced strategy statements only. Empty → Why now is not established. */
  whyNow: EvidenceRef[];
  /** At least one substantive FACT (full sentence or named product) supports the mechanism. */
  substantive: boolean;
  /** null: the target's sources say nothing about it (UNKNOWN, not a mismatch). */
  geographyMatch: boolean | null;
  marketMatch: boolean | null;
  competitorRisk: boolean;
  unknownFields: UnderstandingField[];
  nextQuestion: string | null;
}

const CONF_RANK: Record<ConfidenceLevel, number> = { strong: 0, moderate: 1, limited: 2 };

function refOf(c: Claim, profile: TargetProfile): EvidenceRef {
  const s = c.sourceKey ? profile.sources.find((x) => x.key === c.sourceKey) : undefined;
  return {
    text: (c.excerpt ?? c.statement).slice(0, 300),
    source: s ? (s.title || s.url).slice(0, 200) : null,
    url: s && /^https?:\/\//.test(s.url) ? s.url : null,
    epistemic: c.epistemic === "fact" ? "fact" : "inference",
    selfDescribed: c.selfDescribed,
  };
}

function filterMatch(filter: PlanFilter | null, evidence: Claim[], categories: string[]): boolean | null {
  if (!filter) return null;
  const relevant = evidence.filter((c) => c.concepts.some((k) => categories.includes(concept(k)?.category ?? "")));
  const byPhrase = filter.phrase !== null && evidence.some((c) => c.excerpt && foldText(c.excerpt).includes(filter.phrase!));
  if (byPhrase || relevant.some((c) => c.concepts.some((k) => filter.concepts.includes(k)))) return true;
  return relevant.length > 0 ? false : null;
}

function rejectionFrom(c: EvaluatedCandidate): RejectionReason {
  const failed = (id: string) => c.checks.some((x) => x.id === id && x.result === "fail");
  if (failed("target_evidence")) return "insufficient_evidence";
  if (failed("specificity")) return "category_overlap_only";
  return "no_concrete_mechanism";
}

/** Mechanism-based qualification of one verified company against the Discovery Plan. */
export function qualifyCandidate(own: OwnCompanyContext, plan: DiscoveryPlan, profile: TargetProfile, hypotheses: readonly ModelHypothesis[], locale: Locale): Qualification {
  const analysis = analyzeRelevance(own, profile, hypotheses);
  const evidence = profile.claims.filter((c) => isSourcedEvidence(c, profile.sources));
  const inPlan = (c: EvaluatedCandidate) => c.rule !== undefined && (plan.mechanisms as readonly string[]).includes(c.rule);
  const byStrength = (a: EvaluatedCandidate, b: EvaluatedCandidate) => CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || Number(b.aligned) - Number(a.aligned) || b.targetClaimIds.length - a.targetClaimIds.length;

  // An explicit objective is the user's current goal: a passing mechanism outside the workspace's
  // declared partnership types is still a candidate (alignment then lowers its priority).
  const passing = [...analysis.opportunities, ...analysis.observations].filter(inPlan).sort(byStrength);
  const weak = analysis.hypotheses.filter((c) => inPlan(c) && c.mechanism === "concrete").sort(byStrength);
  const rejectedInPlan = analysis.rejected.filter(inPlan);
  const best = passing[0] ?? weak[0] ?? null;

  let verdict: Qualification["verdict"] = passing.length > 0 ? "qualified" : weak.length > 0 ? "weak" : "rejected";
  let reason: RejectionReason | null = null;
  if (verdict === "rejected") {
    const outsidePlan = [...analysis.opportunities, ...analysis.observations].some((c) => !inPlan(c) && c.mechanism === "concrete");
    const contextualOnly = [...analysis.hypotheses, ...analysis.rejected].some((c) => c.mechanism === "contextual");
    if (rejectedInPlan[0]) reason = rejectionFrom(rejectedInPlan[0]);
    else if (outsidePlan) reason = "relationship_not_aligned";
    else if (contextualOnly) reason = "category_overlap_only";
    else reason = evidence.length < 2 ? "insufficient_evidence" : "no_concrete_mechanism";
  }

  const support = best ? evidence.filter((c) => best.targetClaimIds.includes(c.id)).sort((a, b) => evidenceWeight(b) - evidenceWeight(a)) : [];
  const substantive = support.some((c) => c.epistemic === "fact" && evidenceWeight(c) >= 3);
  if (verdict === "qualified" && !substantive) verdict = "weak";

  const whyNowClaims = best ? evidence.filter((c) => best.whyNowClaimIds.includes(c.id) && c.field === "strategy" && c.epistemic === "fact") : [];
  const geographyMatch = filterMatch(plan.geography, evidence, ["geography"]);
  const marketMatch = filterMatch(plan.market, evidence, ["industry", "customer_type"]);
  const unknownFields = [...profile.unknowns];
  if (plan.geography && geographyMatch === null && !unknownFields.includes("geography")) unknownFields.push("geography");
  if (plan.market && marketMatch === null && !unknownFields.includes("industry")) unknownFields.push("industry");

  return {
    verdict,
    reason,
    mechanism: best
      ? {
          rule: best.rule as DiscoveryMechanism,
          relationship: best.relationship,
          drivers: best.drivers.slice(0, 8),
          ownServices: best.ownServices.slice(0, 8),
          geographies: best.geographies.slice(0, 6),
          ownBrings: best.ownBrings.map((f) => f.value.slice(0, 160)).slice(0, 4),
          validation: best.validation.slice(0, 5),
          confidence: best.confidence,
          aligned: best.aligned,
          goalsSet: own.partnershipGoals.length > 0,
          corroborated: best.checks.some((c) => c.id === "corroboration" && c.result === "pass"),
        }
      : null,
    evidence: support.slice(0, 3).map((c) => refOf(c, profile)),
    whyNow: whyNowClaims.slice(0, 2).map((c) => refOf(c, profile)),
    substantive,
    geographyMatch,
    marketMatch,
    competitorRisk: analysis.insights.some((i) => i.code === "possible_competitor"),
    unknownFields: unknownFields.slice(0, 9),
    nextQuestion: best ? (validationQuestion(best, profile.name, own.name, locale)?.slice(0, 400) ?? null) : null,
  };
}

export interface PriorityDimensions {
  /** The critic accepted a concrete mechanism (vs. gaps found). */
  mechanism: "accepted" | "gaps";
  /** Two or more distinct substantive statements support it. */
  evidence: "corroborated" | "single";
  /** The mechanism's relationship is one the workspace selected. */
  alignment: "aligned" | "outside_goals" | "goals_unset";
  /** Dated, sourced timing evidence exists. */
  timing: "dated" | "not_established";
  /** Unknowns that must be resolved before acting. */
  openQuestions: number;
  competitorRisk: boolean;
}

export interface CriticDecision {
  verdict: "qualified" | "weak" | "rejected";
  reason: RejectionReason | null;
  priority: Priority | null;
  dimensions: PriorityDimensions | null;
}

/** The discovery critic: requested geography/market, then an explainable priority tier. */
export function criticizeCandidate(plan: DiscoveryPlan, q: Qualification): CriticDecision {
  if (q.verdict === "rejected" || !q.mechanism) return { verdict: "rejected", reason: q.reason ?? "no_concrete_mechanism", priority: null, dimensions: null };
  const m = q.mechanism;
  if (plan.geography) {
    // Regional deployment exists BECAUSE the target is absent from the region: presence there removes the mechanism.
    if (m.rule === "regional_deployment" && q.geographyMatch === true) return { verdict: "rejected", reason: "region_already_covered", priority: null, dimensions: null };
    if (m.rule !== "regional_deployment" && q.geographyMatch === false) return { verdict: "rejected", reason: "outside_geography", priority: null, dimensions: null };
  }
  if (plan.market && q.marketMatch === false) return { verdict: "rejected", reason: "outside_market", priority: null, dimensions: null };

  const dimensions: PriorityDimensions = {
    mechanism: q.verdict === "qualified" ? "accepted" : "gaps",
    evidence: m.corroborated && q.substantive ? "corroborated" : "single",
    alignment: !m.goalsSet ? "goals_unset" : m.aligned ? "aligned" : "outside_goals",
    timing: q.whyNow.length > 0 ? "dated" : "not_established",
    openQuestions: m.validation.length + q.unknownFields.length,
    competitorRisk: q.competitorRisk,
  };
  const priority: Priority =
    q.verdict === "weak" ? "weak" : dimensions.evidence === "corroborated" && dimensions.alignment === "aligned" && !q.competitorRisk && m.confidence !== "limited" ? "high" : "worth_investigating";
  return { verdict: q.verdict, reason: q.verdict === "weak" ? "insufficient_evidence" : null, priority, dimensions };
}

const P_RANK: Record<Priority, number> = { high: 0, worth_investigating: 1, weak: 2 };

/** Deterministic order: priority tier, then dated timing, then corroboration, then fewer open questions. */
export function compareDecisions(a: { priority: Priority; dimensions: PriorityDimensions }, b: { priority: Priority; dimensions: PriorityDimensions }): number {
  return (
    P_RANK[a.priority] - P_RANK[b.priority] ||
    Number(b.dimensions.timing === "dated") - Number(a.dimensions.timing === "dated") ||
    Number(b.dimensions.evidence === "corroborated") - Number(a.dimensions.evidence === "corroborated") ||
    a.dimensions.openQuestions - b.dimensions.openQuestions
  );
}
