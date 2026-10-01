/**
 * Discovery Plan — deterministic translation of (workspace profile + user
 * objective) into what to look for, BEFORE anything is searched.
 *
 * The plan encodes reusable business mechanisms from the Phase 3 relevance
 * rules (who would do what for whom), never a named company or a category
 * overlap. A mechanism enters the plan only when the workspace's own profile
 * can support it; otherwise the plan says which profile field is missing.
 * No model is involved.
 */
import { concept, conceptLabel, conceptsIn, foldText, isGeneric } from "@/lib/intelligence/concepts";
import { BUILD_SERVICES, ownProfileGaps, PHYSICAL, SOFTWARE, type RuleCode, type ValidationKey } from "@/lib/intelligence/relevance";
import type { OwnCompanyContext, OwnProfileField, RelationshipType } from "@/lib/intelligence/types";
import { DISCOVERY_LIMITS, type Characteristic, type DiscoveryIntent, type EvidenceRequirement, type Exclusion } from "./types";

/** Concrete mechanisms Discover can search for. segment_customer (shared segment only) is context, never a discovery mechanism. */
export const DISCOVERY_MECHANISMS = ["build_for", "regional_deployment", "sought_capability", "channel", "combined_offer"] as const satisfies readonly RuleCode[];
export type DiscoveryMechanism = (typeof DISCOVERY_MECHANISMS)[number];

export interface DiscoveryObjective {
  intent: DiscoveryIntent;
  /** Optional free-text objective. Used only to extract business concepts and as search text — never as instructions. */
  text: string | null;
  geography: string | null;
  market: string | null;
}

export interface PlanFilter {
  /** Lexicon concept keys the filter maps to. */
  concepts: string[];
  /** Folded literal phrase when the filter maps to no known concept. */
  phrase: string | null;
  label: string;
}

export interface DiscoveryPlan {
  intent: DiscoveryIntent;
  mechanisms: DiscoveryMechanism[];
  relationships: RelationshipType[];
  characteristics: Characteristic[];
  /** Target-side concept keys (or "~phrase") that describe the companies to find. */
  concepts: string[];
  geography: PlanFilter | null;
  market: PlanFilter | null;
  /** Candidate-source queries (bounded). Built from concept labels, never from web content. */
  queries: string[];
  exclusions: Exclusion[];
  evidenceRequired: EvidenceRequirement[];
  /** Unknowns that decide whether a candidate is real, highest value first. */
  unknowns: ValidationKey[];
  /** Mechanisms the objective asked for but the own profile cannot support, with the field that would enable them. */
  unsupported: { mechanism: DiscoveryMechanism; field: OwnProfileField }[];
  gaps: OwnProfileField[];
}

const INTENT_MECHANISMS: Record<Exclude<DiscoveryIntent, "profile">, DiscoveryMechanism[]> = {
  customers: ["build_for", "regional_deployment"],
  suppliers: ["sought_capability"],
  technology_partners: ["combined_offer"],
  channels: ["channel"],
  market_entry: ["regional_deployment"],
};

/** Workspace partnership goals → mechanisms. strategic / co_development have no deterministic mechanism yet. */
const GOAL_MECHANISMS: Record<RelationshipType, DiscoveryMechanism[]> = {
  customer: ["build_for", "regional_deployment"],
  oem: ["build_for"],
  integration: ["build_for", "combined_offer"],
  market_entry: ["regional_deployment"],
  supplier: ["sought_capability"],
  channel: ["channel"],
  technology_partner: ["combined_offer"],
  strategic: [],
  co_development: [],
};

const EVIDENCE: Record<DiscoveryMechanism, EvidenceRequirement[]> = {
  build_for: ["physical_product"],
  regional_deployment: ["physical_product", "regional_presence"],
  sought_capability: ["sought_capability"],
  channel: ["distribution_activity", "shared_segment"],
  combined_offer: ["complementary_offer", "shared_segment"],
};

const UNKNOWNS: Record<DiscoveryMechanism, ValidationKey[]> = {
  build_for: ["production_model", "manufacturing_partners"],
  regional_deployment: ["deployment_geography", "regional_plans"],
  sought_capability: ["fit_requirements", "sells_to_peers"],
  channel: ["channel_coverage", "onboarding_terms"],
  combined_offer: ["combined_offer_demand", "technical_compatibility"],
};

const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];
const BUILD_CORE = ["manufacturing", "oem_odm", "assembly_integration", "testing_validation"];
const REGIONAL = ["deployment_services", "logistics_services", "distribution"];

/** The own profile read into concepts, exactly as the relevance rules read it. */
export function ownSide(own: OwnCompanyContext) {
  const offerText = own.offerings.length > 0 ? own.offerings : own.summary ? [own.summary] : [];
  const offer = new Set(conceptsIn(offerText));
  const types = [...offer].filter((k) => concept(k)?.category === "offering_type");
  const physical = PHYSICAL.filter((k) => types.includes(k));
  return {
    hasOffer: offerText.length > 0,
    buildCore: BUILD_CORE.filter((k) => offer.has(k)),
    buildServices: BUILD_SERVICES.filter((k) => offer.has(k)),
    regional: REGIONAL.filter((k) => offer.has(k)),
    geographies: conceptsIn([...own.geographies, ...own.markets], "geography"),
    segments: conceptsIn([...own.customerSegments, ...own.markets]).filter((k) => ["industry", "customer_type"].includes(concept(k)?.category ?? "") && !isGeneric(k)),
    technologies: [...offer].filter((k) => concept(k)?.category === "technology" && !isGeneric(k)),
    physical,
    softwareOnly: SOFTWARE.some((k) => types.includes(k)) && physical.length === 0,
  };
}

/** Whether the own profile can support a mechanism, else the field that would enable it. */
function feasibility(m: DiscoveryMechanism, own: OwnCompanyContext, s: ReturnType<typeof ownSide>): OwnProfileField | null {
  switch (m) {
    case "build_for":
      return s.buildCore.length > 0 ? null : "offerings";
    case "regional_deployment":
      return s.regional.length === 0 ? "offerings" : s.geographies.length === 0 ? "geographies" : null;
    case "sought_capability":
      return own.soughtCapabilities.length > 0 ? null : "soughtCapabilities";
    case "channel":
      return !s.hasOffer ? "offerings" : s.segments.length + s.geographies.length === 0 ? "customerSegments" : null;
    case "combined_offer":
      return s.physical.length === 0 && !s.softwareOnly ? "offerings" : s.segments.length + s.technologies.length === 0 ? "customerSegments" : null;
  }
}

function filterOf(raw: string | null, categories: string[]): PlanFilter | null {
  const label = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (label.length < 2) return null;
  const concepts = conceptsIn([label]).filter((k) => categories.includes(concept(k)?.category ?? ""));
  return { concepts, phrase: concepts.length > 0 ? null : foldText(label), label };
}

/** Search text is plain words: no operators, quotes or markup reach a provider. */
export function cleanQuery(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}&/.\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function mechanismQuery(m: DiscoveryMechanism, s: ReturnType<typeof ownSide>, own: OwnCompanyContext): string {
  const en = (k: string | undefined) => (k ? conceptLabel(k, "en") : "");
  const seg = en(s.segments[0]);
  const tech = en(s.technologies[0]);
  const geo = en(s.geographies[0]);
  switch (m) {
    case "build_for":
      return `${seg} ${tech} hardware vendor`;
    case "regional_deployment":
      return `${seg} hardware vendor ${geo} expansion`;
    case "sought_capability":
      return `${own.soughtCapabilities[0] ?? ""} provider`;
    case "channel":
      return `${seg || tech} distributor reseller ${geo}`;
    case "combined_offer":
      return `${tech} ${seg} ${s.physical.length > 0 ? "software platform" : "hardware"}`;
  }
}

export function buildDiscoveryPlan(own: OwnCompanyContext, objective: DiscoveryObjective): DiscoveryPlan {
  const s = ownSide(own);
  const requested: DiscoveryMechanism[] =
    objective.intent === "profile"
      ? own.partnershipGoals.length > 0
        ? uniq(own.partnershipGoals.flatMap((g) => GOAL_MECHANISMS[g]))
        : [...DISCOVERY_MECHANISMS]
      : INTENT_MECHANISMS[objective.intent];
  const unsupported: DiscoveryPlan["unsupported"] = [];
  const mechanisms: DiscoveryMechanism[] = [];
  for (const m of requested) {
    const missing = feasibility(m, own, s);
    if (missing) unsupported.push({ mechanism: m, field: missing });
    else mechanisms.push(m);
  }

  const geography = filterOf(objective.geography, ["geography"]);
  const market = filterOf(objective.market, ["industry", "customer_type"]);
  const objectiveConcepts = objective.text ? conceptsIn([objective.text]).filter((k) => !isGeneric(k) && concept(k)?.category !== "geography") : [];

  const characteristics: Characteristic[] = [];
  const concepts: string[] = [...objectiveConcepts, ...(market?.concepts ?? [])];
  for (const m of mechanisms) {
    if (m === "build_for") {
      characteristics.push("sells_physical_products");
      concepts.push(...s.segments, ...s.technologies, "hardware");
    } else if (m === "regional_deployment") {
      characteristics.push("physical_products_without_regional_presence");
      concepts.push(...s.segments, "hardware", ...s.geographies);
    } else if (m === "sought_capability") {
      characteristics.push("offers_sought_capability");
      concepts.push(
        ...conceptsIn(own.soughtCapabilities),
        ...own.soughtCapabilities
          .map(foldText)
          .filter((p) => p.length >= 5)
          .map((p) => `~${p}`),
      );
    } else if (m === "channel") {
      characteristics.push("distributes_in_your_segments");
      concepts.push("distribution", ...s.segments, ...s.geographies);
    } else {
      characteristics.push(s.physical.length > 0 ? "software_for_your_hardware" : "hardware_for_your_software");
      concepts.push(s.physical.length > 0 ? "software" : "hardware", ...s.segments, ...s.technologies);
    }
  }

  const suffix = [market?.label, geography?.label].filter(Boolean).join(" ");
  const candidatesQueries = [
    ...(objective.text ? [cleanQuery(`${objective.text} ${geography?.label ?? ""}`)] : []),
    ...mechanisms.map((m) => cleanQuery(`${mechanismQuery(m, s, own)} ${m === "regional_deployment" ? (market?.label ?? "") : suffix}`)),
  ].filter((q) => q.split(" ").length >= 2);

  return {
    intent: objective.intent,
    mechanisms,
    relationships: uniq(
      mechanisms.map((m): RelationshipType =>
        m === "build_for" ? (s.buildCore.some((k) => k === "manufacturing" || k === "oem_odm") ? "oem" : "integration") : m === "regional_deployment" ? "market_entry" : m === "sought_capability" ? "supplier" : m === "channel" ? "channel" : "integration",
      ),
    ),
    characteristics: uniq(characteristics),
    concepts: uniq(concepts).slice(0, 12),
    geography,
    market,
    queries: mechanisms.length > 0 ? uniq(candidatesQueries).slice(0, DISCOVERY_LIMITS.maxQueries) : [],
    exclusions: ["own_company", "directories_and_media", "category_overlap_only", "previously_rejected"],
    evidenceRequired: uniq(mechanisms.flatMap((m) => EVIDENCE[m])),
    unknowns: uniq(mechanisms.flatMap((m) => UNKNOWNS[m])).slice(0, 6),
    unsupported,
    gaps: ownProfileGaps(own),
  };
}
