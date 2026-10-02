/**
 * ORQO market ontology (Phase 14) — the smallest domain-neutral vocabulary
 * ORQO uses to describe how the commercial world around a company works.
 *
 * DATA, not logic: every market entry declares the business traits under which
 * it applies (offering form, customer scope, revenue model, sales motion,
 * regulation, value-chain role). No industry selects anything: an industry is
 * a label on the company, never a template. Adding knowledge means adding an
 * entry with its conditions; the builders never change.
 *
 * The ontology is version-controlled and reviewed. Nothing at runtime — a
 * user, a model, an agent or retrieved content — can modify it.
 */

export const ONTOLOGY_VERSION = "14.1";

/** Business archetype dimensions. A company may have several values per dimension. */
export const DIMENSIONS = {
  offering_form: ["physical_product", "software", "service", "data_content", "ip_licensing", "capacity_infrastructure", "platform_marketplace", "financial_product", "research"],
  customer_scope: ["business", "consumer", "public_sector", "institutions"],
  revenue_model: ["one_time_sale", "subscription", "usage_based", "project_fee", "licensing_royalty", "commission", "retainer", "milestone_funding"],
  sales_motion: ["self_serve", "direct_sales", "channel_partners", "tender_procurement", "marketplace_listing", "referral"],
  regulation: ["regulated", "not_regulated"],
} as const;

export type Dimension = keyof typeof DIMENSIONS;
export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as Dimension[];
export type DimensionValue<D extends Dimension = Dimension> = (typeof DIMENSIONS)[D][number];

/**
 * Value-chain roles. "cue" roles are detected from the company's own wording;
 * "derived" roles follow from an offering form.
 */
export const VALUE_CHAIN_ROLES = [
  "manufacturer",
  "distributor",
  "integrator",
  "product_company",
  "software_vendor",
  "service_provider",
  "data_provider",
  "licensor",
  "infrastructure_operator",
  "platform_operator",
  "financial_provider",
  "research_developer",
] as const;
export type ValueChainRole = (typeof VALUE_CHAIN_ROLES)[number];

export const DERIVED_ROLES: Record<DimensionValue<"offering_form">, ValueChainRole> = {
  physical_product: "product_company",
  software: "software_vendor",
  service: "service_provider",
  data_content: "data_provider",
  ip_licensing: "licensor",
  capacity_infrastructure: "infrastructure_operator",
  platform_marketplace: "platform_operator",
  financial_product: "financial_provider",
  research: "research_developer",
};

/** Observable evidence cues (the company publicly shows partners, integrations, certifications, case studies). */
export const EVIDENCE_CUES = ["partners", "integrations", "certifications", "case_studies"] as const;
export type EvidenceCue = (typeof EVIDENCE_CUES)[number];

/**
 * A trait is one known fact or inference about the company, as a string:
 *   "offering_form:software", "customer_scope:business", "regulation:regulated",
 *   "role:manufacturer", "has:integrations".
 */
export type Trait = `${Dimension}:${string}` | `role:${ValueChainRole}` | `has:${EvidenceCue}`;

export interface Condition {
  /** At least one of these traits. */
  any?: readonly Trait[];
  /** Every one of these traits. */
  all?: readonly Trait[];
  /** None of these traits. */
  none?: readonly Trait[];
}

/** How a market participant relates to the company. */
export const RELATIONS = ["customer", "buyer", "supplier", "channel", "complement", "competitor", "substitute", "regulator", "technology_partner", "strategic_partner"] as const;
export type Relation = (typeof RELATIONS)[number];

export const MARKET_SECTIONS = ["role", "route", "buying", "mechanism", "signal", "event", "risk"] as const;
export type MarketSection = (typeof MARKET_SECTIONS)[number];

export interface MarketEntry {
  key: string;
  section: MarketSection;
  /** Only for section "role". */
  relation?: Relation;
  /** When the entry applies (typical for this kind of business). */
  when: Condition;
  /**
   * Traits that show the entry is not just typical but evidenced for THIS company.
   * Present → evidence-backed inference; absent → hypothesis.
   */
  cues?: readonly Trait[];
}

const f = (v: DimensionValue<"offering_form">): Trait => `offering_form:${v}`;
const s = (v: DimensionValue<"customer_scope">): Trait => `customer_scope:${v}`;
const r = (v: DimensionValue<"revenue_model">): Trait => `revenue_model:${v}`;
const m = (v: DimensionValue<"sales_motion">): Trait => `sales_motion:${v}`;
const REG: Trait = "regulation:regulated";
const ANY_FORM = DIMENSIONS.offering_form.map(f);

const role = (key: string, relation: Relation, when: Condition, cues?: Trait[]): MarketEntry => ({ key, section: "role", relation, when, cues });
const entry = (section: MarketSection) => (key: string, when: Condition, cues?: Trait[]): MarketEntry => ({ key, section, when, cues });
const route = entry("route");
const buying = entry("buying");
const mech = entry("mechanism");
const signal = entry("signal");
const event = entry("event");
const risk = entry("risk");

export const MARKET_CATALOG: readonly MarketEntry[] = [
  // Who buys.
  role("business_customers", "customer", { any: [s("business")] }),
  role("consumers", "customer", { any: [s("consumer")] }),
  role("public_buyers", "customer", { any: [s("public_sector")] }),
  role("institutional_buyers", "customer", { any: [s("institutions")] }),
  role("technical_buyers", "buyer", { all: [s("business")], any: [f("software"), f("data_content"), f("capacity_infrastructure")] }),
  role("operations_buyers", "buyer", { any: [s("business"), s("public_sector")], all: [f("physical_product")] }),
  role("executive_sponsors", "buyer", { any: [f("service")] }),
  role("scientific_leaders", "buyer", { any: [f("research"), f("ip_licensing")] }),
  role("platform_supply_side", "customer", { any: [f("platform_marketplace")] }),
  // What the company depends on.
  role("input_suppliers", "supplier", { any: [f("physical_product"), "role:manufacturer"] }),
  role("cloud_providers", "supplier", { any: [f("software"), f("data_content")] }),
  role("specialist_subcontractors", "supplier", { any: [f("service")] }),
  role("research_service_providers", "supplier", { any: [f("research")] }),
  role("asset_suppliers", "supplier", { any: [f("capacity_infrastructure")] }),
  // Who sells or connects.
  role("resellers", "channel", { any: [f("physical_product"), f("software")] }, [m("channel_partners"), "role:distributor"]),
  role("marketplaces", "channel", { any: [f("software")] }, [m("marketplace_listing")]),
  role("retailers", "channel", { all: [s("consumer")], any: [f("physical_product")] }),
  role("referral_partners", "channel", { any: [f("service")] }, [m("referral")]),
  // Who completes the offer.
  role("implementation_partners", "complement", { any: [f("software"), "role:integrator"], none: [f("service")] }),
  role("integration_ecosystem", "technology_partner", { any: [f("software"), f("data_content"), f("platform_marketplace")] }, ["has:integrations"]),
  role("complementary_specialists", "complement", { any: [f("service")] }),
  role("installation_logistics", "complement", { any: [f("physical_product")] }),
  role("development_partners", "strategic_partner", { any: [f("research"), f("ip_licensing")] }, [r("licensing_royalty"), r("milestone_funding")]),
  role("funding_bodies", "strategic_partner", { any: [f("research")] }),
  // Who competes.
  role("direct_competitors", "competitor", { any: ANY_FORM }),
  role("in_house_alternative", "substitute", { all: [s("business")], any: [f("service"), f("software"), f("capacity_infrastructure")] }),
  role("alternative_approaches", "substitute", { any: [f("physical_product"), f("research"), f("ip_licensing")] }),
  role("regulators", "regulator", { any: [REG] }, [REG]),

  // How it reaches the market.
  route("direct_sales", { any: [s("business"), s("public_sector"), s("institutions")] }, [m("direct_sales")]),
  route("self_serve", { any: [f("software"), f("data_content")] }, [m("self_serve")]),
  route("channel", { any: [f("physical_product"), f("software")] }, [m("channel_partners"), "role:distributor"]),
  route("marketplaces", { any: [f("software"), f("platform_marketplace")] }, [m("marketplace_listing")]),
  route("public_tenders", { any: [s("public_sector"), s("institutions")] }, [m("tender_procurement")]),
  route("referrals_reputation", { any: [f("service")] }, [m("referral"), "has:case_studies"]),
  route("partnering_deals", { any: [f("ip_licensing"), f("research")] }, [r("licensing_royalty"), r("milestone_funding")]),
  route("retail", { all: [s("consumer")], any: [f("physical_product")] }),

  // How buyers decide.
  buying("buying_committee", { all: [s("business")], any: [f("software"), f("physical_product"), f("capacity_infrastructure"), f("service")] }),
  buying("formal_procurement", { any: [s("public_sector"), s("institutions"), REG] }, [m("tender_procurement")]),
  buying("long_cycle", { any: [s("public_sector"), f("research"), f("ip_licensing"), f("capacity_infrastructure"), REG] }),
  buying("trial_first", { any: [f("software"), f("data_content")] }, [m("self_serve")]),
  buying("renewal_driven", { any: [r("subscription"), r("usage_based"), r("retainer")] }, [r("subscription"), r("usage_based"), r("retainer")]),
  buying("supplier_qualification", { any: [REG, f("physical_product")], none: [s("consumer")] }, ["has:certifications"]),
  buying("trust_and_references", { any: [f("service")] }, ["has:case_studies"]),
  buying("individual_purchase", { any: [s("consumer")] }),

  // Typical commercial relationships.
  mech("resale_agreement", { any: [f("physical_product"), f("software")] }, [m("channel_partners"), "role:distributor"]),
  mech("technical_integration", { any: [f("software"), f("data_content"), f("platform_marketplace")] }, ["has:integrations"]),
  mech("white_label_supply", { any: [f("physical_product"), "role:manufacturer"] }),
  mech("embedding", { any: [f("software"), f("data_content")] }),
  mech("licensing", { any: [f("ip_licensing"), f("research")] }, [r("licensing_royalty")]),
  mech("co_development", { any: [f("research"), f("physical_product"), f("software")] }),
  mech("research_collaboration", { any: [f("research"), s("institutions")] }),
  mech("subcontracting", { any: [f("service"), f("capacity_infrastructure")] }),
  mech("referral_agreement", { any: [f("service"), f("software")] }, [m("referral")]),
  mech("joint_bid", { any: [s("public_sector"), s("institutions")] }, [m("tender_procurement")]),
  mech("co_marketing", { any: [s("consumer"), f("software"), f("service")] }),
  mech("supply_agreement", { any: [f("physical_product"), "role:manufacturer", f("capacity_infrastructure")] }),
  mech("marketplace_listing", { any: [f("software")] }, [m("marketplace_listing")]),
  mech("platform_onboarding", { any: [f("platform_marketplace")] }),
  mech("milestone_partnering", { any: [f("research"), f("ip_licensing")] }, [r("milestone_funding")]),
  mech("service_alliance", { any: [f("service")] }, ["has:partners"]),

  // Signals that matter in this kind of market.
  signal("product_launch", { any: [f("physical_product"), f("software"), f("data_content")] }),
  signal("integration_launch", { any: [f("software"), f("data_content"), f("platform_marketplace")] }, ["has:integrations"]),
  signal("capacity_expansion", { any: [f("physical_product"), f("capacity_infrastructure"), "role:manufacturer"] }),
  signal("supply_change", { any: [f("physical_product"), "role:manufacturer"] }),
  signal("funding_round", { any: [f("software"), f("research"), f("platform_marketplace")] }),
  signal("hiring_expansion", { any: ANY_FORM }),
  signal("new_region", { any: ANY_FORM }),
  signal("contract_award", { any: [s("public_sector"), s("institutions"), f("service"), f("capacity_infrastructure")] }),
  signal("regulatory_milestone", { any: [REG] }, [REG]),
  signal("research_results", { any: [f("research")] }),
  signal("pricing_change", { any: [r("subscription"), r("usage_based"), s("consumer")] }),
  signal("partnership_announcement", { any: ANY_FORM }, ["has:partners"]),
  signal("reference_customer", { any: [f("service"), f("software")] }, ["has:case_studies"]),
  signal("leadership_change", { any: ANY_FORM }),

  // Events where this market meets.
  event("trade_shows", { any: [f("physical_product"), f("capacity_infrastructure")] }),
  event("technology_conferences", { any: [f("software"), f("data_content")] }),
  event("ecosystem_summits", { any: [f("software"), f("platform_marketplace")] }, ["has:integrations", m("marketplace_listing")]),
  event("scientific_congresses", { any: [f("research"), f("ip_licensing")] }),
  event("industry_forums", { any: [f("service"), s("business")] }),
  event("public_sector_events", { any: [s("public_sector")] }, [m("tender_procurement")]),
  event("consumer_fairs", { any: [s("consumer")] }),

  // Commercial risks typical of this market.
  risk("customer_concentration", { all: [s("business")], any: [f("service"), f("physical_product"), f("capacity_infrastructure")] }),
  risk("input_availability", { any: [f("physical_product"), "role:manufacturer"] }),
  risk("ecosystem_dependency", { any: [f("software"), f("data_content")] }, ["has:integrations", m("marketplace_listing")]),
  risk("regulatory", { any: [REG] }, [REG]),
  risk("long_cycles", { any: [s("public_sector"), f("research"), f("ip_licensing")] }),
  risk("price_pressure", { any: [f("physical_product"), f("capacity_infrastructure")] }),
  risk("churn", { any: [r("subscription"), r("usage_based"), r("retainer")] }),
  risk("key_people", { any: [f("service")] }),
  risk("technical_failure", { any: [f("research")] }),
  risk("channel_conflict", { any: [m("channel_partners"), "role:distributor"] }),
  risk("liquidity", { any: [f("platform_marketplace")] }),
];

/**
 * Next-question options: a value is offered only when it is plausible for what
 * is already known (a SaaS company is not offered "milestone funding").
 * Absent: always offered.
 */
export const OPTION_WHEN: Partial<Record<`${Dimension}:${string}`, Condition>> = {
  "revenue_model:subscription": { any: [f("software"), f("data_content"), f("service"), s("consumer"), f("capacity_infrastructure")] },
  "revenue_model:usage_based": { any: [f("software"), f("data_content"), f("capacity_infrastructure"), f("financial_product")] },
  "revenue_model:one_time_sale": { any: [f("physical_product"), f("software"), s("consumer")] },
  "revenue_model:project_fee": { any: [f("service"), f("research"), f("physical_product")] },
  "revenue_model:licensing_royalty": { any: [f("ip_licensing"), f("research"), f("software"), f("data_content")] },
  "revenue_model:commission": { any: [f("platform_marketplace"), f("financial_product"), f("service")] },
  "revenue_model:retainer": { any: [f("service")] },
  "revenue_model:milestone_funding": { any: [f("research"), f("ip_licensing")] },
  "sales_motion:self_serve": { any: [f("software"), f("data_content"), s("consumer"), f("platform_marketplace")] },
  "sales_motion:channel_partners": { any: [f("physical_product"), f("software"), f("financial_product")] },
  "sales_motion:tender_procurement": { any: [s("public_sector"), s("institutions"), f("service"), f("capacity_infrastructure"), f("physical_product")] },
  "sales_motion:marketplace_listing": { any: [f("software"), s("consumer"), f("data_content")] },
  "sales_motion:referral": { any: [f("service"), f("software"), f("financial_product")] },
};

/** Whether a condition holds for a set of known traits. An empty condition never holds. */
export function holds(c: Condition, traits: ReadonlySet<string>): boolean {
  if (!c.any?.length && !c.all?.length) return false;
  if (c.any?.length && !c.any.some((t) => traits.has(t))) return false;
  if (c.all?.length && !c.all.every((t) => traits.has(t))) return false;
  if (c.none?.some((t) => traits.has(t))) return false;
  return true;
}

/** The dimensions a condition mentions. */
export function dimensionsOf(c: Condition): Dimension[] {
  const out = new Set<Dimension>();
  for (const t of [...(c.any ?? []), ...(c.all ?? []), ...(c.none ?? [])]) {
    const d = t.split(":")[0];
    if ((DIMENSION_KEYS as string[]).includes(d)) out.add(d as Dimension);
  }
  return [...out];
}
