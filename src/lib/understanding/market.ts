/**
 * Domain & Market Model builder (Phase 14): how does the commercial world
 * around this company work?
 *
 * Pure and deterministic. One-way contract: it reads ONLY the Business DNA's
 * fact/inference traits (never its hypotheses) and never writes back into the
 * DNA. It owns no facts: every entry is either
 * - an EVIDENCE-BACKED INFERENCE: applicable to this kind of business AND
 *   evidenced by a cue in this company's own DNA, or
 * - a HYPOTHESIS: typical for this kind of business, not evidenced yet.
 * With no known offering form the coverage is "insufficient" and no typical
 * structure is proposed at all: UNKNOWN rather than invented mechanics.
 */
import { DIMENSION_KEYS, holds, MARKET_CATALOG, ONTOLOGY_VERSION, VALUE_CHAIN_ROLES, type Dimension, type Trait, type ValueChainRole } from "./ontology";
import type { ArchetypeDimension, BusinessDna, MarketCoverage, MarketItem, MarketModel } from "./types";

export function buildMarketModel(dna: BusinessDna): MarketModel {
  const traits = new Set<string>(dna.traits);
  const known = dna.items.filter((i) => i.state === "fact" || i.state === "inference");
  const basisOf = (trait: string): string[] => {
    const [kind, value] = trait.split(":");
    if (kind === "has") return known.filter((i) => i.facet === ({ partners: "public_partners", integrations: "integrations", certifications: "certifications", case_studies: "case_studies" } as const)[value as "partners"]).map((i) => i.key);
    const facet = kind === "role" ? "value_chain_role" : kind;
    return known.filter((i) => i.facet === facet && i.value === value).map((i) => i.key);
  };

  const archetype = Object.fromEntries(
    DIMENSION_KEYS.map((d): [Dimension, ArchetypeDimension] => {
      const its = known.filter((i) => i.facet === d);
      const state = its.length === 0 ? "unknown" : its.every((i) => i.state === "fact") ? "fact" : "inference";
      return [d, { values: its.map((i) => i.value), state, basis: its.map((i) => i.key) }];
    }),
  ) as Record<Dimension, ArchetypeDimension>;

  const roles = known
    .filter((i) => i.facet === "value_chain_role" && (VALUE_CHAIN_ROLES as readonly string[]).includes(i.value))
    .map((i) => ({ value: i.value as ValueChainRole, state: i.state as "fact" | "inference", basis: [i.key] }));

  const formKnown = archetype.offering_form.state !== "unknown";
  const audienceKnown = archetype.customer_scope.state !== "unknown" || known.some((i) => i.facet === "customers" || i.facet === "industries");
  const coverage: MarketCoverage = !formKnown ? "insufficient" : !audienceKnown || archetype.sales_motion.state === "unknown" || archetype.revenue_model.state === "unknown" ? "partial" : "sufficient";

  const items: MarketItem[] = [];
  if (formKnown) {
    for (const e of MARKET_CATALOG) {
      if (!holds(e.when, traits)) continue;
      const because = [...(e.when.any ?? []), ...(e.when.all ?? [])].filter((t) => traits.has(t)) as Trait[];
      const evidencedBy = (e.cues ?? []).filter((t) => traits.has(t));
      items.push({
        key: e.key,
        section: e.section,
        relation: e.relation ?? null,
        state: evidencedBy.length > 0 ? "inference" : "hypothesis",
        because,
        evidencedBy,
        basis: [...new Set([...because, ...evidencedBy].flatMap(basisOf))],
      });
    }
  }

  // Vocabulary of the market as the company's own evidence names it (industries, technologies).
  const terminology = new Set<string>();
  for (const i of known) if (i.facet === "industries" || i.facet === "technologies") terminology.add(i.value.length <= 60 ? i.value : i.value.slice(0, 57) + "…");

  return {
    ontologyVersion: ONTOLOGY_VERSION,
    coverage,
    archetype,
    roles,
    terminology: [...terminology].slice(0, 8),
    items,
    unknowns: DIMENSION_KEYS.filter((d) => archetype[d].state === "unknown"),
  };
}
