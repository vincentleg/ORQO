/**
 * Pair mechanisms (Phase 15) — the reviewed catalog of legitimate ways two
 * companies can build, sell, deliver, license or develop something together.
 *
 * DATA, not logic, like the market ontology: each mechanism says which traits
 * the PROVIDER (the side bringing the core capability) and the PARTNER must
 * show, what must be shared between them, what would make the mechanism
 * pointless (the partner already does it), which questions decide it, how
 * money could flow (a structure, never an amount) and the cheapest test.
 * No industry selects a mechanism; traits do. Nothing at runtime can modify it.
 */
import type { Condition, Trait } from "./ontology";
import type { RelationshipRole } from "./relationship";

export const QUESTION_KEYS = [
  "production_model",
  "volumes_stage",
  "supplier_qualification",
  "channel_coverage",
  "onboarding_terms",
  "geography_presence",
  "api_access",
  "joint_customer_demand",
  "build_vs_buy",
  "technical_compatibility",
  "implementation_demand",
  "partner_program",
  "overlap_clients",
  "referral_terms",
  "licensing_appetite",
  "development_stage",
  "regulatory_path",
  "research_fit",
  "upcoming_tenders",
  "consortium_rules",
  "current_logistics",
  "volumes_geography",
  "channel_strategy",
  "data_needs",
  "who_sells",
  "roadmap_fit",
  "ip_ownership",
] as const;
export type QuestionKey = (typeof QUESTION_KEYS)[number];

/** How a question is resolved: asked to the other company, or researched in public sources. */
export const QUESTION_RESOLVE: Record<QuestionKey, "ask" | "research"> = {
  production_model: "ask",
  volumes_stage: "ask",
  supplier_qualification: "ask",
  channel_coverage: "research",
  onboarding_terms: "ask",
  geography_presence: "research",
  api_access: "research",
  joint_customer_demand: "ask",
  build_vs_buy: "ask",
  technical_compatibility: "ask",
  implementation_demand: "ask",
  partner_program: "research",
  overlap_clients: "ask",
  referral_terms: "ask",
  licensing_appetite: "ask",
  development_stage: "research",
  regulatory_path: "research",
  research_fit: "ask",
  upcoming_tenders: "research",
  consortium_rules: "research",
  current_logistics: "ask",
  volumes_geography: "ask",
  channel_strategy: "ask",
  data_needs: "ask",
  who_sells: "ask",
  roadmap_fit: "ask",
  ip_ownership: "ask",
};

export const REVENUE_STRUCTURES = ["per_unit_supply", "reseller_margin", "integration_adoption", "embedded_licence", "service_fees", "referral_fee", "licence_royalty", "research_funding", "consortium_contract", "usage_fees", "commission", "data_licence", "bundle_revenue_share", "joint_development"] as const;
export type RevenueStructure = (typeof REVENUE_STRUCTURES)[number];

/** Who would pay, relative to the scenario. */
export type Payer = "partner" | "partner_customers" | "provider_customers" | "shared_customers" | "public_buyers";

export type Requirement = "audience" | "geo_complement" | "public_audience" | "complementary_forms" | "technology_overlap";

/** Market-signal types and the vocabulary that shows them in a dated statement (timing evidence only). */
export const SIGNAL_TERMS: Record<string, readonly string[]> = {
  new_region: ["expansion", "expands", "expanding", "new office", "opens", "opened", "entering", "enters", "nouvelle implantation", "s'implante", "ouvre", "ouverture"],
  capacity_expansion: ["new production line", "production line", "new factory", "new plant", "new warehouse", "capacity", "nouvelle usine", "nouvelle ligne", "capacite"],
  product_launch: ["launch", "launches", "launched", "introduces", "unveils", "lance", "lancement", "nouveau produit"],
  partnership_announcement: ["partners with", "partnership", "partnered", "en partenariat", "partenariat"],
  funding_round: ["raises", "raised", "funding", "series a", "series b", "levee de fonds", "leve"],
  hiring_expansion: ["hiring", "recruiting", "recrute", "recrutement"],
  research_results: ["clinical trial", "phase 1", "phase 2", "phase 3", "results", "data readout", "resultats"],
  regulatory_milestone: ["approval", "approved", "clearance", "ce marking", "fda", "autorisation", "homologation"],
  contract_award: ["awarded", "wins", "won a contract", "selected by", "remporte", "attribue"],
  integration_launch: ["integration", "connector", "api", "connecteur"],
};

export interface PairMechanism {
  key: string;
  provider: Condition;
  partner: Condition;
  requires: readonly Requirement[];
  /** New offering that does not exist yet: always an ORQO-generated hypothesis. */
  novelty: "existing_mechanism" | "new_offering";
  /** Partner traits that mean it already does what the provider would bring (critic: "already does it"). */
  alreadyDoes: readonly Trait[];
  /** Partner traits that evidence a need for the mechanism. */
  needCues: readonly Trait[];
  /** Market-model entries (either section) under which this mechanism is typical. */
  marketEntries: readonly string[];
  /** Signal types that would make it timely. */
  timing: readonly string[];
  /** Ordered: the first one decides the scenario soonest. */
  questions: readonly QuestionKey[];
  structure: RevenueStructure;
  payer: Payer;
  complexity: "low" | "medium" | "high";
  /** The side whose benefit is uncertain by construction (critic: value asymmetry). */
  weakSide?: "provider" | "partner";
  /** Symmetric mechanisms are evaluated once per pair. */
  symmetric?: boolean;
  /** The provider brings its own product (not a service for the partner): a partner selling the same thing may be a rival. */
  providerProduct?: boolean;
  /**
   * Phase 16: what the TARGET would become to the user's company under this mechanism.
   * - ownProvides: the role when the user's company is the provider;
   * - targetProvides: the role when the target is the provider.
   * Used to tell an incremental opportunity from the relationship that already exists.
   */
  creates: { ownProvides: RelationshipRole; targetProvides: RelationshipRole };
  /** Phase 16: wording in the partner's own evidence that states the need (EN + FR). Evidence of need, like needCues. */
  needTerms?: readonly string[];
}

const f = (v: string): Trait => `offering_form:${v}` as Trait;
const PRODUCT_FORMS = [f("physical_product"), f("software"), f("data_content"), f("capacity_infrastructure"), f("platform_marketplace")];

export const PAIR_MECHANISMS: readonly PairMechanism[] = [
  {
    key: "contract_production",
    needTerms: ["outsource", "outsources", "outsourced", "outsourcing", "contract manufacturer", "contract manufacturing partner", "manufacturing partner", "production partner", "sous-traitance", "sous-traitant", "externalise"],
    creates: { ownProvides: "customer", targetProvides: "supplier" },
    provider: { any: ["role:manufacturer"] },
    // A partner that is itself a manufacturer is not excluded here: the Deal Critic says why it may not need this.
    partner: { all: [f("physical_product")] },
    requires: [],
    novelty: "existing_mechanism",
    alreadyDoes: ["role:manufacturer"],
    // Phase 16: selling through channel partners says nothing about how a company produces, so it is not a need cue.
    // A distributor (which sells products it does not make) is one; so is the company's own wording (needTerms).
    needCues: ["role:distributor"],
    marketEntries: ["white_label_supply", "supply_agreement", "input_suppliers"],
    timing: ["capacity_expansion", "product_launch", "new_region"],
    questions: ["production_model", "volumes_stage", "supplier_qualification"],
    structure: "per_unit_supply",
    payer: "partner",
    complexity: "medium",
  },
  {
    key: "resale_channel",
    needTerms: ["looking for products", "expand our portfolio", "new brands", "elargir notre catalogue"],
    creates: { ownProvides: "channel", targetProvides: "supplier" },
    provider: { any: [f("physical_product"), f("software")] },
    partner: { any: ["role:distributor", "sales_motion:channel_partners"] },
    requires: ["audience"],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: ["has:partners"],
    marketEntries: ["resale_agreement", "resellers", "channel"],
    timing: ["new_region", "hiring_expansion", "partnership_announcement"],
    questions: ["channel_coverage", "onboarding_terms"],
    structure: "reseller_margin",
    payer: "partner_customers",
    complexity: "low",
    providerProduct: true,
  },
  {
    key: "regional_route",
    creates: { ownProvides: "channel", targetProvides: "supplier" },
    provider: { any: [f("physical_product"), f("software")] },
    partner: { any: [f("service"), "role:integrator", "role:distributor"] },
    requires: ["geo_complement"],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: [],
    marketEntries: ["channel", "resale_agreement", "implementation_partners", "installation_logistics"],
    timing: ["new_region"],
    questions: ["geography_presence", "channel_coverage", "onboarding_terms"],
    structure: "reseller_margin",
    payer: "partner_customers",
    complexity: "medium",
    providerProduct: true,
  },
  {
    key: "technical_integration",
    creates: { ownProvides: "partner", targetProvides: "partner" },
    provider: { any: [f("software"), f("data_content"), f("platform_marketplace")] },
    partner: { any: [f("software"), f("data_content"), f("platform_marketplace")] },
    requires: ["audience"],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: ["has:integrations"],
    marketEntries: ["technical_integration", "integration_ecosystem"],
    timing: ["integration_launch", "product_launch", "partnership_announcement"],
    questions: ["joint_customer_demand", "api_access", "technical_compatibility"],
    structure: "integration_adoption",
    payer: "shared_customers",
    complexity: "medium",
    symmetric: true,
  },
  {
    key: "embedding",
    creates: { ownProvides: "customer", targetProvides: "supplier" },
    provider: { any: [f("software"), f("data_content")] },
    partner: { any: [f("physical_product")] },
    requires: ["audience"],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: [],
    marketEntries: ["embedding", "white_label_supply"],
    timing: ["product_launch"],
    questions: ["build_vs_buy", "technical_compatibility"],
    structure: "embedded_licence",
    payer: "partner",
    complexity: "high",
    providerProduct: true,
  },
  {
    key: "implementation_partnership",
    needTerms: ["implementation partners", "implementation partner", "certified partners", "partner program", "integration partners", "partenaires integrateurs", "programme partenaires"],
    creates: { ownProvides: "supplier", targetProvides: "channel" },
    provider: { any: [f("service"), "role:integrator"] },
    partner: { any: [f("software"), f("physical_product"), f("platform_marketplace"), f("data_content")], none: [f("service")] },
    requires: ["audience"],
    novelty: "existing_mechanism",
    alreadyDoes: ["role:integrator"],
    needCues: ["has:partners"],
    marketEntries: ["implementation_partners", "service_alliance", "referral_agreement"],
    timing: ["product_launch", "new_region", "reference_customer"],
    questions: ["implementation_demand", "partner_program"],
    structure: "service_fees",
    payer: "partner_customers",
    complexity: "low",
  },
  {
    key: "referral",
    needTerms: ["referral partners", "referral program", "partner referrals", "programme de parrainage"],
    creates: { ownProvides: "channel", targetProvides: "partner" },
    provider: { any: [f("service")] },
    partner: { any: [f("service"), f("software")] },
    requires: ["audience"],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: ["sales_motion:referral"],
    marketEntries: ["referral_agreement", "referral_partners", "referrals_reputation"],
    timing: ["reference_customer", "hiring_expansion"],
    questions: ["overlap_clients", "referral_terms"],
    structure: "referral_fee",
    payer: "provider_customers",
    complexity: "low",
    weakSide: "partner",
  },
  {
    key: "licensing",
    needTerms: ["in-license", "in-licenses", "in-licensing", "in-licence", "in-licences", "licenses in", "acquires rights", "licence entrante"],
    creates: { ownProvides: "customer", targetProvides: "supplier" },
    provider: { any: [f("ip_licensing"), f("research")] },
    partner: { any: [f("physical_product"), f("software"), "role:manufacturer", "role:distributor"], none: [f("research")] },
    requires: [],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: [],
    marketEntries: ["licensing", "milestone_partnering", "development_partners", "partnering_deals"],
    timing: ["research_results", "regulatory_milestone", "funding_round"],
    questions: ["licensing_appetite", "development_stage", "regulatory_path"],
    structure: "licence_royalty",
    payer: "partner",
    complexity: "high",
  },
  {
    key: "research_collaboration",
    needTerms: ["research partners", "academic partners", "research collaborations", "collaborate with universities", "partenariats de recherche"],
    creates: { ownProvides: "partner", targetProvides: "partner" },
    provider: { any: [f("research")] },
    partner: { any: [f("research"), "customer_scope:institutions", f("ip_licensing")] },
    requires: [],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: [],
    marketEntries: ["research_collaboration", "funding_bodies"],
    timing: ["research_results", "funding_round"],
    questions: ["research_fit", "ip_ownership"],
    structure: "research_funding",
    payer: "partner",
    complexity: "high",
    symmetric: true,
  },
  {
    key: "joint_bid",
    creates: { ownProvides: "partner", targetProvides: "partner" },
    provider: { any: [f("service"), f("capacity_infrastructure"), f("physical_product"), f("software")] },
    partner: { any: [f("service"), f("capacity_infrastructure"), f("physical_product"), f("software")] },
    requires: ["public_audience", "complementary_forms"],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: ["sales_motion:tender_procurement"],
    marketEntries: ["joint_bid", "public_tenders"],
    timing: ["contract_award"],
    questions: ["upcoming_tenders", "consortium_rules"],
    structure: "consortium_contract",
    payer: "public_buyers",
    complexity: "medium",
    symmetric: true,
  },
  {
    key: "fulfilment_partnership",
    needTerms: ["3pl", "fulfilment partner", "fulfillment partner", "logistics partner", "partenaire logistique"],
    creates: { ownProvides: "customer", targetProvides: "supplier" },
    provider: { any: [f("capacity_infrastructure")] },
    partner: { any: [f("physical_product"), f("platform_marketplace")] },
    requires: [],
    novelty: "existing_mechanism",
    alreadyDoes: [f("capacity_infrastructure")],
    needCues: ["customer_scope:consumer", "sales_motion:self_serve"],
    marketEntries: ["subcontracting", "installation_logistics", "supply_agreement"],
    timing: ["capacity_expansion", "new_region", "product_launch"],
    questions: ["current_logistics", "volumes_geography"],
    structure: "usage_fees",
    payer: "partner",
    complexity: "low",
  },
  {
    key: "marketplace_onboarding",
    creates: { ownProvides: "customer", targetProvides: "channel" },
    provider: { any: [f("platform_marketplace")] },
    partner: { any: [f("physical_product"), f("software"), f("service")], none: [f("platform_marketplace")] },
    requires: ["audience"],
    novelty: "existing_mechanism",
    alreadyDoes: [],
    needCues: ["sales_motion:marketplace_listing"],
    marketEntries: ["platform_onboarding", "marketplace_listing", "marketplaces"],
    timing: ["new_region", "product_launch"],
    questions: ["channel_strategy"],
    structure: "commission",
    payer: "partner",
    complexity: "low",
  },
  {
    key: "data_partnership",
    creates: { ownProvides: "customer", targetProvides: "supplier" },
    provider: { any: [f("data_content")] },
    partner: { any: [f("software"), f("platform_marketplace"), f("financial_product")] },
    requires: ["audience"],
    novelty: "existing_mechanism",
    alreadyDoes: [f("data_content")],
    needCues: ["has:integrations"],
    marketEntries: ["embedding", "technical_integration"],
    timing: ["product_launch", "integration_launch"],
    questions: ["data_needs", "technical_compatibility"],
    structure: "data_licence",
    payer: "partner",
    complexity: "medium",
    providerProduct: true,
  },
  {
    key: "joint_offer",
    creates: { ownProvides: "partner", targetProvides: "partner" },
    provider: { any: PRODUCT_FORMS },
    partner: { any: [f("software"), f("service"), f("physical_product"), f("data_content")] },
    requires: ["audience", "complementary_forms"],
    novelty: "new_offering",
    alreadyDoes: [],
    needCues: [],
    marketEntries: ["co_marketing", "co_development", "embedding", "technical_integration"],
    timing: ["product_launch", "partnership_announcement", "new_region"],
    questions: ["joint_customer_demand", "technical_compatibility", "who_sells"],
    structure: "bundle_revenue_share",
    payer: "shared_customers",
    complexity: "high",
    symmetric: true,
  },
  {
    key: "co_development",
    creates: { ownProvides: "partner", targetProvides: "partner" },
    provider: { any: [f("research"), f("physical_product"), f("software")] },
    partner: { any: [f("research"), f("physical_product"), f("software")] },
    requires: ["technology_overlap", "complementary_forms"],
    novelty: "new_offering",
    alreadyDoes: [],
    needCues: [],
    marketEntries: ["co_development", "research_collaboration"],
    timing: ["funding_round", "product_launch", "research_results"],
    questions: ["roadmap_fit", "ip_ownership"],
    structure: "joint_development",
    payer: "shared_customers",
    complexity: "high",
    symmetric: true,
  },
];
