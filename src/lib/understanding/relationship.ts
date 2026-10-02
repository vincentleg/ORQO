/**
 * Relationship assessment (Phase 16): what the target ALREADY is to the user's company.
 *
 * Pure and deterministic. It must be known before ORQO recommends anything,
 * because an existing relationship is not a new opportunity:
 * - a supplier is not a prospect;
 * - a partner is not a customer;
 * - a company that names the other on its website is related to it, not necessarily buying from it.
 *
 * Sources, strongest first:
 * - the user's answer (fact, authoritative);
 * - the user's Network stage (fact that a relationship exists, kind unspecified);
 * - sentences in either company's evidence that NAME the other company (inference).
 *
 * The vocabulary lives in lexicon.ts. No company, industry or size appears here.
 */
import { foldText } from "@/lib/intelligence/concepts";
import { NAME_STOPWORDS, RELATIONSHIP_CUES, termPositions, type RelationshipCue } from "./lexicon";
import { NOT_SURE, type CommercialUnderstanding, type DnaItem, type Validation } from "./types";

/** What the target is to the user's company. */
export const RELATIONSHIP_ROLES = ["customer", "supplier", "channel", "partner", "competitor"] as const;
export type RelationshipRole = (typeof RELATIONSHIP_ROLES)[number];

/** The question's answers: a role, or "no relationship yet". "not sure" is stored as NOT_SURE. */
export const RELATIONSHIP_ANSWERS = [...RELATIONSHIP_ROLES, "none"] as const;
export type RelationshipAnswer = (typeof RELATIONSHIP_ANSWERS)[number];

/** company_validations facet of the relationship answer (stored on the TARGET company). */
export const RELATIONSHIP_FACET = "relationship_role";

/** Network stage meaning "already a customer or partner" (kind not recorded). */
const NETWORK_EXISTING_STAGE = "customer_partner";

export interface RelationshipLink {
  role: RelationshipRole | "unspecified";
  state: "fact" | "inference";
  source: "user" | "network" | "own_evidence" | "target_evidence";
  /** DNA item keys of the sentence (evidence links only). */
  basis: string[];
  statement: string | null;
  sourceUrl: string | null;
}

export interface RelationshipAssessment {
  /**
   * - known: at least one link;
   * - none: the user said there is no relationship yet;
   * - unknown: nothing either way.
   */
  status: "known" | "none" | "unknown";
  links: RelationshipLink[];
  /** Distinct known roles (unspecified excluded). */
  roles: RelationshipRole[];
  /** The user already answered (any answer, including "not sure"), so the question is never asked again. */
  answered: boolean;
}

export interface StatedRelationship {
  /** The TARGET company's validations (only the relationship answer is read here). */
  validations: readonly Validation[];
  networkStage: string | null;
}

export const NO_STATED_RELATIONSHIP: StatedRelationship = { validations: [], networkStage: null };

interface Named {
  name: string;
  understanding: CommercialUnderstanding;
}

const STOP = new Set<string>(NAME_STOPWORDS);
const TEXT_FACETS = new Set(["description", "identity", "offerings", "customers", "industries", "technologies", "business_model", "problems_solved", "public_partners", "integrations", "certifications", "case_studies", "strategic_signals"]);

/** Terms that identify a company in a sentence: its full name, its first distinctive word and its domain label. */
export function nameTerms(p: Named): string[] {
  const out = new Set<string>();
  const full = foldText(p.name).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  if (full.length >= 4) out.add(full);
  const first = full.split(" ").find((w) => w.length >= 4 && !STOP.has(w));
  if (first) out.add(first);
  const site = p.understanding.dna.basis.website;
  if (site) {
    const host = site.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "");
    const label = foldText(host.split(".")[0] ?? "");
    if (label.length >= 4 && !STOP.has(label)) out.add(label);
  }
  return [...out];
}

const CUES = Object.keys(RELATIONSHIP_CUES) as RelationshipCue[];

/** The cue category nearest to a mention of the name, if any. */
function nearestCue(folded: string, namePositions: number[]): RelationshipCue | null {
  let best: { cue: RelationshipCue; d: number } | null = null;
  for (const cue of CUES)
    for (const p of termPositions(folded, RELATIONSHIP_CUES[cue]))
      for (const n of namePositions) {
        const d = Math.abs(p - n);
        if (!best || d < best.d) best = { cue, d };
      }
  return best?.cue ?? null;
}

/**
 * The target's role, read from a sentence written by `writer` that names the other company.
 * On our site, "built on X" means X supplies us. On X's site, "our customers include us" means X supplies us.
 */
function roleFrom(writer: "own" | "target", cue: RelationshipCue | null, facet: string): RelationshipRole | "unspecified" {
  if (facet === "integrations") return "partner";
  if (writer === "own") {
    if (cue) return ({ customer: "customer", uses: "supplier", resells: "supplier", channel: "channel", partner: "partner" } as const)[cue];
    if (facet === "customers" || facet === "case_studies") return "customer";
  } else {
    if (cue) return ({ customer: "supplier", uses: "customer", resells: "partner", channel: "partner", partner: "partner" } as const)[cue];
    if (facet === "customers" || facet === "case_studies") return "supplier";
  }
  return facet === "public_partners" ? "partner" : "unspecified";
}

function evidenceLinks(writer: "own" | "target", items: DnaItem[], other: Named): RelationshipLink[] {
  const terms = nameTerms(other);
  if (terms.length === 0) return [];
  const links: RelationshipLink[] = [];
  for (const i of items) {
    if (!TEXT_FACETS.has(i.facet) || i.state === "hypothesis") continue;
    const folded = foldText(i.value);
    const at = termPositions(folded, terms);
    if (at.length === 0) continue;
    links.push({
      role: roleFrom(writer, nearestCue(folded, at), i.facet),
      state: "inference",
      source: writer === "own" ? "own_evidence" : "target_evidence",
      basis: [i.key],
      statement: i.value,
      sourceUrl: i.evidence.find((e) => e.sourceUrl)?.sourceUrl ?? null,
    });
  }
  return links;
}

/** The latest relationship answer on the target company, or null. */
export function relationshipAnswer(validations: readonly Validation[]): Validation | null {
  return [...validations].filter((v) => v.kind === "answer" && v.facet === RELATIONSHIP_FACET).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function assessRelationship(own: Named, target: Named, stated: StatedRelationship = NO_STATED_RELATIONSHIP): RelationshipAssessment {
  const answer = relationshipAnswer(stated.validations);
  const done = (links: RelationshipLink[], answered: boolean, none = false): RelationshipAssessment => {
    // At most two sentences per role: the assessment summarizes, it does not copy the evidence.
    const kept: RelationshipLink[] = [];
    for (const l of links) if (kept.filter((k) => k.role === l.role).length < 2) kept.push(l);
    const roles = [...new Set(kept.flatMap((l) => (l.role === "unspecified" ? [] : [l.role])))];
    return { status: none ? "none" : kept.length ? "known" : "unknown", links: kept, roles, answered };
  };

  // The user's answer is authoritative and replaces what ORQO read.
  if (answer && answer.value !== NOT_SURE) {
    const values = answer.value.split(",").filter((v): v is RelationshipAnswer => (RELATIONSHIP_ANSWERS as readonly string[]).includes(v));
    if (values.includes("none")) return done([], true, true);
    if (values.length) return done(values.map((role) => ({ role: role as RelationshipRole, state: "fact" as const, source: "user" as const, basis: [], statement: null, sourceUrl: null })), true);
  }
  const links: RelationshipLink[] = [];
  if (stated.networkStage === NETWORK_EXISTING_STAGE) links.push({ role: "unspecified", state: "fact", source: "network", basis: [], statement: null, sourceUrl: null });
  links.push(...evidenceLinks("own", own.understanding.dna.items, target), ...evidenceLinks("target", target.understanding.dna.items, own));
  return done(links, Boolean(answer));
}

/** The strongest state with which the target is known to hold one of these roles (unspecified counts only when asked). */
export function heldAs(r: RelationshipAssessment | null | undefined, roles: readonly (RelationshipRole | "unspecified")[]): { state: "fact" | "inference"; basis: string[] } | null {
  const hits = (r?.links ?? []).filter((l) => roles.includes(l.role));
  if (hits.length === 0) return null;
  return { state: hits.some((l) => l.state === "fact") ? "fact" : "inference", basis: [...new Set(hits.flatMap((l) => l.basis))] };
}
