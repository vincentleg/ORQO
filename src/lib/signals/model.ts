/**
 * Intelligence & signals (Phase 7) — the pure, deterministic core: signal
 * vocabulary, change classification, DELTA detection between two stored
 * analyses of the same company, deduplication keys, evidence quality and the
 * lifecycle. Framework-, network- and persistence-free; no model calls.
 *
 * A signal is a PUBLIC business change with provenance. It is never built
 * from private relationship memory: that is only consulted at read time to
 * explain why a public change may matter (see ./relevance.ts).
 */
import { concept, foldText, isGeneric } from "@/lib/intelligence/concepts";
import type { Claim, ClaimField, ResearchSource, SourceAuthority, TargetProfile } from "@/lib/intelligence/types";

export const SIGNAL_KINDS = [
  "geographic_expansion",
  "market_entry",
  "product_launch",
  "offering_change",
  "manufacturing",
  "funding",
  "hiring",
  "partnership",
  "acquisition",
  "customer_win",
  "certification",
  "event",
  "other",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_ORIGINS = ["research", "manual"] as const;
export type SignalOrigin = (typeof SIGNAL_ORIGINS)[number];

export const SIGNAL_STATUSES = ["new", "reviewed", "acted_on", "dismissed"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const EVIDENCE_QUALITIES = ["strong", "moderate", "limited"] as const;
export type EvidenceQuality = (typeof EVIDENCE_QUALITIES)[number];

/** fact: the source states the change · inference: derived from a new mention, to validate. */
export type SignalEpistemic = "fact" | "inference";

export interface SignalView {
  id: string;
  companyId: string;
  kind: SignalKind;
  origin: SignalOrigin;
  headline: string;
  detail: string;
  excerpt: string | null;
  field: ClaimField | null;
  concepts: string[];
  epistemic: SignalEpistemic;
  evidenceQuality: EvidenceQuality;
  sourceUrl: string;
  sourceLabel: string;
  sourceAuthority: SourceAuthority;
  /** Publication / event day stated by the source (YYYY-MM-DD), or null = unknown. */
  publishedOn: string | null;
  retrievedAt: string | null;
  previousResearchedAt: string | null;
  previousConcepts: string[];
  status: SignalStatus;
  statusChangedAt: string | null;
  followUpId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** What the pipeline proposes to store. Lifecycle columns are decided by the database. */
export interface SignalCandidate {
  kind: SignalKind;
  origin: SignalOrigin;
  headline: string;
  detail: string;
  excerpt: string | null;
  field: ClaimField | null;
  concepts: string[];
  epistemic: SignalEpistemic;
  evidenceQuality: EvidenceQuality;
  sourceUrl: string;
  sourceLabel: string;
  sourceAuthority: SourceAuthority;
  publishedOn: string | null;
  retrievedAt: string | null;
  previousResearchedAt: string | null;
  previousConcepts: string[];
  dedupKey: string;
}

// ---------------------------------------------------------------------------
// Classification (generic, bilingual; matched on folded text)
// ---------------------------------------------------------------------------

/** Ordered: the first matching pattern decides the kind. */
const KIND_PATTERNS: [SignalKind, RegExp][] = [
  ["acquisition", /\b(acquires?|acquired|acquisition of|to acquire|rachete|rachat de|merger with|fusion avec)\b/],
  ["funding", /\b(raises?|raised|funding round|series [a-e]|seed round|levee de fonds|leve \d|financement de|investment led by)\b/],
  ["partnership", /\b(partnership with|partners with|partnered with|strategic alliance|alliance with|partenariat avec|s'associe a|teams up with)\b/],
  ["customer_win", /\b(selected by|chosen by|wins? (a |an )?(contract|tender|deal)|awarded (a |an )?(contract|tender)|signs? (a |an )?(contract|agreement) with|retenu par|choisi par|remporte (un|le) (contrat|marche|appel d'offres))\b/],
  ["certification", /\b(iso ?\d{4,5}|certified|certification|ce marking|marquage ce|fedramp|soc ?2|homologation|homologue)\b/],
  ["manufacturing", /\b(mass production|volume production|production line|new (factory|plant|facility)|manufacturing (facility|site|plant)|starts? production|enters? production|usine|production en serie|ligne de production|industrialisation)\b/],
  [
    "geographic_expansion",
    /\b(expands? (to|into|in)|expansion (to|into|in)|international expansion|opens? (a |an )?(new )?(office|subsidiary|hub|branch)|new (office|subsidiary|hub) in|launch(es|ed)? in|now available in|enters? the [a-z ]+ market|s'implante|implantation|ouvre (un|une) (bureau|filiale)|nouvelle filiale|expansion internationale)\b/,
  ],
  ["product_launch", /\b(launch(es|ed)?|introduc(es|ed|ing)|unveil(s|ed)?|new (product|platform|appliance|system|generation|range)|general availability|now shipping|lance(ment)?|devoile|nouveau produit|nouvelle (gamme|plateforme|generation))\b/],
  ["hiring", /\b(we'?re hiring|is hiring|now hiring|recrute|recrutement|appoints?|appointed|nomme|nomination)\b/],
  ["event", /\b(trade show|exhibit(s|ing|or)|booth|salon|summit|conference|keynote)\b/],
];

/** The kind of change a sentence states, or null when it states none of the known kinds. */
export function classifyChange(text: string): SignalKind | null {
  const folded = foldText(text);
  for (const [kind, re] of KIND_PATTERNS) if (re.test(folded)) return kind;
  return null;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit, hex. Stable, dependency-free, good enough for a dedup key (not security). */
export function stableHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/g;

/** The gist of a statement: folded, without dates, digits-only tokens or punctuation. Same news re-worded with a date counts once. */
export function factGist(text: string): string {
  return foldText(text)
    .replace(MONTHS, " ")
    .replace(/\b\d{1,4}\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** A public URL without scheme noise, fragment, tracking query or trailing slash. */
export function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|fbclid|gclid|mc_|ref$)/i.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${query}`;
  } catch {
    return foldText(url);
  }
}

/**
 * company + kind + the changed fact. The company is the row's own scope (unique
 * per company); the source is deliberately NOT part of a research key, so the
 * same change read on another page of the site is not a second signal.
 */
export function dedupKey(kind: SignalKind, basis: { field: string; fact: string } | { url: string }): string {
  if ("url" in basis) return `${kind}:url:${stableHash(normalizeSourceUrl(basis.url))}`;
  return `${kind}:${basis.field}:${stableHash(basis.fact)}`;
}

// ---------------------------------------------------------------------------
// Evidence quality
// ---------------------------------------------------------------------------

/**
 * strong: an official or retrieved independent page states it, with a verbatim excerpt;
 * moderate: stated without excerpt, or recorded by a person from a public URL ORQO did not retrieve;
 * limited: an inference from a mention, or a search snippet (never primary evidence).
 */
export function evidenceQuality(e: { epistemic: SignalEpistemic; authority: SourceAuthority; origin: SignalOrigin; hasExcerpt: boolean }): EvidenceQuality {
  if (e.epistemic === "inference" || e.authority === "search_result") return "limited";
  if (e.origin === "manual") return "moderate";
  return e.hasExcerpt ? "strong" : "moderate";
}

// ---------------------------------------------------------------------------
// Delta: what is new relative to what ORQO previously knew
// ---------------------------------------------------------------------------

export interface DeltaInput {
  /** The analysis stored before this run, or null (first analysis = baseline, never a signal). */
  previous: { profile: TargetProfile; researchedAt: string; mode: "basic" | "deep" } | null;
  next: TargetProfile;
}

/** Fields whose changes can be business signals. Identity, summary wording, business model and openness are not. */
const SIGNAL_FIELDS: ReadonlySet<ClaimField> = new Set(["strategy", "customer", "geography", "product", "offering", "technology", "industry"]);
const MAX_SIGNALS_PER_DELTA = 8;

function conceptsOfField(profile: TargetProfile, field: ClaimField): Set<string> {
  return new Set(profile.claims.filter((c) => c.field === field).flatMap((c) => c.concepts));
}

function gistsOf(profile: TargetProfile): Set<string> {
  const out = new Set<string>();
  for (const c of profile.claims) {
    out.add(factGist(c.statement));
    if (c.excerpt) out.add(factGist(c.excerpt));
  }
  return out;
}

function kindForConceptField(field: ClaimField): SignalKind | null {
  if (field === "geography") return "geographic_expansion";
  if (field === "industry" || field === "customer") return "market_entry";
  if (field === "offering" || field === "technology" || field === "product") return "offering_change";
  return null;
}

/**
 * Compares two analyses of the same official website and proposes signals
 * for what is NEW in the second one:
 *  - a sourced statement (news, strategy, customer, product) not present
 *    before, classified by what it states;
 *  - a specific concept (a geography, an industry, a technology) newly
 *    mentioned in a field — an inference to validate.
 * Unchanged facts, reworded identity/summary text, generic concepts and the
 * first analysis (baseline) produce nothing. Model-extracted claims are only
 * compared with an earlier analysis of the same depth, so "read more deeply"
 * is not mistaken for "changed".
 */
export function detectDelta(input: DeltaInput): SignalCandidate[] {
  const { previous, next } = input;
  if (!previous || previous.profile.domain !== next.domain) return [];
  const before = previous.profile;
  const beforeGists = gistsOf(before);
  const sourceByKey = new Map(next.sources.map((s) => [s.key, s]));
  const out = new Map<string, SignalCandidate>();

  const make = (c: Claim, source: ResearchSource, kind: SignalKind, epistemic: SignalEpistemic, concepts: string[], basisFact: string): SignalCandidate => ({
    kind,
    origin: "research",
    // A concept claim whose sentence states the change is quoted by its sentence, not its concept label.
    headline: (c.epistemic === "inference" && epistemic === "fact" && c.excerpt ? c.excerpt : c.statement).slice(0, 400),
    detail: "",
    excerpt: c.excerpt?.slice(0, 320) ?? null,
    field: c.field,
    concepts: concepts.slice(0, 12),
    epistemic,
    evidenceQuality: evidenceQuality({ epistemic, authority: source.authority, origin: "research", hasExcerpt: Boolean(c.excerpt) }),
    sourceUrl: source.url,
    sourceLabel: source.title.slice(0, 500),
    sourceAuthority: source.authority,
    // Website text carries no trustworthy publication date in Phase 3 extraction: unknown, never the retrieval day.
    publishedOn: null,
    retrievedAt: source.retrievedAt,
    previousResearchedAt: previous.researchedAt,
    previousConcepts: [...conceptsOfField(before, c.field)].slice(0, 24),
    // A stated change is keyed on its sentence only, so the same sentence reached through two claim fields is one signal.
    dedupKey: dedupKey(kind, { field: epistemic === "fact" ? "stated" : c.field, fact: basisFact }),
  });

  for (const c of next.claims) {
    if (!SIGNAL_FIELDS.has(c.field)) continue;
    if (c.method === "model_extraction" && previous.mode !== "deep") continue;
    const source = c.sourceKey ? sourceByKey.get(c.sourceKey) : undefined;
    if (!source || source.authority === "search_result") continue;

    // 1. A statement the source makes that ORQO had not seen.
    const text = c.excerpt ?? c.statement;
    const stated = classifyChange(text);
    const gist = factGist(text);
    const listedProduct = c.field === "product" && c.method === "navigation";
    if (gist.length >= (listedProduct ? 2 : 12) && !beforeGists.has(gist) && !beforeGists.has(factGist(c.statement)) && (stated || c.field === "strategy" || listedProduct)) {
      // A product newly listed on the official site is an offering change; other unclassified news stays "other".
      const kind = stated ?? (listedProduct ? "offering_change" : "other");
      const candidate = make(c, source, kind, "fact", c.concepts, gist);
      if (!out.has(candidate.dedupKey)) out.set(candidate.dedupKey, candidate);
      continue;
    }

    // 2. A specific concept newly mentioned in this field.
    if (c.epistemic !== "inference") continue;
    const kind = kindForConceptField(c.field);
    if (!kind) continue;
    const known = conceptsOfField(before, c.field);
    const fresh = c.concepts.filter((k) => !known.has(k) && !isGeneric(k) && concept(k));
    if (fresh.length === 0) continue;
    const candidate = make(c, source, kind, "inference", fresh, `concept:${[...fresh].sort().join(",")}`);
    if (!out.has(candidate.dedupKey)) out.set(candidate.dedupKey, candidate);
  }

  const rank = (s: SignalCandidate) => (s.epistemic === "fact" ? 0 : 1) + (s.evidenceQuality === "strong" ? 0 : s.evidenceQuality === "moderate" ? 1 : 2);
  return [...out.values()].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_SIGNALS_PER_DELTA);
}

// ---------------------------------------------------------------------------
// Lifecycle (no hidden transitions)
// ---------------------------------------------------------------------------

/** User-triggered transitions. acted_on is reached only by creating a follow-up from the signal. */
const TRANSITIONS: Record<SignalStatus, readonly SignalStatus[]> = {
  new: ["reviewed", "dismissed", "acted_on"],
  reviewed: ["new", "dismissed", "acted_on"],
  acted_on: ["new"],
  dismissed: ["new"],
};

export function canTransition(from: SignalStatus, to: SignalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Open signals are still awaiting a human decision. */
export function isOpenSignal(s: Pick<SignalView, "status">): boolean {
  return s.status === "new" || s.status === "reviewed";
}
