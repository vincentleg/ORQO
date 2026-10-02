/**
 * Business DNA builder (Phase 14): what is this company?
 *
 * Pure and deterministic. Input: the stored research profile of the company
 * (claims with provenance) and the user's validations. No network, no model,
 * no database. Retrieved text is DATA: it is only matched against the
 * reviewed vocabulary and quoted back, never interpreted as instructions.
 *
 * Epistemic rules:
 * - text facets keep the claim's own state (sourced fact, inference, hypothesis);
 * - archetype dimensions and value-chain roles read from wording are INFERENCES
 *   (a word on a page is evidence, not proof of the business model);
 * - roles derived from an offering form are inferences of inferences, labelled derived;
 * - only the user turns an inference into a fact (confirm or answer), and that
 *   fact is labelled as stated by the user;
 * - a facet with no evidence is UNKNOWN. Nothing is filled from the market.
 */
import type { Claim, TargetProfile } from "@/lib/intelligence/types";
import { foldText } from "@/lib/intelligence/concepts";
import { CUE_FACETS, CUE_ROLES, describesProblem, traitsIn } from "./lexicon";
import { DERIVED_ROLES, DIMENSIONS, DIMENSION_KEYS, EVIDENCE_CUES, ONTOLOGY_VERSION, VALUE_CHAIN_ROLES, type Dimension, type Trait } from "./ontology";
import { DNA_FACETS, NOT_SURE, type BusinessDna, type DnaFacet, type DnaItem, type EvidenceRef, type TextFacet, type Validation } from "./types";

const FIELD_FACET: Partial<Record<Claim["field"], TextFacet>> = {
  summary: "description",
  identity: "identity",
  offering: "offerings",
  product: "offerings",
  customer: "customers",
  industry: "industries",
  geography: "geographies",
  technology: "technologies",
  business_model: "business_model",
  strategy: "strategic_signals",
  need: "strategic_signals",
};

/** Per-facet cap: the DNA is a summary of evidence, not a copy of it. */
const MAX_PER_FACET = 6;

/** Short, stable hash for item keys (djb2, base36). */
function hash(text: string): string {
  let h = 5381;
  for (const ch of foldText(text)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export const itemKey = (facet: DnaFacet, value: string): string => `${facet}:${/^[a-z_]+$/.test(value) ? value : hash(value)}`;

function claimState(c: Claim): DnaItem["state"] | null {
  if (c.epistemic === "fact") return "fact";
  if (c.epistemic === "inference") return "inference";
  if (c.epistemic === "assumption") return "hypothesis";
  return null;
}

/** The latest validation per item key / per answered dimension (validations are append-only). */
function latest(validations: readonly Validation[]) {
  const byItem = new Map<string, Validation>();
  const answers = new Map<string, Validation>();
  for (const v of [...validations].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (v.kind === "answer") answers.set(v.facet, v);
    else if (v.itemKey) byItem.set(v.itemKey, v);
  }
  return { byItem, answers };
}

/** What the team typed about its own company (the own profile). Stated by the user: never research. */
export interface StatedProfile {
  summary: string;
  offerings: readonly string[];
  customerSegments: readonly string[];
  markets: readonly string[];
  geographies: readonly string[];
}

export function buildBusinessDna(input: { companyName: string; website: string | null; intelligence: { id: string; researchedAt: string; profile: TargetProfile } | null; validations: readonly Validation[]; profile?: StatedProfile | null }): BusinessDna {
  const { intelligence } = input;
  const items = new Map<string, DnaItem>();
  const sources = new Map((intelligence?.profile.sources ?? []).map((s) => [s.key, s]));
  const ref = (c: Claim): EvidenceRef => {
    const src = c.sourceKey ? sources.get(c.sourceKey) : undefined;
    return { claimId: c.id, sourceUrl: src?.url ?? null, retrievedAt: src?.retrievedAt ?? null, excerpt: c.excerpt ?? null };
  };
  const add = (facet: DnaFacet, value: string, state: DnaItem["state"], origin: DnaItem["origin"], evidence: EvidenceRef[], selfDescribed: boolean, derivedFrom: string[] = []) => {
    const key = itemKey(facet, value);
    const existing = items.get(key);
    if (existing) {
      for (const e of evidence) if (!existing.evidence.some((x) => x.claimId === e.claimId)) existing.evidence.push(e);
      // A sourced fact outranks an inference of the same value.
      if (existing.state !== "fact" && state === "fact") existing.state = "fact";
      return;
    }
    if ([...items.values()].filter((i) => i.facet === facet).length >= MAX_PER_FACET) return;
    items.set(key, { key, facet, value, state, origin, confirmed: false, selfDescribed, evidence: [...evidence], derivedFrom });
  };

  for (const c of intelligence?.profile.claims ?? []) {
    const state = claimState(c);
    if (!state) continue;
    // A "fact" without a retrieved source is not a fact (same rule as the Evidence Store).
    const effective = state === "fact" && !(c.sourceKey && sources.has(c.sourceKey)) ? "inference" : state;
    const text = [c.statement, c.excerpt ?? ""].join(" ");
    const facet = FIELD_FACET[c.field];
    if (facet) add(facet, c.statement, effective, "research", [ref(c)], c.selfDescribed);
    if (describesProblem(c.statement) && (c.field === "summary" || c.field === "offering" || c.field === "product")) add("problems_solved", c.statement, effective, "research", [ref(c)], c.selfDescribed);
    for (const trait of traitsIn(text)) {
      const [kind, value] = trait.split(":") as [string, string];
      // Reading a business trait from wording is at best an inference; from a hypothesis, still a hypothesis.
      const read = effective === "hypothesis" ? "hypothesis" : "inference";
      if ((DIMENSION_KEYS as string[]).includes(kind)) add(kind as Dimension, value, read, "research", [ref(c)], c.selfDescribed);
      else if (kind === "role" && (CUE_ROLES as readonly string[]).includes(value)) add("value_chain_role", value, read, "research", [ref(c)], c.selfDescribed);
      else if (kind === "has" && (EVIDENCE_CUES as readonly string[]).includes(value)) add(CUE_FACETS[value as keyof typeof CUE_FACETS], c.statement, effective, "research", [ref(c)], c.selfDescribed);
    }
  }

  // What the team typed: its statements are facts stated by the user; the business traits ORQO reads in them are inferences.
  if (input.profile) {
    const stated: [TextFacet, readonly string[]][] = [
      ["description", input.profile.summary ? [input.profile.summary] : []],
      ["offerings", input.profile.offerings],
      ["customers", input.profile.customerSegments],
      ["industries", input.profile.markets],
      ["geographies", input.profile.geographies],
    ];
    for (const [facet, values] of stated)
      for (const value of values.slice(0, MAX_PER_FACET)) {
        const v = value.trim().slice(0, 400);
        if (!v) continue;
        const ev: EvidenceRef = { claimId: `profile:${facet}`, sourceUrl: null, retrievedAt: null, excerpt: v.slice(0, 320) };
        add(facet, v, "fact", "user", [ev], false);
        for (const trait of traitsIn(v)) {
          const [kind, val] = trait.split(":") as [string, string];
          if ((DIMENSION_KEYS as string[]).includes(kind)) add(kind as Dimension, val, "inference", "derived", [ev], false);
          else if (kind === "role" && (CUE_ROLES as readonly string[]).includes(val)) add("value_chain_role", val, "inference", "derived", [ev], false);
        }
      }
  }

  // The user's answers replace what was read for that dimension: they are authoritative facts about their own company.
  const { byItem, answers } = latest(input.validations);
  for (const [dimension, answer] of answers) {
    if (!(DIMENSION_KEYS as string[]).includes(dimension)) continue;
    const allowed = DIMENSIONS[dimension as Dimension] as readonly string[];
    const values = answer.value.split(",").filter((v) => allowed.includes(v));
    if (answer.value === NOT_SURE || values.length === 0) continue;
    for (const [k, it] of items) if (it.facet === dimension) items.delete(k);
    for (const v of values) items.set(itemKey(dimension as Dimension, v), { key: itemKey(dimension as Dimension, v), facet: dimension as Dimension, value: v, state: "fact", origin: "user", confirmed: true, selfDescribed: false, evidence: [], derivedFrom: [] });
  }

  // Confirm / reject.
  const rejected: BusinessDna["rejected"] = [];
  for (const [k, it] of items) {
    const v = byItem.get(k);
    if (v?.kind === "reject") {
      items.delete(k);
      rejected.push({ key: k, facet: it.facet, value: it.value });
    } else if (v?.kind === "confirm") {
      it.confirmed = true;
      it.state = "fact";
    }
  }

  // Roles that follow from an offering form (after validations, so a rejected form derives nothing).
  for (const it of [...items.values()]) {
    if (it.facet !== "offering_form") continue;
    const roleValue = DERIVED_ROLES[it.value as keyof typeof DERIVED_ROLES];
    const k = itemKey("value_chain_role", roleValue);
    if (!roleValue || items.has(k) || byItem.get(k)?.kind === "reject") continue;
    items.set(k, { key: k, facet: "value_chain_role", value: roleValue, state: "inference", origin: "derived", confirmed: byItem.get(k)?.kind === "confirm", selfDescribed: false, evidence: [], derivedFrom: [it.key] });
    if (byItem.get(k)?.kind === "confirm") items.get(k)!.state = "fact";
  }

  const list = [...items.values()];
  const traits = new Set<Trait>();
  for (const it of list) {
    if (it.state === "hypothesis") continue;
    if ((DIMENSION_KEYS as string[]).includes(it.facet)) traits.add(`${it.facet as Dimension}:${it.value}`);
    else if (it.facet === "value_chain_role" && (VALUE_CHAIN_ROLES as readonly string[]).includes(it.value)) traits.add(`role:${it.value}` as Trait);
  }
  for (const [cue, facet] of Object.entries(CUE_FACETS)) if (list.some((i) => i.facet === facet && i.state !== "hypothesis")) traits.add(`has:${cue}` as Trait);

  const present = new Set(list.map((i) => i.facet));
  return {
    companyName: input.companyName,
    ontologyVersion: ONTOLOGY_VERSION,
    status: intelligence ? "analyzed" : "not_analyzed",
    basis: { intelligenceId: intelligence?.id ?? null, researchedAt: intelligence?.researchedAt ?? null, website: input.website },
    items: list,
    unknowns: DNA_FACETS.filter((facet) => !present.has(facet)),
    rejected,
    traits: [...traits].sort(),
  };
}
