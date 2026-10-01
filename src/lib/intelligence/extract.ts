/**
 * Deterministic company understanding from retrieved pages. No model is
 * involved: every claim quotes the page it came from, and anything the pages
 * do not establish is reported as UNKNOWN rather than filled in.
 *
 * Epistemics:
 * - What the company states about itself (description, product names, customer
 *   statements) is a FACT about its positioning, flagged `selfDescribed`.
 * - Categorizations derived from keywords ("serves healthcare") are INFERENCES
 *   that carry the sentence they were inferred from.
 */
import { conceptLabel, concept as conceptOf, foldText, isGeneric, matchConcepts } from "./concepts";
import { cleanText, sentences, type PageDocument } from "./html";
import { UNDERSTANDING_FIELDS, type Claim, type ClaimField, type ResearchSource, type TargetProfile, type UnderstandingField } from "./types";

export interface RetrievedPage {
  doc: PageDocument;
  source: ResearchSource;
}

export interface ExtractionInput {
  nameHint: string | null;
  domain: string;
  website: string;
  resolution: TargetProfile["resolution"];
  pages: RetrievedPage[];
  now: Date;
}

const CATEGORY_FIELD: Record<string, ClaimField> = {
  offering_type: "offering",
  technology: "technology",
  industry: "industry",
  geography: "geography",
  business_model: "business_model",
  customer_type: "customer",
};

const PRODUCT_PATH = /\/(products?|solutions?|platforms?|services?|offerings?|produits?|offres?|gamme)(\/|$|-)/i;
const PARTNER_PATH = /\/(partners?|partenaires?|partner-program|become-a-partner|devenir-partenaire)(\/|$|-)/i;
const NAV_STOPWORDS = new Set(
  ["products", "product", "solutions", "solution", "services", "service", "platform", "overview", "learn more", "read more", "more", "all products", "view all", "see all", "home", "contact", "contact us", "produits", "en savoir plus", "voir plus", "accueil", "nos solutions", "nos produits", "offres", "discover", "découvrir", "get started", "demo", "request a demo", "support", "login", "sign in"].map(foldText),
);
const CUSTOMER_RE = /\b(customers? (include|such as|like)|clients? (include|such as)|trusted by|used by|deployed (by|at)|case stud(y|ies)|nos clients|ils nous font confiance|references? clients?|utilise par)\b/i;
const STRATEGY_RE = /\b(announce[sd]?|launch(es|ed)?|partnership with|partners with|acquire[sd]?|acquisition|raise[sd]? \$?|funding|series [a-e]\b|expands?|expansion|opens? (a )?new|annonce|lance(ment)?|partenariat|rach[eè]te|l[eè]ve|levee de fonds|ouvre)\b/i;
const PARTNER_RE = /\b(partner program|become a partner|partner network|channel program|programme partenaires?|devenir partenaire|reseller program)\b/i;
/** Calls to action and navigation chrome that are never product names. */
const CTA_RE = /^((skip|menu|close|open|find|sign|contact|learn|read|get|request|download|watch|see|view|explore|subscribe|join|book|try|start|back|next|previous|more|all|voir|lire|en savoir)\b|discover|decouvr|contactez|telecharg|demandez|inscri)/;
/**
 * Sentences about individual people (biographies, degrees, careers). Company
 * analysis does not need them, so they are never processed or quoted
 * (data minimization).
 */
const PERSON_RE = /\b(he|she|his|her|him)\b|\b(studied|undergrad\w*|alumn\w*|bachelor|master'?s degree|mba|ph\.?d|graduated|years of (industry |professional )?experience|prior to joining|before joining|previously served|left \w+ to (create|found|start|join))\b|\b(il|elle) (a dirige|a rejoint|est diplome|a fonde)|\bdiplome d/;
/** Statement used for partner-program evidence: openness to partners, not a stated need. */
export const OPENNESS_TO_PARTNERS = "Has a partner program";
/** Utility headings ("Media inquiries", "Careers") say nothing about the business. */
const UTILITY_HEADING_RE = /\b(inquir\w*|enquir\w*|contact|careers?|jobs?|newsletter|subscribe|cookies?|login|sign in|press contact|recrutement|carrieres?|nous contacter)\b/;
const PARKED_RE = /\b(domain (is )?for sale|buy this domain|this domain may be for sale|parked (free|domain)|domaine (est )?[aà] vendre)\b/i;

function orgNode(page: PageDocument): Record<string, unknown> | null {
  const types = (n: Record<string, unknown>) => ([] as unknown[]).concat(n["@type"]).map(String);
  return page.jsonLd.find((n) => types(n).some((t) => /^(Organization|Corporation|LocalBusiness|Company|OnlineBusiness)$/i.test(t))) ?? null;
}

function str(v: unknown, max = 400): string | null {
  if (typeof v === "string") return cleanText(v, max) || null;
  if (typeof v === "number") return String(v);
  return null;
}

function excerpt(s: string): string {
  const t = cleanText(s, 1000);
  return t.length <= 300 ? t : `${t.slice(0, 297).replace(/\s+\S*$/, "")}…`;
}

/** Concepts used to describe a TARGET: value-chain service words are too ambiguous on marketing pages. */
function targetConceptKeys(text: string): string[] {
  return matchConcepts(text).filter((k) => conceptOf(k)?.category !== "value_chain");
}

/** Best identity name from a page: JSON-LD, og:site_name, then the title's brand segment. */
export function pageIdentityName(page: PageDocument): string | null {
  const org = orgNode(page);
  const fromLd = org ? str(org.name, 200) : null;
  if (fromLd) return fromLd;
  if (page.meta["og:site_name"]) return page.meta["og:site_name"].slice(0, 200);
  const parts = page.title.split(/\s[|\-–—:·]\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // The brand is usually the shortest segment ("Composable GPU servers | GigaIO").
  return [...parts].sort((a, b) => a.length - b.length)[0].slice(0, 200);
}

/** True when a homepage plausibly belongs to the named company (used to verify an inferred domain). */
export function pageMatchesName(page: PageDocument, name: string): boolean {
  if (PARKED_RE.test(`${page.title} ${page.text.slice(0, 3000)}`)) return false;
  const wanted = foldText(name).replace(/[^\p{L}\p{N}]/gu, "");
  if (wanted.length < 2) return false;
  const candidates = [pageIdentityName(page), page.title, page.meta["og:title"], page.meta["application-name"]].filter((x): x is string => Boolean(x));
  return candidates.some((c) => {
    const have = foldText(c).replace(/[^\p{L}\p{N}]/gu, "");
    return have.includes(wanted) || (have.length >= 3 && wanted.includes(have));
  });
}

export function isParked(page: PageDocument): boolean {
  return PARKED_RE.test(`${page.title} ${page.text.slice(0, 3000)}`);
}

const PAGE_ORDER = ["home", "about", "products", "industries", "customers", "news", "other"];

export function extractTargetProfile(input: ExtractionInput): TargetProfile {
  const claims: Claim[] = [];
  const pages = [...input.pages].sort((a, b) => PAGE_ORDER.indexOf(a.source.pageType) - PAGE_ORDER.indexOf(b.source.pageType));
  const add = (c: Omit<Claim, "id" | "concepts" | "selfDescribed"> & { concepts?: string[]; selfDescribed?: boolean }) => {
    if (claims.length >= 110) return;
    if (c.excerpt && claims.some((x) => x.field === c.field && x.excerpt === c.excerpt && x.statement === c.statement)) return;
    claims.push({ concepts: [], selfDescribed: false, ...c, id: `c${claims.length + 1}` });
  };
  const home = pages.find((p) => p.source.pageType === "home") ?? pages[0];

  // Identity and self-description (structured data first).
  let name = input.nameHint ?? input.domain;
  if (home) {
    const org = orgNode(home.doc);
    const idName = pageIdentityName(home.doc);
    if (idName) {
      name = idName;
      add({ field: "identity", statement: idName, excerpt: excerpt(idName), sourceKey: home.source.key, epistemic: "fact", method: org ? "structured_data" : "page_metadata", selfDescribed: true });
    }
    const description = (org && str(org.description, 1000)) || home.doc.meta.description || home.doc.meta["og:description"] || home.doc.meta["twitter:description"];
    if (description && description.length >= 20) {
      add({ field: "summary", statement: excerpt(description), excerpt: excerpt(description), sourceKey: home.source.key, epistemic: "fact", method: org?.description ? "structured_data" : "page_metadata", concepts: targetConceptKeys(description), selfDescribed: true });
    }
    if (org) {
      const founded = str(org.foundingDate, 40);
      if (founded) add({ field: "identity", statement: `Founded ${founded}`, excerpt: excerpt(`foundingDate: ${founded}`), sourceKey: home.source.key, epistemic: "fact", method: "structured_data", selfDescribed: true });
      const address = org.address as Record<string, unknown> | undefined;
      const country = address && typeof address === "object" ? (str(address.addressCountry, 80) ?? str((address.addressCountry as Record<string, unknown> | undefined)?.name, 80)) : null;
      const locality = address && typeof address === "object" ? str(address.addressLocality, 80) : null;
      if (country || locality) {
        const where = [locality, country].filter(Boolean).join(", ");
        add({ field: "geography", statement: `Headquarters: ${where}`, excerpt: excerpt(`address: ${where}`), sourceKey: home.source.key, epistemic: "fact", method: "structured_data", concepts: targetConceptKeys(where), selfDescribed: true });
      }
    }
  }
  const summaryClaim = claims.find((c) => c.field === "summary");
  if (!summaryClaim && home) {
    // Fall back to the first substantive sentence of the homepage, still quoted.
    const first = sentences(home.doc.text, 20).find((s) => s.length >= 60 && matchConcepts(s).length > 0 && !PERSON_RE.test(foldText(s)));
    if (first) add({ field: "summary", statement: excerpt(first), excerpt: excerpt(first), sourceKey: home.source.key, epistemic: "fact", method: "page_text", concepts: targetConceptKeys(first), selfDescribed: true });
  }

  // Products / solutions named in navigation.
  const seenProducts = new Set<string>();
  for (const { doc, source } of pages) {
    for (const link of doc.links) {
      if (seenProducts.size >= 10) break;
      let path: string;
      try {
        const u = new URL(link.href);
        if (u.hostname.replace(/^www\./, "") !== input.domain) continue;
        path = u.pathname;
      } catch {
        continue;
      }
      if (!PRODUCT_PATH.test(path)) continue;
      // Same-page anchors ("Skip to content") and bare index pages are navigation, not products.
      if (path.replace(/\/$/, "") === new URL(doc.url).pathname.replace(/\/$/, "") || path.split("/").filter(Boolean).length < 2) continue;
      const text = link.text.replace(/[|›»→]+/g, " ").trim();
      const words = text.split(/\s+/).length;
      const key = foldText(text);
      if (text.length < 2 || text.length > 50 || words > 5 || NAV_STOPWORDS.has(key) || CTA_RE.test(key) || seenProducts.has(key)) continue;
      seenProducts.add(key);
      add({ field: "product", statement: text, excerpt: excerpt(text), sourceKey: source.key, epistemic: "fact", method: "navigation", concepts: targetConceptKeys(text), selfDescribed: true });
    }
  }
  // Concepts inferred from the pages' own sentences. Conservative by design:
  // - at most 2 concepts per sentence, specific ones first;
  // - a broad concept (AI, software, cloud…) is inferred once at most;
  // - a second excerpt for a concept must come from another page (independent corroboration);
  // - value-chain service vocabulary is not inferred about targets (too ambiguous on marketing pages).
  const perConcept = new Map<string, string[]>();
  let customers = 0;
  let strategy = 0;
  const seenStrategy = new Set<string>();
  // Same headline repeated with a date or different casing counts once.
  const gist = (s: string) => foldText(s).replace(/[^a-z ]/g, "").replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const year = input.now.getUTCFullYear();
  for (const { doc, source } of pages) {
    const headings = doc.headings.filter((h) => !UTILITY_HEADING_RE.test(foldText(h)));
    const texts = [...(source.pageType === "home" ? [doc.meta.description ?? ""] : []), ...headings, ...sentences(doc.text, 250)];
    for (const s of texts) {
      if (!s || PERSON_RE.test(foldText(s))) continue;
      const keys = targetConceptKeys(s)
        .sort((a, b) => Number(isGeneric(a)) - Number(isGeneric(b)))
        .slice(0, 2);
      for (const key of keys) {
        const pagesSeen = perConcept.get(key) ?? [];
        if (pagesSeen.length >= (isGeneric(key) ? 1 : 2) || pagesSeen.includes(source.key)) continue;
        const def = conceptOf(key);
        if (!def) continue;
        perConcept.set(key, [...pagesSeen, source.key]);
        add({ field: CATEGORY_FIELD[def.category], statement: conceptLabel(key, "en"), excerpt: excerpt(s), sourceKey: source.key, epistemic: "inference", method: "page_text", concepts: [key], selfDescribed: true });
      }
      if (customers < 3 && s.length >= 60 && CUSTOMER_RE.test(s)) {
        customers++;
        add({ field: "customer", statement: excerpt(s), excerpt: excerpt(s), sourceKey: source.key, epistemic: "fact", method: "page_text", concepts: targetConceptKeys(s), selfDescribed: true });
      }
      if (strategy < 3 && STRATEGY_RE.test(s) && (source.pageType === "news" || new RegExp(`\\b(${year}|${year - 1})\\b`).test(s)) && !seenStrategy.has(gist(s))) {
        seenStrategy.add(gist(s));
        strategy++;
        add({ field: "strategy", statement: excerpt(s), excerpt: excerpt(s), sourceKey: source.key, epistemic: "fact", method: "page_text", concepts: targetConceptKeys(s), selfDescribed: true });
      }
      // A partner program shows openness to partners, never a specific need. Careers pages are not recorded.
      if (PARTNER_RE.test(s) && !claims.some((c) => c.statement === OPENNESS_TO_PARTNERS)) {
        add({ field: "need", statement: OPENNESS_TO_PARTNERS, excerpt: excerpt(s), sourceKey: source.key, epistemic: "inference", method: "page_text", selfDescribed: true });
      }
    }
    if (!claims.some((c) => c.statement === OPENNESS_TO_PARTNERS)) {
      const partnerLink = doc.links.find((l) => {
        try {
          return new URL(l.href).hostname.replace(/^www\./, "") === input.domain && PARTNER_PATH.test(new URL(l.href).pathname) && l.text.length > 2;
        } catch {
          return false;
        }
      });
      if (partnerLink) add({ field: "need", statement: OPENNESS_TO_PARTNERS, excerpt: excerpt(partnerLink.text), sourceKey: source.key, epistemic: "inference", method: "navigation", selfDescribed: true });
    }
  }

  const unknowns = unknownFields(claims);
  return {
    name: name.slice(0, 200),
    domain: input.domain,
    website: input.website,
    resolution: input.resolution,
    language: home?.doc.lang ?? null,
    sources: pages.map((p) => p.source),
    claims,
    unknowns,
  };
}

/**
 * Fields the evidence does not establish. An openness signal (partner program)
 * does not establish what the company needs, so "need" stays unknown.
 */
export function unknownFields(claims: readonly Claim[]): UnderstandingField[] {
  const covered = new Set<ClaimField>(claims.filter((c) => !isOpennessSignal(c)).map((c) => c.field));
  return UNDERSTANDING_FIELDS.filter((f) => !covered.has(f));
}

export function isOpennessSignal(claim: Claim): boolean {
  return claim.field === "need" && claim.statement === OPENNESS_TO_PARTNERS;
}

/** Claims a UI or critic may treat as evidence: sourced, and not from a snippet-only source. */
export function isSourcedEvidence(claim: Claim, sources: readonly ResearchSource[]): boolean {
  if (!claim.sourceKey || !claim.excerpt || claim.epistemic === "assumption" || claim.epistemic === "unknown") return false;
  const s = sources.find((x) => x.key === claim.sourceKey);
  return Boolean(s && s.authority !== "search_result");
}
