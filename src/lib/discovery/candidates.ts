/**
 * Stage 1 of the discovery funnel — cheap and broad: normalize candidate
 * identities, deduplicate, drop obvious non-candidates, and attach what ORQO
 * already knows (Network, stored research, earlier rejections). Nothing here
 * fetches a page or reads web text as evidence: a source snippet is kept only
 * as a "why it was discovered" hint.
 */
import { websiteDomain } from "@/lib/search/query";
import { DISCOVERY_LIMITS, type CandidateSourceId, type RejectionReason } from "./types";

/** What a candidate source returns. Minimal on purpose. */
export interface RawCandidate {
  name: string | null;
  url: string;
  /** Snippet or reason from the source. A discovery hint, never evidence. */
  hint: string | null;
  source: CandidateSourceId;
}

export interface KnownCompany {
  id: string;
  name: string;
  domain: string | null;
  addedAt: string;
}

export interface StoredAnalysisRef {
  domain: string;
  name: string;
  researchedAt: string;
  mode: "basic" | "deep";
}

/** An earlier discovery decision (from a past mission result). Memory, not permanent truth. */
export interface PastDecision {
  domain: string;
  reason: RejectionReason;
  at: string;
}

export interface KnowledgeIndex {
  ownDomain: string | null;
  network: KnownCompany[];
  analyses: StoredAnalysisRef[];
  decisions: PastDecision[];
}

export interface SourcedCandidate {
  domain: string;
  name: string;
  website: string;
  source: CandidateSourceId;
  /** Up to two distinct hints from the source(s). */
  hints: string[];
  /** How many source results pointed to this company. */
  hits: number;
  network: { companyId: string; addedAt: string } | null;
  analysis: { researchedAt: string; mode: "basic" | "deep" } | null;
  /** Exact domain stored research is keyed by (may be a subdomain of `domain`). */
  researchDomain: string;
}

export interface StageOneRejection {
  name: string;
  domain: string;
  reason: Extract<RejectionReason, "duplicate" | "own_company" | "not_a_company_site" | "previously_rejected">;
  /** For previously_rejected: the earlier reason and date. */
  previous: { reason: RejectionReason; at: string } | null;
}

/** Second-level public suffixes under which the registrable name is one label deeper. */
const MULTI_PART_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.jp", "co.nz", "co.in", "com.br", "com.cn", "com.mx", "com.sg", "com.tr", "co.za", "com.hk", "co.kr", "com.tw"]);

/** acme.com for www.acme.com, shop.acme.com or acme.com; acme.co.uk for eu.acme.co.uk. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  const last2 = labels.slice(-2).join(".");
  return labels.slice(MULTI_PART_SUFFIXES.has(last2) && labels.length >= 3 ? -3 : -2).join(".");
}

/** Normalized company domain of a URL, or null when it is not a plausible public website. */
export function candidateDomain(url: string): string | null {
  const host = websiteDomain(url);
  return host ? registrableDomain(host) : null;
}

/**
 * Hosts that list or write about companies but are not the company itself.
 * Their pages are never treated as a candidate's identity.
 */
const NON_COMPANY = new Set([
  "linkedin.com",
  "wikipedia.org",
  "crunchbase.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "github.com",
  "medium.com",
  "reddit.com",
  "quora.com",
  "glassdoor.com",
  "indeed.com",
  "zoominfo.com",
  "g2.com",
  "capterra.com",
  "bloomberg.com",
  "reuters.com",
  "forbes.com",
  "techcrunch.com",
  "businesswire.com",
  "prnewswire.com",
  "globenewswire.com",
  "yahoo.com",
  "google.com",
  "bing.com",
  "amazon.com",
  "alibaba.com",
  "ebay.com",
  "pitchbook.com",
  "owler.com",
  "dnb.com",
  "kompass.com",
  "europages.com",
  "societe.com",
  "pappers.fr",
]);

export function isNonCompanyHost(domain: string): boolean {
  return NON_COMPANY.has(domain) || /\.(gov|edu|mil)$/.test(domain);
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|gmbh|sas|sa|sarl|ag|bv|plc|corp|corporation|company|co)\b\.?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A readable company name from a result title ("Acme | Rugged servers" → "Acme"), falling back to the domain. */
export function nameFromTitle(title: string | null, domain: string): string {
  const parts = (title ?? "")
    .replace(/<[^>]+>/g, "")
    .split(/\s[|–—-]\s|\s::\s|:\s/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 60 && !/^(home|accueil|welcome|bienvenue|official site|site officiel)$/i.test(p));
  const root = domain.split(".")[0];
  const byDomain = parts.find((p) => normalizeName(p).replace(/\s/g, "").includes(root.replace(/-/g, "")));
  return (byDomain ?? parts[0] ?? root).slice(0, 80);
}

const clip = (s: string | null) => (s ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 240) : null);

/**
 * Deduplicates and filters raw candidates. Identity is the registrable domain;
 * the same normalized name on the same root label (acme.com / acme.de) is the
 * same company too. Known companies keep their Network link and stored
 * analysis. Candidates ORQO already knows are verified first (cheapest).
 */
export function deduplicateCandidates(
  raw: readonly RawCandidate[],
  knowledge: KnowledgeIndex,
  opts: { reevaluate: boolean; now: number; max?: number },
): { candidates: SourcedCandidate[]; duplicates: number; rejected: StageOneRejection[] } {
  const byDomain = new Map<string, SourcedCandidate>();
  const byName = new Map<string, SourcedCandidate>();
  const rejected: StageOneRejection[] = [];
  const seenRejected = new Set<string>();
  let duplicates = 0;
  const own = knowledge.ownDomain ? registrableDomain(knowledge.ownDomain) : null;
  const memoryMs = DISCOVERY_LIMITS.rejectionMemoryDays * 86_400_000;

  for (const r of raw) {
    const domain = candidateDomain(r.url);
    if (!domain) continue;
    const name = nameFromTitle(r.name, domain);
    const reject = (reason: StageOneRejection["reason"], previous: StageOneRejection["previous"] = null) => {
      if (seenRejected.has(domain)) return;
      seenRejected.add(domain);
      rejected.push({ name, domain, reason, previous });
    };
    if (own && domain === own) {
      reject("own_company");
      continue;
    }
    if (isNonCompanyHost(domain)) {
      reject("not_a_company_site");
      continue;
    }
    const nameKey = `${normalizeName(name)}@${domain.split(".")[0]}`;
    const existing = byDomain.get(domain) ?? byName.get(nameKey);
    if (existing) {
      duplicates += 1;
      existing.hits += 1;
      const hint = clip(r.hint);
      if (hint && existing.hints.length < 2 && !existing.hints.includes(hint)) existing.hints.push(hint);
      continue;
    }
    const analysis = knowledge.analyses.find((a) => registrableDomain(a.domain) === domain) ?? null;
    const past = knowledge.decisions
      .filter((d) => d.domain === domain && opts.now - Date.parse(d.at) < memoryMs)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    // Circumstances change: an analysis refreshed after the rejection re-opens the company.
    if (past && !opts.reevaluate && !(analysis && Date.parse(analysis.researchedAt) > Date.parse(past.at))) {
      reject("previously_rejected", { reason: past.reason, at: past.at });
      continue;
    }
    const known = knowledge.network.find((c) => c.domain !== null && registrableDomain(c.domain) === domain) ?? null;
    const hint = clip(r.hint);
    const c: SourcedCandidate = {
      domain,
      name: known?.name ?? analysis?.name ?? name,
      website: `https://${domain}`,
      source: r.source,
      hints: hint ? [hint] : [],
      hits: 1,
      network: known ? { companyId: known.id, addedAt: known.addedAt } : null,
      analysis: analysis ? { researchedAt: analysis.researchedAt, mode: analysis.mode } : null,
      researchDomain: analysis?.domain ?? domain,
    };
    byDomain.set(domain, c);
    byName.set(nameKey, c);
  }

  const order = [...byDomain.values()];
  const ranked = order
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(b.c.analysis !== null) - Number(a.c.analysis !== null) || b.c.hits - a.c.hits || a.i - b.i)
    .map((x) => x.c);
  return { candidates: ranked.slice(0, opts.max ?? DISCOVERY_LIMITS.maxCandidates), duplicates, rejected };
}
