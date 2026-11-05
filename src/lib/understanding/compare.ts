/**
 * Side-by-side comparison of the user's company and a target (Nov 2026), derived ONLY from the dossier:
 * both Business DNAs and the scenario engine's lead scenario. Pure and deterministic. Used by the company page
 * and by the public guided tour, so both show the same reasoning.
 *
 * A row is:
 * - "complement" when the lead scenario relies on a trait of this facet that one side has and the other lacks
 *   (what one brings, the other needs);
 * - "shared" when the engine found shared context for this facet (industries, technologies) or both sides hold the
 *   same value of a dimension;
 * - "neutral" otherwise.
 * There is no score: the qualitative assessment lives in the scenario's dimensions.
 */
import type { Dossier } from "./dossier";
import type { DnaFacet, DnaItem, KnowledgeState } from "./types";

export type CompareLink = "complement" | "shared" | "neutral";

export interface CompareCell {
  /** Dimension facets: ontology value keys (label with understanding.values.<facet>.<key>); text facets: statements. */
  values: string[];
  kind: "dimension" | "text";
  /** The strongest knowledge state among the values (fact > inference > hypothesis). */
  state: Exclude<KnowledgeState, "unknown"> | null;
}

export interface CompareRow {
  facet: DnaFacet;
  own: CompareCell;
  target: CompareCell;
  link: CompareLink;
  /** Shared concept keys (label with conceptLabel) when link is "shared" through the engine's shared context. */
  sharedConcepts: string[];
}

/** The facets a business developer compares, in reading order. */
export const COMPARE_FACETS: readonly DnaFacet[] = ["value_chain_role", "offering_form", "offerings", "customer_scope", "customers", "industries", "technologies", "geographies", "sales_motion", "strategic_signals"];

const DIMENSIONS = new Set<DnaFacet>(["value_chain_role", "offering_form", "customer_scope", "sales_motion", "revenue_model", "regulation"]);
const RANK = { fact: 0, inference: 1, hypothesis: 2 } as const;
const MAX_TEXT = 3;

function cell(items: readonly DnaItem[], facet: DnaFacet): CompareCell {
  const mine = items.filter((i) => i.facet === facet).sort((a, b) => RANK[a.state] - RANK[b.state]);
  const kind = DIMENSIONS.has(facet) ? "dimension" : "text";
  return { kind, values: [...new Set(mine.map((i) => i.value))].slice(0, kind === "text" ? MAX_TEXT : 6), state: mine[0]?.state ?? null };
}

export function compareCompanies(d: Dossier): CompareRow[] {
  const lead = d.scenarios[0] ?? d.novel[0] ?? null;
  // Traits the lead scenario relies on, as facet → values, e.g. value_chain_role → manufacturer.
  const traits = lead ? [...lead.contributions.provider.traits, ...lead.contributions.partner.traits] : [];
  const traitValues = new Map<string, Set<string>>();
  for (const t of traits) {
    const [facet, value] = t.startsWith("role:") ? ["value_chain_role", t.slice(5)] : t.split(":");
    if (!traitValues.has(facet)) traitValues.set(facet, new Set());
    traitValues.get(facet)!.add(value);
  }
  const shared = lead?.shared ?? null;
  return COMPARE_FACETS.map((facet) => {
    const own = cell(d.ownDna.items, facet);
    const target = cell(d.targetDna.items, facet);
    const sharedConcepts = facet === "industries" ? (shared?.industries ?? []) : facet === "technologies" ? (shared?.technologies ?? []) : [];
    const sameDimension = own.kind === "dimension" && own.values.some((v) => target.values.includes(v));
    // Complementary: a trait the scenario relies on that ONE side has and the other lacks. Both have it: shared.
    const relied = [...(traitValues.get(facet) ?? [])];
    const complement = relied.some((v) => own.values.includes(v) !== target.values.includes(v));
    const link: CompareLink = complement ? "complement" : sharedConcepts.length > 0 || sameDimension ? "shared" : "neutral";
    return { facet, own, target, link, sharedConcepts };
  }).filter((r) => r.own.values.length > 0 || r.target.values.length > 0);
}
