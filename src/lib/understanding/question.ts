/**
 * Minimal Next Best Question (Phase 14): "the one thing I need from you".
 *
 * Asked only when a business dimension could not be established from the
 * evidence. The chosen question is the unknown dimension whose answer would
 * settle the most market-model entries that are still compatible with what is
 * already known; the options are only the values plausible for this company
 * (OPTION_WHEN), so a software company is never asked about factories and a
 * consultancy is never offered milestone funding. A dimension answered — even
 * "not sure" — is never asked again.
 */
import { DIMENSIONS, DIMENSION_KEYS, dimensionsOf, holds, MARKET_CATALOG, OPTION_WHEN, type Condition, type Dimension } from "./ontology";
import type { BusinessDna, NextQuestion, Validation } from "./types";

/** Could this condition still hold once `dimension` is known? (Every other part already holds or mentions it.) */
function compatible(c: Condition, dimension: Dimension, traits: ReadonlySet<string>): boolean {
  const mentions = (t: string) => t.startsWith(`${dimension}:`);
  if (c.none?.some((t) => traits.has(t))) return false;
  if (c.all?.some((t) => !traits.has(t) && !mentions(t))) return false;
  if (c.any?.length && !c.any.some((t) => traits.has(t) || mentions(t))) return false;
  return true;
}

export function nextQuestion(dna: BusinessDna, validations: readonly Validation[]): NextQuestion | null {
  if (dna.status !== "analyzed") return null;
  const traits = new Set<string>(dna.traits);
  const answered = new Set(validations.filter((v) => v.kind === "answer").map((v) => v.facet));
  const knownDims = new Set(dna.items.filter((i) => i.state !== "hypothesis").map((i) => i.facet));
  const formKnown = knownDims.has("offering_form");

  let best: NextQuestion | null = null;
  for (const dimension of DIMENSION_KEYS) {
    if (knownDims.has(dimension) || answered.has(dimension)) continue;
    // Regulation is asked only when the company's evidence suggests it (an inferred hypothesis), never by default.
    if (dimension === "regulation" && !dna.items.some((i) => i.facet === "regulation")) continue;
    const unlocks = MARKET_CATALOG.filter((e) => !holds(e.when, traits) && dimensionsOf(e.when).includes(dimension) && compatible(e.when, dimension, traits)).length;
    const options = (DIMENSIONS[dimension] as readonly string[]).filter((v) => {
      const when = OPTION_WHEN[`${dimension}:${v}`];
      return !formKnown || !when || holds(when, traits);
    });
    // Without an offering form nothing else can be interpreted: it always comes first.
    const score = dimension === "offering_form" ? Number.MAX_SAFE_INTEGER : unlocks;
    if (options.length > 1 && unlocks > 0 && (!best || score > (best.dimension === "offering_form" ? Number.MAX_SAFE_INTEGER : best.unlocks))) best = { dimension, options, unlocks };
  }
  return best;
}
