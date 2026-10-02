/**
 * Partnership Scenario Engine + Deal Critic + Revenue Hypotheses (Phase 15).
 *
 * Pure and deterministic. Input: two CommercialUnderstandings (Phase 14) —
 * the user's company and a target. Output: the business the two could
 * realistically build, sell, deliver, license or develop together, each
 * scenario traceable to Business DNA items (fact / inference) and to the
 * reviewed pair-mechanism catalog (hypothesis), then attacked by the critic.
 *
 * Rules the engine never breaks:
 * - a mechanism is proposed only when BOTH sides show the traits it needs;
 * - a new offering is always an ORQO-generated hypothesis;
 * - the critic only raises a finding whose trigger is met — and it can reject;
 * - zero scenarios is a valid answer;
 * - no amounts, prices, market sizes or probabilities exist anywhere here.
 */
import { conceptsIn, isGeneric } from "@/lib/intelligence/concepts";
import { mentions } from "./lexicon";
import { holds, type Trait } from "./ontology";
import { PAIR_MECHANISMS, SIGNAL_TERMS, type PairMechanism, type Payer, type QuestionKey, type Requirement, type RevenueStructure } from "./pairs";
import type { CommercialUnderstanding, DnaItem, KnowledgeState } from "./types";

export type Side = "own" | "target";
export const other = (s: Side): Side => (s === "own" ? "target" : "own");

export interface Party {
  name: string;
  understanding: CommercialUnderstanding;
}

export interface SupportItem {
  side: Side;
  /** DNA item key (provenance into Business DNA). */
  key: string;
  facet: DnaItem["facet"];
  value: string;
  state: Exclude<KnowledgeState, "unknown">;
  origin: DnaItem["origin"];
  sourceUrl: string | null;
}

export interface Contribution {
  side: Side;
  /** Traits that qualify this side for its role in the mechanism. */
  traits: Trait[];
  /** Evidence behind them, plus what the side offers. */
  support: SupportItem[];
}

export interface TimingEvidence {
  side: Side;
  signal: string;
  statement: string;
  key: string;
  sourceUrl: string | null;
}

export const CRITIC_CODES = ["already_does", "need_not_shown", "possible_competitor", "channel_conflict", "atypical_mechanism", "value_asymmetry", "regulatory", "procurement", "timing_unsupported", "execution_complexity", "substitute"] as const;
export type CriticCode = (typeof CRITIC_CODES)[number];

export interface CriticFinding {
  code: CriticCode;
  severity: "kill" | "major" | "minor";
  /** The side the finding is about, when it is about one. */
  side: Side | null;
  /** DNA item keys that triggered it; empty when the finding is an absence of evidence. */
  basis: string[];
}

export type Verdict = "credible" | "weak" | "rejected";
export type Level3 = "strong" | "moderate" | "limited";

export interface Dimensions {
  evidence: Level3;
  strategicFit: "complementary" | "overlapping";
  marketCompatibility: "typical_in_both" | "typical_in_one" | "atypical";
  timing: "evidenced" | "unknown";
  feasibility: "straightforward" | "moderate" | "demanding";
  risk: "low" | "material" | "high";
}

export interface RevenueHypothesis {
  payer: Payer;
  structure: RevenueStructure;
  /** What is paid for: the mechanism (rendered from labels). */
  mechanism: string;
  evidence: string[];
  unknowns: QuestionKey[];
  validation: QuestionKey[];
  /** Lifecycle: Hypothesis → Evidence → Unknowns → Validation → Experiment → Outcome. Phase 15 never records an outcome. */
  stage: "hypothesis";
  outcome: null;
}

export interface Scenario {
  key: string;
  mechanism: string;
  provider: Side;
  partner: Side;
  novelty: PairMechanism["novelty"];
  contributions: { provider: Contribution; partner: Contribution };
  /** What the two share that makes it relevant (customer types, industries, technologies, or a geographic complement). */
  shared: { audiences: string[]; industries: string[]; technologies: string[]; partnerRegions: string[] };
  /** inference = evidence-backed on both sides with a shown need; otherwise hypothesis. A new offering is always a hypothesis. */
  state: "inference" | "hypothesis";
  needShown: boolean;
  whyNow: TimingEvidence[];
  critic: CriticFinding[];
  verdict: Verdict;
  dimensions: Dimensions;
  questions: QuestionKey[];
  revenue: RevenueHypothesis;
  complexity: PairMechanism["complexity"];
}

export interface ScenarioResult {
  /** Credible first, then weak; never rejected ones. */
  scenarios: Scenario[];
  /** Rejected by the critic (with their findings), and pairs that only share a sector. */
  discarded: { mechanism: string; provider: Side | null; findings: CriticFinding[] }[];
}

// ---------------------------------------------------------------------------

const known = (u: CommercialUnderstanding) => u.dna.items.filter((i) => i.state === "fact" || i.state === "inference");
const traitsOf = (u: CommercialUnderstanding) => new Set<string>(u.dna.traits);

function itemsForTrait(u: CommercialUnderstanding, trait: string): DnaItem[] {
  const [kind, value] = trait.split(":");
  const k = known(u);
  if (kind === "has") return k.filter((i) => i.facet === ({ partners: "public_partners", integrations: "integrations", certifications: "certifications", case_studies: "case_studies" } as Record<string, string>)[value]);
  const facet = kind === "role" ? "value_chain_role" : kind;
  return k.filter((i) => i.facet === facet && i.value === value);
}

const toSupport = (side: Side, i: DnaItem): SupportItem => ({ side, key: i.key, facet: i.facet, value: i.value, state: i.state as SupportItem["state"], origin: i.origin, sourceUrl: i.evidence.find((e) => e.sourceUrl)?.sourceUrl ?? null });

function texts(u: CommercialUnderstanding, facets: string[]): string[] {
  return known(u)
    .filter((i) => facets.includes(i.facet))
    .map((i) => i.value);
}

const forms = (t: Set<string>) => new Set([...t].filter((x) => x.startsWith("offering_form:")));
const conceptSet = (u: CommercialUnderstanding, facets: string[], category: Parameters<typeof conceptsIn>[1]) => new Set(conceptsIn(texts(u, facets), category).filter((k) => !isGeneric(k)));
const inter = <T,>(a: Set<T>, b: Set<T>) => [...a].filter((x) => b.has(x));

function requirementsMet(reqs: readonly Requirement[], p: CommercialUnderstanding, q: CommercialUnderstanding): Scenario["shared"] | null {
  const pt = traitsOf(p);
  const qt = traitsOf(q);
  const audiences = inter(new Set([...pt].filter((t) => t.startsWith("customer_scope:"))), qt);
  const industries = inter(conceptSet(p, ["industries", "customers", "description", "offerings"], "industry"), conceptSet(q, ["industries", "customers", "description", "offerings"], "industry"));
  const technologies = inter(conceptSet(p, ["technologies", "offerings", "description"], "technology"), conceptSet(q, ["technologies", "offerings", "description"], "technology"));
  const pGeo = conceptSet(p, ["geographies"], "geography");
  const qGeo = conceptSet(q, ["geographies"], "geography");
  const partnerRegions = pGeo.size > 0 ? [...qGeo].filter((g) => !pGeo.has(g)) : [];
  for (const r of reqs) {
    if (r === "audience" && audiences.length + industries.length === 0) return null;
    if (r === "geo_complement" && partnerRegions.length === 0) return null;
    if (r === "public_audience" && !(["customer_scope:public_sector", "customer_scope:institutions"].some((t) => pt.has(t)) && ["customer_scope:public_sector", "customer_scope:institutions"].some((t) => qt.has(t)))) return null;
    if (r === "technology_overlap" && technologies.length === 0) return null;
    if (r === "complementary_forms") {
      const pf = forms(pt);
      const qf = forms(qt);
      if (![...pf].some((x) => !qf.has(x)) || ![...qf].some((x) => !pf.has(x))) return null;
    }
  }
  return { audiences, industries, technologies, partnerRegions };
}

function timingEvidence(m: PairMechanism, parties: Record<Side, Party>): TimingEvidence[] {
  const out: TimingEvidence[] = [];
  for (const side of ["target", "own"] as Side[]) {
    for (const i of known(parties[side].understanding).filter((x) => x.facet === "strategic_signals" && x.origin === "research")) {
      const signal = m.timing.find((s) => mentions(i.value, SIGNAL_TERMS[s] ?? []));
      if (signal) out.push({ side, signal, statement: i.value, key: i.key, sourceUrl: i.evidence.find((e) => e.sourceUrl)?.sourceUrl ?? null });
    }
  }
  return out.slice(0, 3);
}

function critique(m: PairMechanism, provider: Side, parties: Record<Side, Party>, shared: Scenario["shared"], whyNow: TimingEvidence[], needShown: boolean): CriticFinding[] {
  const partner = other(provider);
  const P = parties[provider].understanding;
  const Q = parties[partner].understanding;
  const pt = traitsOf(P);
  const qt = traitsOf(Q);
  const findings: CriticFinding[] = [];

  // The partner already has what the provider would bring.
  for (const t of m.alreadyDoes) {
    const items = itemsForTrait(Q, t);
    if (items.length === 0) continue;
    findings.push({ code: "already_does", severity: items.some((i) => i.state === "fact") ? "kill" : "major", side: partner, basis: items.map((i) => i.key) });
    break;
  }
  if (!needShown) findings.push({ code: "need_not_shown", severity: "major", side: partner, basis: [] });
  // The provider would bring its product to a partner that sells the same kind of thing, to the same customers, with the same technology: a rival, not a channel.
  const sameForms = inter(forms(pt), forms(qt));
  if (m.providerProduct && sameForms.length > 0 && shared.technologies.length > 0 && shared.industries.length + shared.audiences.length > 0) {
    findings.push({ code: "possible_competitor", severity: "major", side: partner, basis: sameForms.flatMap((t) => itemsForTrait(Q, t).map((i) => i.key)) });
  }
  if ((m.key === "resale_channel" || m.key === "regional_route") && pt.has("sales_motion:direct_sales")) findings.push({ code: "channel_conflict", severity: "major", side: provider, basis: itemsForTrait(P, "sales_motion:direct_sales").map((i) => i.key) });
  const typicalIn = (u: CommercialUnderstanding) => u.market.items.some((i) => m.marketEntries.includes(i.key));
  if (!typicalIn(P) && !typicalIn(Q)) findings.push({ code: "atypical_mechanism", severity: "major", side: null, basis: [] });
  if (m.weakSide) findings.push({ code: "value_asymmetry", severity: "minor", side: m.weakSide === "provider" ? provider : partner, basis: [] });
  const regulated = (["own", "target"] as Side[]).filter((s) => traitsOf(parties[s].understanding).has("regulation:regulated"));
  if (regulated.length > 0) findings.push({ code: "regulatory", severity: "minor", side: regulated.length === 1 ? regulated[0] : null, basis: regulated.flatMap((s) => itemsForTrait(parties[s].understanding, "regulation:regulated").map((i) => i.key)) });
  if (m.payer === "public_buyers") findings.push({ code: "procurement", severity: "minor", side: null, basis: [] });
  if (whyNow.length === 0) findings.push({ code: "timing_unsupported", severity: "minor", side: null, basis: [] });
  if (m.complexity === "high") findings.push({ code: "execution_complexity", severity: "minor", side: null, basis: [] });
  if (Q.market.items.some((i) => i.key === "in_house_alternative") && ["offering_form:service", "offering_form:software"].some((t) => pt.has(t)) && m.payer !== "shared_customers") {
    findings.push({ code: "substitute", severity: "minor", side: partner, basis: [] });
  }
  return findings;
}

function verdictOf(findings: CriticFinding[]): Verdict {
  if (findings.some((f) => f.severity === "kill")) return "rejected";
  return findings.filter((f) => f.severity === "major").length >= 2 ? "weak" : "credible";
}

function contribution(side: Side, u: CommercialUnderstanding, condition: PairMechanism["provider"]): Contribution {
  const t = traitsOf(u);
  const traits = [...(condition.any ?? []), ...(condition.all ?? [])].filter((x) => t.has(x));
  const traitItems = traits.flatMap((x) => itemsForTrait(u, x));
  const offers = known(u).filter((i) => i.facet === "offerings" || i.facet === "description").slice(0, 2);
  const support = [...new Map([...traitItems, ...offers].map((i) => [i.key, toSupport(side, i)])).values()];
  return { side, traits, support };
}

export function generateScenarios(own: Party, target: Party): ScenarioResult {
  const parties: Record<Side, Party> = { own, target };
  const ok = (["own", "target"] as Side[]).every((s) => parties[s].understanding.market.coverage !== "insufficient");
  if (!ok) return { scenarios: [], discarded: [] };

  const all: Scenario[] = [];
  const discarded: ScenarioResult["discarded"] = [];
  for (const m of PAIR_MECHANISMS) {
    const directions: Side[] = m.symmetric ? ["own"] : ["own", "target"];
    for (const provider of directions) {
      const partner = other(provider);
      const P = parties[provider].understanding;
      const Q = parties[partner].understanding;
      if (!holds(m.provider, traitsOf(P)) || !holds(m.partner, traitsOf(Q))) continue;
      const shared = requirementsMet(m.requires, P, Q);
      if (!shared) continue;
      const whyNow = timingEvidence(m, parties);
      const qt = traitsOf(Q);
      const needShown = m.needCues.some((c) => qt.has(c)) || whyNow.some((w) => w.side === partner);
      const critic = critique(m, provider, parties, shared, whyNow, needShown);
      const verdict = verdictOf(critic);
      if (verdict === "rejected") {
        discarded.push({ mechanism: m.key, provider, findings: critic.filter((f) => f.severity !== "minor") });
        continue;
      }
      const cp = contribution(provider, P, m.provider);
      const cq = contribution(partner, Q, m.partner);
      const supportAll = [...cp.support, ...cq.support];
      const facts = supportAll.filter((x) => x.state === "fact").length;
      const majors = critic.filter((f) => f.severity === "major").length;
      const typical = [P, Q].filter((u) => u.market.items.some((i) => m.marketEntries.includes(i.key))).length;
      const questions = [...m.questions];
      all.push({
        key: `${m.key}:${provider}`,
        mechanism: m.key,
        provider,
        partner,
        novelty: m.novelty,
        contributions: { provider: cp, partner: cq },
        shared,
        state: m.novelty === "new_offering" || !needShown ? "hypothesis" : "inference",
        needShown,
        whyNow,
        critic,
        verdict,
        dimensions: {
          evidence: facts >= 2 ? "strong" : supportAll.length >= 2 ? "moderate" : "limited",
          strategicFit: critic.some((f) => f.code === "already_does" || f.code === "possible_competitor") ? "overlapping" : "complementary",
          marketCompatibility: typical === 2 ? "typical_in_both" : typical === 1 ? "typical_in_one" : "atypical",
          timing: whyNow.length > 0 ? "evidenced" : "unknown",
          feasibility: m.complexity === "low" ? "straightforward" : m.complexity === "medium" ? "moderate" : "demanding",
          risk: majors === 0 ? "low" : majors === 1 ? "material" : "high",
        },
        questions,
        revenue: { payer: m.payer, structure: m.structure, mechanism: m.key, evidence: supportAll.map((x) => x.key), unknowns: questions, validation: questions.slice(0, 2), stage: "hypothesis", outcome: null },
        complexity: m.complexity,
      });
    }
  }

  // Sharing a sector or a customer type is context, not business: say so when it is all there is.
  if (all.length === 0 && discarded.length === 0) {
    const shared = requirementsMet(["audience"], own.understanding, target.understanding);
    if (shared) discarded.push({ mechanism: "similarity_only", provider: null, findings: [] });
  }

  const rank = (s: Scenario) => (s.verdict === "credible" ? 0 : 10) + (s.state === "inference" ? 0 : 3) + s.critic.filter((f) => f.severity === "major").length + (s.dimensions.marketCompatibility === "atypical" ? 2 : 0);
  return { scenarios: all.sort((a, b) => rank(a) - rank(b)), discarded };
}
