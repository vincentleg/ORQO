/**
 * Company research service: resolve → retrieve → structure → compare →
 * evaluate. Framework- and persistence-free (dependencies are injected), so it
 * is fully testable with fixtures. Authorization, quota and persistence are
 * done by the caller BEFORE this runs; this service enforces the per-run hard
 * limits through RunBudget and never retries.
 */
import { foldText } from "@/lib/intelligence/concepts";
import { extractTargetProfile, isParked, pageMatchesName, type RetrievedPage } from "@/lib/intelligence/extract";
import { parseHtml, type PageDocument } from "@/lib/intelligence/html";
import { buildExtractionMessages, buildReasoningMessages, ModelClaimsSchema, ModelHypothesesSchema, verifyModelClaims, type SourceText } from "@/lib/intelligence/model-io";
import { analyzeRelevance, type AnalysisStatus } from "@/lib/intelligence/relevance";
import { UNDERSTANDING_FIELDS, type ModelHypothesis, type OwnCompanyContext, type PageType, type ResearchSource, type TargetProfile } from "@/lib/intelligence/types";
import type { Locale } from "@/lib/i18n/config";
import { websiteDomain, type SearchTarget } from "@/lib/search/query";
import { RunBudget } from "./budget";
import { RESEARCH_LIMITS } from "./config";
import { ALLOW_ALL, FetchError, parseRobots, type PageFetcher, type RobotsRules } from "./fetcher";
import { ProviderCallError, type ModelProvider, type WebSearchProvider } from "./providers";
import { ResearchError, type ProviderUsage, type ResearchMode, type ResearchStage } from "./types";

export interface ResearchDeps {
  fetcher: PageFetcher;
  search: WebSearchProvider | null;
  model: ModelProvider | null;
  now?: () => Date;
  clock?: () => number;
  /** Called for every paid provider call, successful or not. */
  onUsage?: (usage: ProviderUsage) => Promise<void> | void;
}

export interface ResearchInput {
  target: SearchTarget;
  /** Website of the matching Network company, when known. */
  knownWebsite: string | null;
  mode: ResearchMode;
  own: OwnCompanyContext | null;
  locale: Locale;
}

export interface ResearchOutput {
  profile: TargetProfile;
  hypotheses: ModelHypothesis[];
  counters: Record<string, number>;
  warnings: string[];
  summary: { status: AnalysisStatus; opportunities: number; hypotheses: number; rejected: number };
}

/** Hosts that describe companies but are never the company's own site. */
const AGGREGATORS = /(^|\.)(wikipedia\.org|linkedin\.com|crunchbase\.com|facebook\.com|twitter\.com|x\.com|youtube\.com|instagram\.com|bloomberg\.com|zoominfo\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|pitchbook\.com|craft\.co|dnb\.com|societe\.com|pappers\.fr|github\.com|medium\.com|reddit\.com|amazon\.[a-z.]+)$/;
const LEGAL_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|ag|sa|sas|sarl|srl|bv|nv|group|groupe|holding|holdings)\b\.?/g;

export function nameSlug(name: string): string {
  return foldText(name).replace(LEGAL_SUFFIX, " ").replace(/[^a-z0-9]/g, "");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const PAGE_PATTERNS: [PageType, RegExp][] = [
  ["about", /\/(about|about-us|company|who-we-are|a-propos|qui-sommes-nous|societe|entreprise)(\/|$)/i],
  ["products", /\/(products?|solutions?|platforms?|produits?|offres?)(\/|$)/i],
  ["industries", /\/(industries|markets|sectors|use-cases|secteurs|marches)(\/|$)/i],
  ["customers", /\/(customers|clients|case-studies|success-stories|references|temoignages)(\/|$)/i],
  ["news", /\/(news|newsroom|press|press-releases|blog|actualites|presse)(\/|$)/i],
];

function pickSubpages(home: PageDocument, siteHost: string, max: number, robots: RobotsRules): { url: string; type: PageType }[] {
  const picked: { url: string; type: PageType }[] = [];
  for (const [type, re] of PAGE_PATTERNS) {
    if (picked.length >= max) break;
    const link = home.links.find((l) => {
      try {
        const u = new URL(l.href);
        return u.hostname.toLowerCase().replace(/^www\./, "") === siteHost && re.test(u.pathname) && robots.isAllowed(u.pathname) && u.pathname.split("/").filter(Boolean).length <= 2;
      } catch {
        return false;
      }
    });
    if (link) {
      const u = new URL(link.href);
      u.hash = "";
      u.search = "";
      if (!picked.some((p) => p.url === u.toString())) picked.push({ url: u.toString(), type });
    }
  }
  return picked;
}

function fetchFailure(e: unknown): ResearchError {
  if (e instanceof ResearchError) return e;
  if (e instanceof FetchError) {
    if (e.reason === "blocked_url") return new ResearchError("site_blocked", "This address cannot be fetched.");
    if (e.reason === "timeout") return new ResearchError("timeout", "The website did not respond in time.");
    return new ResearchError("site_unreachable", "The website could not be read.");
  }
  return new ResearchError("site_unreachable", "The website could not be read.");
}

export async function runCompanyResearch(deps: ResearchDeps, input: ResearchInput, onStage: (stage: ResearchStage) => Promise<void> | void = () => undefined): Promise<ResearchOutput> {
  const limits = RESEARCH_LIMITS[input.mode];
  const budget = new RunBudget(limits, deps.clock);
  const now = deps.now ?? (() => new Date());
  const warnings: string[] = [];
  const usage = async (u: ProviderUsage) => {
    await deps.onUsage?.(u);
  };
  if (input.mode === "deep" && !deps.model) throw new ResearchError("provider_unavailable", "Deep research needs a configured model provider.");

  // 1. Resolve the company to an official website.
  await onStage("resolving");
  const nameHint = input.target.kind === "name" ? input.target.name : null;
  let domain: string | null = input.target.kind === "website" ? input.target.domain : null;
  let method: TargetProfile["resolution"]["method"] = "url";
  let confidence: TargetProfile["resolution"]["confidence"] = "strong";
  if (!domain && input.knownWebsite) {
    domain = websiteDomain(input.knownWebsite);
    method = "network";
  }
  if (!domain && nameHint) {
    const slug = nameSlug(nameHint);
    if (input.mode === "deep" && deps.search && budget.remaining("searchQueries") > 0) {
      budget.spend("searchQueries");
      let hits;
      try {
        const r = await deps.search.search(`${nameHint} official website`, { count: 8, timeoutMs: Math.min(10_000, budget.timeLeft()) });
        await usage(r.usage);
        hits = r.hits;
      } catch (e) {
        if (e instanceof ProviderCallError) await usage(e.usage);
        throw new ResearchError("provider_failed", "Web search failed.");
      }
      const hosts = [...new Set(hits.map((h) => hostOf(h.url)).filter((h): h is string => Boolean(h && websiteDomain(h) && !AGGREGATORS.test(h))))];
      const matching = hosts.filter((h) => {
        const label = h.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
        return slug.length >= 2 && (label.includes(slug) || (label.length >= 3 && slug.includes(label)));
      });
      if (matching.length === 0) throw new ResearchError(hosts.length > 0 ? "ambiguous" : "not_resolved", "No official website matched this name.", hosts.slice(0, 3));
      domain = matching[0];
      method = "search";
      confidence = matching.length === 1 ? "strong" : "moderate";
    } else if (slug.length >= 2 && slug.length <= 40) {
      domain = `${slug}.com`;
      method = "inferred_domain";
      confidence = "limited";
    }
  }
  if (!domain) throw new ResearchError("not_resolved", "Enter the company's website to analyze it.");
  const origin = `https://${domain}`;

  // 2. Find authoritative sources: robots.txt, then the official homepage.
  await onStage("sources");
  let robots: RobotsRules = ALLOW_ALL;
  budget.spend("robots");
  try {
    const r = await deps.fetcher.fetchPage(`${origin}/robots.txt`, { accept: "text", timeoutMs: Math.min(5_000, budget.timeLeft()) });
    budget.addBytes(r.bytes);
    robots = parseRobots(r.body);
  } catch (e) {
    if (e instanceof FetchError && (e.reason === "blocked_url" || e.reason === "unreachable" || e.reason === "timeout")) {
      if (method === "inferred_domain") throw new ResearchError("not_resolved", "No website found for this name. Enter the company's website.");
      throw fetchFailure(e);
    }
    // No robots.txt (404, HTML…) means no restriction.
  }
  if (!robots.isAllowed("/")) throw new ResearchError("robots_disallowed", "The website does not allow automated reading.");

  const retrievedAt = () => now().toISOString();
  const pages: RetrievedPage[] = [];
  budget.spend("officialPages");
  let home;
  try {
    home = await deps.fetcher.fetchPage(`${origin}/`, { timeoutMs: budget.timeLeft() });
  } catch (e) {
    if (method === "inferred_domain") throw new ResearchError("not_resolved", "No website found for this name. Enter the company's website.");
    throw fetchFailure(e);
  }
  budget.addBytes(home.bytes);
  const homeDoc = parseHtml(home.body, home.url, { maxTextChars: limits.maxTextCharsPerPage, maxLinks: 300 });
  if (isParked(homeDoc)) throw new ResearchError(method === "inferred_domain" ? "not_resolved" : "no_evidence", "This domain does not host a company website.");
  if (method === "inferred_domain" && nameHint && !pageMatchesName(homeDoc, nameHint)) throw new ResearchError("not_resolved", "The guessed website does not match this company. Enter its website.");
  if (method === "search" && nameHint && pageMatchesName(homeDoc, nameHint) && confidence === "moderate") confidence = "strong";
  const siteHost = hostOf(home.url) ?? domain;
  pages.push({ doc: homeDoc, source: { key: "s0", url: home.url, title: homeDoc.title || domain, authority: "official", pageType: "home", retrievedAt: retrievedAt() } });

  // 3. Read a few official pages (bounded), then third-party pages for deep research.
  await onStage("reading");
  for (const sub of pickSubpages(homeDoc, siteHost, budget.remaining("officialPages"), robots)) {
    if (budget.remaining("officialPages") <= 0) break;
    budget.spend("officialPages");
    try {
      const page = await deps.fetcher.fetchPage(sub.url, { timeoutMs: budget.timeLeft() });
      budget.addBytes(page.bytes);
      if (hostOf(page.url) !== siteHost) continue; // redirected off-site: not official evidence
      const doc = parseHtml(page.body, page.url, { maxTextChars: limits.maxTextCharsPerPage, maxLinks: 200 });
      pages.push({ doc, source: { key: `s${pages.length}`, url: page.url, title: doc.title || sub.url, authority: "official", pageType: sub.type, retrievedAt: retrievedAt() } });
    } catch (e) {
      if (e instanceof ResearchError) throw e;
      // A missing sub-page is not fatal; the homepage is the primary source.
    }
  }
  const displayName = nameHint ?? homeDoc.meta["og:site_name"] ?? domain;
  if (input.mode === "deep" && deps.search && budget.remaining("searchQueries") > 0 && limits.maxThirdPartyPages > 0) {
    budget.spend("searchQueries");
    try {
      const r = await deps.search.search(`"${displayName}" announces OR partnership OR customers`, { count: 8, timeoutMs: Math.min(10_000, budget.timeLeft()) });
      await usage(r.usage);
      const external = r.hits.filter((h) => {
        const host = hostOf(h.url);
        return host && host !== siteHost && !host.endsWith(`.${siteHost}`) && !AGGREGATORS.test(host);
      });
      for (const hit of external) {
        if (budget.remaining("thirdPartyPages") <= 0) break;
        budget.spend("thirdPartyPages");
        try {
          const page = await deps.fetcher.fetchPage(hit.url, { timeoutMs: budget.timeLeft() });
          budget.addBytes(page.bytes);
          const doc = parseHtml(page.body, page.url, { maxTextChars: limits.maxTextCharsPerPage, maxLinks: 50 });
          pages.push({ doc, source: { key: `s${pages.length}`, url: page.url, title: doc.title || hit.title, authority: "third_party", pageType: "news", retrievedAt: retrievedAt() } });
        } catch (e) {
          if (e instanceof ResearchError) throw e;
        }
      }
    } catch (e) {
      if (e instanceof ResearchError) throw e;
      if (e instanceof ProviderCallError) await usage(e.usage);
      warnings.push("third_party_search_failed");
    }
  }

  // 4. Structure: deterministic extraction, plus verified model extraction in deep mode.
  await onStage("structuring");
  let profile = extractTargetProfile({ nameHint, domain, website: origin, resolution: { method, confidence }, pages, now: now() });
  if (input.mode === "deep" && deps.model && budget.remaining("modelCalls") > 0) {
    budget.spend("modelCalls");
    const texts: SourceText[] = pages.map((p) => ({ key: p.source.key, url: p.source.url, text: [p.doc.meta.description ?? "", ...p.doc.headings, p.doc.text].join(". ") }));
    try {
      const r = await deps.model.complete({ task: "extraction", name: "orqo_company_claims", schema: ModelClaimsSchema, messages: buildExtractionMessages(profile.name, texts, limits.maxModelCharsPerSource), maxTokens: limits.maxModelOutputTokens, timeoutMs: Math.min(limits.modelTimeoutMs, budget.timeLeft()) });
      await usage(r.usage);
      const verified = verifyModelClaims(r.data, texts, 0);
      const claims = [...profile.claims, ...verified].slice(0, 120);
      const covered = new Set(claims.map((c) => c.field));
      profile = { ...profile, claims, unknowns: UNDERSTANDING_FIELDS.filter((f) => !covered.has(f)) };
    } catch (e) {
      if (e instanceof ProviderCallError) await usage(e.usage);
      warnings.push("model_extraction_failed");
    }
  }
  if (profile.claims.filter((c) => c.field !== "identity").length === 0) throw new ResearchError("no_evidence", "The website did not provide usable company information.");

  // 5. Compare with the own company (model hypotheses only in deep mode, with a usable own profile).
  await onStage("comparing");
  let hypotheses: ModelHypothesis[] = [];
  const ownUsable = input.own && (input.own.offerings.length > 0 || input.own.summary);
  if (input.mode === "deep" && deps.model && input.own && ownUsable && budget.remaining("modelCalls") > 0) {
    budget.spend("modelCalls");
    try {
      const r = await deps.model.complete({ task: "reasoning", name: "orqo_relevance_hypotheses", schema: ModelHypothesesSchema, messages: buildReasoningMessages(input.own, profile, input.locale), maxTokens: limits.maxModelOutputTokens, timeoutMs: Math.min(limits.modelTimeoutMs, budget.timeLeft()) });
      await usage(r.usage);
      hypotheses = r.data.hypotheses.slice(0, 5);
    } catch (e) {
      if (e instanceof ProviderCallError) await usage(e.usage);
      warnings.push("model_reasoning_failed");
    }
  }

  // 6. Evaluate with the deterministic critic.
  await onStage("evaluating");
  budget.assertTime();
  let summary: ResearchOutput["summary"];
  try {
    const a = analyzeRelevance(input.own, profile, hypotheses);
    summary = { status: a.status, opportunities: a.opportunities.length, hypotheses: a.hypotheses.length, rejected: a.rejected.length };
  } catch {
    throw new ResearchError("analysis_failed", "The analysis could not be completed.");
  }
  return { profile, hypotheses, counters: { ...budget.counters }, warnings, summary };
}

export type { ResearchSource };
