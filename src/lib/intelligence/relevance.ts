/**
 * Business relevance: TARGET company vs the workspace's OWN company.
 *
 * Candidates come from two places:
 * - deterministic rules, each encoding a concrete BUSINESS MECHANISM (who does
 *   what for whom), never mere category overlap;
 * - model hypotheses (deep research only), which are untrusted proposals.
 * Every candidate goes through the same deterministic critic. Then the
 * workspace's declared partnership goals decide what is shown as a primary
 * opportunity: a relationship type the workspace did not select is at most a
 * low-priority observation. ORQO never invents strategic intent.
 */
import { concept, conceptsIn, foldText, isGeneric } from "./concepts";
import { isOpennessSignal, isSourcedEvidence } from "./extract";
import type { Claim, ConfidenceLevel, ModelHypothesis, OwnCompanyContext, OwnProfileField, RelationshipType, TargetProfile, UnderstandingField } from "./types";

export const RULES = ["build_for", "regional_deployment", "sought_capability", "channel", "combined_offer", "segment_customer"] as const;
export type RuleCode = (typeof RULES)[number];

/**
 * What must be learned to confirm or kill an opportunity, derived from its
 * mechanism. Ordered by decision value: the first one drives the next action.
 */
export const VALIDATION_KEYS = [
  "production_model",
  "manufacturing_partners",
  "outsourced_services",
  "deployment_geography",
  "volumes_stage",
  "regional_plans",
  "fit_requirements",
  "sells_to_peers",
  "channel_coverage",
  "onboarding_terms",
  "combined_offer_demand",
  "technical_compatibility",
  "buyer_need",
  "sourcing_today",
] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];

export interface OwnFact {
  field: OwnProfileField;
  value: string;
}

export interface Candidate {
  id: string;
  relationship: RelationshipType;
  origin: "rules" | "model";
  rule?: RuleCode;
  /**
   * concrete: one party performs, supplies, sells or deploys something specific for the other.
   * contextual: only shared context (e.g. same segment); can never be more than a hypothesis.
   */
  mechanism: "concrete" | "contextual";
  /** Concept keys, or "~phrase" for a literal phrase from the own profile found on the target's pages. */
  drivers: string[];
  /** Own value-chain services that make the mechanism work (concept keys). */
  ownServices: string[];
  ownBrings: OwnFact[];
  targetClaimIds: string[];
  whyNowClaimIds: string[];
  /** Highest-value unknowns first. */
  validation: ValidationKey[];
  /** Own geographies the mechanism targets (for validation wording). */
  geographies: string[];
  /**
   * Other existing relationship types this same mechanism also satisfies as a partnership goal (see goalFits).
   * Set by the rule that knows the mechanism; never by a model, never "everything".
   */
  alsoFits?: RelationshipType[];
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
  /**
   * Internal evidence-grounding level of the candidate (how well sourced it is), used for ordering and by
   * Discover/agents. It is NOT confidence that the business opportunity is valid: the Search card shows the
   * Phase 11 support state instead.
   */
  confidence: ConfidenceLevel;
  /**
   * Whether some side is shown to NEED this mechanism (see demandEstablished). Not a critic check: it does not
   * change the verdict or the confidence above; it caps the Phase 11 support state and is shown in the critic.
   */
  demand: boolean;
  /** Matches a partnership type the workspace selected (true when none are selected yet). */
  aligned: boolean;
}

export interface Insight {
  code: "possible_competitor";
  drivers: string[];
  claimIds: string[];
}

export type AnalysisStatus = "opportunities" | "hypotheses_only" | "none" | "own_profile_missing";

export interface RelevanceAnalysis {
  status: AnalysisStatus;
  /** Passed the critic AND matches a selected partnership type. */
  opportunities: EvaluatedCandidate[];
  /** Aligned, but the critic found gaps (or the mechanism is only contextual). */
  hypotheses: EvaluatedCandidate[];
  /** Passed the critic but is a relationship type the workspace did not select. Low priority. */
  observations: EvaluatedCandidate[];
  rejected: EvaluatedCandidate[];
  insights: Insight[];
  /** Own-profile fields whose absence limits the comparison. */
  ownGaps: OwnProfileField[];
  targetUnknowns: UnderstandingField[];
}

export const MAX_OPPORTUNITIES = 3;
export const MAX_HYPOTHESES = 3;
export const MAX_OBSERVATIONS = 2;
export const MAX_REJECTED = 6;

const GENERIC_LANGUAGE =
  /\b(synerg\w*|leverage each other|collaborat\w* to (create|drive|unlock)|both (companies )?(use|leverage|are in|work in|operate in|focus on|sell|make) (ai|artificial intelligence|technology|tech|innovation|the tech|hardware|software)|win-win|explore (potential |possible )?(opportunities|collaboration|synergies)|strategic synergies|could partner to innovate|complementary (strengths|offerings|expertise))\b/i;

export function hasGenericLanguage(text: string): boolean {
  return GENERIC_LANGUAGE.test(text);
}

/** Physical products another company can build, integrate, test, stock or deploy. */
export const PHYSICAL = ["hardware", "servers", "components"];
/** Own value-chain services that apply to someone else's physical product. */
export const BUILD_SERVICES = ["manufacturing", "oem_odm", "assembly_integration", "testing_validation", "traceability", "branding_packaging", "logistics_services", "deployment_services"];
export const SOFTWARE = ["software", "saas", "platform"];

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

/** A short heading or slogan is weaker evidence than a full sentence or a named product. */
export function evidenceWeight(c: Claim): number {
  return (c.epistemic === "fact" ? 2 : 0) + (c.field === "product" || (c.excerpt?.length ?? 0) >= 40 ? 1 : 0);
}

function claimsFor(ix: TargetIndex, drivers: string[]): string[] {
  const found = new Map<string, Claim>();
  for (const d of drivers) {
    if (d.startsWith("~")) {
      const phrase = d.slice(1);
      for (const c of ix.evidence) if (c.excerpt && foldText(c.excerpt).includes(phrase)) found.set(c.id, c);
    } else for (const c of ix.byConcept.get(d) ?? []) found.set(c.id, c);
  }
  return [...found.values()]
    .sort((a, b) => evidenceWeight(b) - evidenceWeight(a))
    .slice(0, 8)
    .map((c) => c.id);
}

function facts(own: OwnCompanyContext, field: Exclude<OwnProfileField, "summary" | "partnershipGoals">, only?: Set<string>): OwnFact[] {
  return own[field].filter((v) => !only || conceptsIn([v]).some((k) => only.has(k))).map((value) => ({ field, value }));
}

const intersect = (a: Iterable<string>, b: Set<string>) => [...new Set(a)].filter((x) => b.has(x));

/** Deterministic candidates. Each rule is a business mechanism, not a similarity score. */
export function ruleCandidates(own: OwnCompanyContext, profile: TargetProfile): Candidate[] {
  const ix = indexTarget(profile);
  const out: Candidate[] = [];
  const offerText = [...own.offerings, ...(own.offerings.length === 0 && own.summary ? [own.summary] : [])];
  const ownOffer = new Set(conceptsIn(offerText));
  const ownTypes = new Set([...ownOffer].filter((k) => concept(k)?.category === "offering_type"));
  const ownServices = BUILD_SERVICES.filter((k) => ownOffer.has(k));
  const ownSegments = new Set(conceptsIn([...own.customerSegments, ...own.markets]).filter((k) => ["industry", "customer_type"].includes(concept(k)?.category ?? "")));
  const ownGeo = new Set(conceptsIn([...own.geographies, ...own.markets], "geography"));
  const tIndustry = targetConcepts(ix, ["industry", "customer_type"]);
  const tTypes = targetConcepts(ix, ["offering_type"]);
  const tTech = targetConcepts(ix, ["technology"]);
  const tGeo = targetConcepts(ix, ["geography"]);
  const tPhysical = intersect(PHYSICAL, tTypes);
  const tSoftwareOnly = intersect(SOFTWARE, tTypes).length > 0 && tPhysical.length === 0;
  const ownPhysical = intersect(PHYSICAL, ownTypes);
  const ownGeoUncovered = [...ownGeo].filter((g) => !tGeo.has(g));
  const ownGeoNames = own.geographies.length > 0 ? own.geographies : own.markets.filter((m) => conceptsIn([m], "geography").length > 0);
  const ownOfferFacts: OwnFact[] = own.offerings.length > 0 ? own.offerings.slice(0, 4).map((value) => ({ field: "offerings", value })) : own.summary ? [{ field: "summary", value: own.summary.slice(0, 300) }] : [];
  // Timing only from dated strategy statements that touch the candidate's drivers or the own company's markets.
  const strategy = ix.evidence.filter((c) => c.field === "strategy" && c.epistemic === "fact");
  const whyNow = (drivers: string[]) => {
    const relevant = new Set([...drivers, ...ownSegments, ...ownGeo]);
    return strategy.filter((c) => c.concepts.some((k) => relevant.has(k))).map((c) => c.id).slice(0, 2);
  };
  const push = (c: Omit<Candidate, "id" | "origin" | "whyNowClaimIds" | "targetClaimIds" | "ownServices" | "geographies"> & { targetClaimIds?: string[]; ownServices?: string[]; geographies?: string[] }) =>
    out.push({ ownServices: [], geographies: [], ...c, id: `r-${c.rule}`, origin: "rules", targetClaimIds: c.targetClaimIds ?? claimsFor(ix, c.drivers), whyNowClaimIds: whyNow(c.drivers) });

  // 1. The target sells physical products; the own company can build, integrate, test, stock or brand them.
  const buildCore = intersect(["manufacturing", "oem_odm", "assembly_integration", "testing_validation"], new Set(ownServices));
  if (tPhysical.length > 0 && buildCore.length > 0) {
    const makes = buildCore.some((k) => k === "manufacturing" || k === "oem_odm");
    // The first question is the one that kills the mechanism soonest: does the target hand THESE services to someone else?
    // A manufacturer asks about the production model; a company that only integrates, tests or deploys asks about those services.
    const validation: ValidationKey[] = makes ? ["production_model", "manufacturing_partners"] : ["outsourced_services", "manufacturing_partners"];
    if (makes && ownServices.some((k) => !["manufacturing", "oem_odm"].includes(k))) validation.push("outsourced_services");
    if (ownGeoUncovered.length > 0) validation.push("deployment_geography");
    validation.push("volumes_stage");
    const relationship: RelationshipType = makes ? "oem" : "integration";
    push({
      relationship,
      // Building or integrating another company's product is one value chain (OEM/ODM ⇄ integration), and that
      // company would pay for the service, so it is also a potential customer. Not a technology, channel or strategic tie.
      alsoFits: (["oem", "integration", "customer"] as const).filter((r) => r !== relationship),
      rule: "build_for",
      mechanism: "concrete",
      drivers: [...ownServices, ...tPhysical],
      ownServices,
      targetClaimIds: claimsFor(ix, tPhysical),
      ownBrings: ownOfferFacts,
      validation,
      geographies: ownGeoNames,
    });
  }

  // 2. The own company can deploy, stock or support the target's products in regions where the target shows no presence.
  const regionalServices = intersect(["deployment_services", "logistics_services", "distribution"], ownOffer);
  if (tPhysical.length > 0 && regionalServices.length > 0 && ownGeoUncovered.length > 0) {
    push({
      relationship: "market_entry",
      rule: "regional_deployment",
      mechanism: "concrete",
      drivers: [...regionalServices, ...ownGeoUncovered],
      ownServices: regionalServices,
      targetClaimIds: claimsFor(ix, tPhysical),
      ownBrings: [...ownOfferFacts, ...facts(own, "geographies")],
      validation: ["deployment_geography", "regional_plans", "volumes_stage"],
      geographies: ownGeoNames,
    });
  }

  // 3. The target offers something the own company says it is looking for → supplier.
  const soughtConcepts = new Set(conceptsIn(own.soughtCapabilities));
  const soughtHits = intersect(soughtConcepts, new Set([...tTypes, ...tTech]));
  const phraseHits = own.soughtCapabilities
    .map((s) => foldText(s))
    .filter((p) => p.length >= 5 && ix.evidence.some((c) => c.excerpt && foldText(c.excerpt).includes(p)))
    .map((p) => `~${p}`);
  if (soughtHits.length + phraseHits.length > 0) {
    push({
      relationship: "supplier",
      rule: "sought_capability",
      mechanism: "concrete",
      drivers: [...soughtHits, ...phraseHits],
      ownBrings: own.soughtCapabilities.map((value) => ({ field: "soughtCapabilities", value })),
      validation: ["fit_requirements", "sells_to_peers"],
    });
  }

  // 4. The target resells / distributes in a segment or region the own company targets → channel.
  const segments = intersect(ownSegments, tIndustry);
  if (tTypes.has("distribution") && ownOfferFacts.length > 0) {
    const reach = [...segments.filter((k) => !isGeneric(k)), ...intersect(ownGeo, tGeo)];
    if (reach.length > 0) {
      push({ relationship: "channel", rule: "channel", mechanism: "concrete", drivers: ["distribution", ...reach], ownBrings: [...ownOfferFacts, ...facts(own, "geographies", new Set(reach))], validation: ["channel_coverage", "onboarding_terms"] });
    }
  }

  // 5. Hardware + software that can be sold as one concrete offer, in a shared specific space.
  const sharedSpace = [...segments, ...intersect([...ownOffer].filter((k) => concept(k)?.category === "technology"), tTech)].filter((k) => !isGeneric(k));
  const ownSoftwareOnly = intersect(SOFTWARE, ownTypes).length > 0 && ownPhysical.length === 0;
  if (sharedSpace.length > 0 && ((ownPhysical.length > 0 && tSoftwareOnly) || (ownSoftwareOnly && tPhysical.length > 0))) {
    const complement = ownPhysical.length > 0 ? intersect(SOFTWARE, tTypes) : tPhysical;
    push({ relationship: "integration", rule: "combined_offer", mechanism: "concrete", drivers: [...sharedSpace, ...complement], ownBrings: ownOfferFacts, validation: ["combined_offer_demand", "technical_compatibility"] });
  }

  // 6. Same customer segment only: context, not a mechanism. Never more than a hypothesis.
  const specificSegments = segments.filter((k) => !isGeneric(k));
  if (specificSegments.length > 0 && ownOfferFacts.length > 0) {
    push({
      relationship: "customer",
      rule: "segment_customer",
      mechanism: "contextual",
      drivers: specificSegments,
      ownBrings: [...ownOfferFacts, ...facts(own, "customerSegments", new Set(specificSegments)), ...facts(own, "markets", new Set(specificSegments))],
      validation: ["buyer_need", "sourcing_today"],
    });
  }

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
      mechanism: "concrete" as const,
      drivers: [...new Set(claimConcepts.filter((k) => textConcepts.includes(k) || !isGeneric(k)))],
      ownServices: [],
      ownBrings,
      targetClaimIds,
      whyNowClaimIds: h.whyNowClaimIds.filter((id) => known.has(id)),
      validation: [],
      geographies: [],
      narrative: { title: h.title, mechanism: h.mechanism, ownBrings: h.ownBrings, targetBrings: h.targetBrings, assumptions: h.assumptions, questions: h.questions, nextStep: h.nextStep },
    };
  });
}

/**
 * Demand: is some side shown to NEED what the mechanism provides? Either the workspace declared it is looking for
 * it (its own "looking for" grounds the candidate), or the target states a need, as a sourced FACT, about one of
 * the mechanism's drivers. Evidence of what the target sells is not a need, and an openness-to-partners link is
 * only an inference. Timing and relationship are not inputs.
 */
export function demandEstablished(candidate: Pick<Candidate, "ownBrings" | "drivers">, profile: TargetProfile): boolean {
  if (candidate.ownBrings.some((f) => f.field === "soughtCapabilities")) return true;
  const drivers = new Set(candidate.drivers);
  return profile.claims.some((c) => c.field === "need" && c.epistemic === "fact" && !isOpennessSignal(c) && isSourcedEvidence(c, profile.sources) && c.concepts.some((k) => drivers.has(k)));
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

  if (candidate.narrative) {
    const defined =
      candidate.narrative.ownBrings.trim().length >= 8 && candidate.narrative.targetBrings.trim().length >= 8 && !hasGenericLanguage(`${candidate.narrative.ownBrings} ${candidate.narrative.targetBrings}`);
    add("mechanism", defined ? "pass" : "fail", defined ? "defined" : "undefined");
  } else if (!candidate.rule) add("mechanism", "fail", "undefined");
  else add("mechanism", candidate.mechanism === "concrete" ? "pass" : "warn", candidate.mechanism === "concrete" ? "defined" : "contextual");

  const aligned = own.partnershipGoals.length === 0 || goalFits(own.partnershipGoals, candidate);
  if (own.partnershipGoals.length === 0) add("goal_fit", "warn", "unset");
  else add("goal_fit", aligned ? "pass" : "warn", aligned ? "aligned" : "outside");

  // Independent support: distinct, substantive statements (not one slogan repeated).
  const distinct = new Set(support.filter((c) => evidenceWeight(c) > 0).map((c) => c.excerpt)).size;
  add("corroboration", distinct >= 2 ? "pass" : "warn", distinct >= 2 ? "multiple" : "single");
  add("timing", candidate.whyNowClaimIds.length > 0 ? "pass" : "info", candidate.whyNowClaimIds.length > 0 ? "evidence" : "unknown");

  const fails = checks.filter((c) => c.result === "fail").length;
  const warns = checks.filter((c) => c.result === "warn").length;
  // A contextual mechanism (shared segment only) can never be accepted as an opportunity.
  const verdict: Verdict = fails > 0 ? "reject" : warns >= 2 || candidate.mechanism === "contextual" ? "weak" : "pass";
  const thirdParty = support.some((c) => profile.sources.find((s) => s.key === c.sourceKey)?.authority === "third_party");
  const confidence: ConfidenceLevel =
    verdict !== "pass" ? "limited" : warns === 0 && candidate.whyNowClaimIds.length > 0 && thirdParty ? "strong" : warns === 0 ? "moderate" : "limited";
  return { ...candidate, verdict, checks, confidence, aligned, demand: demandEstablished(candidate, profile) };
}

/**
 * Whether a candidate matches one of the workspace's partnership goals: its own relationship type, or another
 * existing type its rule says the same mechanism satisfies. Compatibility comes from the mechanism, not from a
 * blanket mapping between types, so e.g. a hardware + software "integration" offer does not match an OEM goal.
 */
export function goalFits(goals: readonly RelationshipType[], candidate: Pick<Candidate, "relationship" | "alsoFits">): boolean {
  return goals.includes(candidate.relationship) || (candidate.alsoFits ?? []).some((r) => goals.includes(r));
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
      observations: [],
      rejected: [],
      insights: [],
      ownGaps: own ? ownProfileGaps(own) : ["summary", "offerings", "customerSegments", "geographies", "soughtCapabilities", "partnershipGoals"],
      targetUnknowns: profile.unknowns,
    };
  }
  const evaluated = [...ruleCandidates(own, profile), ...modelCandidates(hypotheses, own, profile)].map((c) => critique(c, own, profile));
  const byStrength = (a: EvaluatedCandidate, b: EvaluatedCandidate) => RANK[a.confidence] - RANK[b.confidence] || b.targetClaimIds.length - a.targetClaimIds.length;
  const opportunities = evaluated.filter((c) => c.verdict === "pass" && c.aligned).sort(byStrength).slice(0, MAX_OPPORTUNITIES);
  const weak = evaluated.filter((c) => c.verdict === "weak" && c.aligned).sort(byStrength).slice(0, MAX_HYPOTHESES);
  // Not selected by the workspace: only well-supported ones are kept, and only as observations.
  const observations = evaluated.filter((c) => c.verdict === "pass" && !c.aligned).sort(byStrength).slice(0, MAX_OBSERVATIONS);
  const competitor = possibleCompetitor(own, profile);
  return {
    status: opportunities.length > 0 ? "opportunities" : weak.length > 0 ? "hypotheses_only" : "none",
    opportunities,
    hypotheses: weak,
    observations,
    rejected: evaluated.filter((c) => c.verdict === "reject").slice(0, MAX_REJECTED),
    insights: competitor ? [competitor] : [],
    ownGaps: ownProfileGaps(own),
    targetUnknowns: profile.unknowns,
  };
}
