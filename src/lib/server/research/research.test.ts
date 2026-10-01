import { describe, expect, test } from "bun:test";
import { FIXTURE_ABOUT, FIXTURE_HOME, FIXTURE_PARKED, OWN_HARDWARE_INTEGRATOR } from "@/lib/intelligence/fixtures";
import type { ModelClaims, ModelHypotheses } from "@/lib/intelligence/model-io";
import { RunBudget } from "./budget";
import { RESEARCH_LIMITS } from "./config";
import { createPageFetcher, FetchError, parseRobots, type FetchImpl, type PageFetcher } from "./fetcher";
import { braveSearchProvider, ProviderCallError, type ModelProvider, type WebSearchProvider } from "./providers";
import { nameSlug, runCompanyResearch, type ResearchDeps } from "./service";
import { ResearchError, type ProviderUsage, type ResearchStage } from "./types";
import { assertSafeUrl, assertSafeUrlShape, isPublicAddress, type Resolver } from "./url-safety";

const publicDns: Resolver = async () => ["93.184.216.34"];

describe("SSRF protection", () => {
  test("rejects non-http schemes, credentials, ports, IP literals and internal names", () => {
    for (const bad of [
      "file:///etc/passwd",
      "ftp://example.com",
      "gopher://example.com",
      "javascript:alert(1)",
      "http://user:pw@example.com/",
      "http://example.com:8080/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "http://localhost/",
      "http://metadata.google.internal/",
      "http://printer.local/",
      "http://intranet/",
    ]) {
      expect(() => assertSafeUrlShape(bad)).toThrow();
    }
    expect(assertSafeUrlShape("https://www.example.com/about").hostname).toBe("www.example.com");
  });

  test("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1"]) expect(isPublicAddress(ip)).toBe(false);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip)).toBe(true);
  });

  test("a public-looking name that resolves to a private address is refused (DNS check)", async () => {
    await expect(assertSafeUrl("https://evil.example.com/", async () => ["10.0.0.5"])).rejects.toThrow("non-public");
    await expect(assertSafeUrl("https://evil.example.com/", async () => ["93.184.216.34", "127.0.0.1"])).rejects.toThrow("non-public");
    await expect(assertSafeUrl("https://ok.example.com/", publicDns)).resolves.toBeTruthy();
  });
});

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

describe("page fetcher", () => {
  const limits = { maxRedirects: 2, maxBytesPerPage: 1000, fetchTimeoutMs: 2000 };

  test("re-validates every redirect hop and refuses redirects to internal hosts", async () => {
    const fetchImpl: FetchImpl = async (url) => (url.startsWith("https://site.example.com") ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } }) : html("secret"));
    const f = createPageFetcher({ limits, fetchImpl, resolve: publicDns });
    await expect(f.fetchPage("https://site.example.com/")).rejects.toMatchObject({ reason: "blocked_url" });
  });

  test("redirect chains are bounded", async () => {
    let n = 0;
    const fetchImpl: FetchImpl = async () => new Response(null, { status: 301, headers: { location: `https://site.example.com/${++n}` } });
    const f = createPageFetcher({ limits, fetchImpl, resolve: publicDns });
    await expect(f.fetchPage("https://site.example.com/")).rejects.toMatchObject({ reason: "too_many_redirects" });
    expect(n).toBe(3);
  });

  test("content type, size and credentials", async () => {
    let init: RequestInit | undefined;
    const big = createPageFetcher({ limits, fetchImpl: async (_u, i) => ((init = i), html("x".repeat(5000))), resolve: publicDns });
    const page = await big.fetchPage("https://site.example.com/");
    expect(page.truncated).toBe(true);
    expect(page.body.length).toBe(1000);
    expect(init?.redirect).toBe("manual");
    expect(init?.credentials).toBe("omit");
    const pdf = createPageFetcher({ limits, fetchImpl: async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }), resolve: publicDns });
    await expect(pdf.fetchPage("https://site.example.com/")).rejects.toMatchObject({ reason: "not_html" });
  });

  test("timeouts fail closed", async () => {
    const slow = createPageFetcher({
      limits: { ...limits, fetchTimeoutMs: 30 },
      fetchImpl: (_u, i) => new Promise((_, reject) => i.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })))),
      resolve: publicDns,
    });
    await expect(slow.fetchPage("https://site.example.com/")).rejects.toMatchObject({ reason: "timeout" });
  });

  test("robots.txt", () => {
    const r = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: badbot\nDisallow: /");
    expect(r.isAllowed("/")).toBe(true);
    expect(r.isAllowed("/private/x")).toBe(false);
    expect(r.isAllowed("/private/public/x")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow: /").isAllowed("/")).toBe(false);
    expect(parseRobots("User-agent: orqo-research\nDisallow: /\n\nUser-agent: *\nAllow: /").isAllowed("/about")).toBe(false);
    expect(parseRobots("").isAllowed("/x")).toBe(true);
  });
});

describe("run budget", () => {
  test("limits and deadline are hard", () => {
    let t = 0;
    const b = new RunBudget({ ...RESEARCH_LIMITS.basic, runTimeoutMs: 100 }, () => t);
    for (let i = 0; i < RESEARCH_LIMITS.basic.maxOfficialPages; i++) b.spend("officialPages");
    expect(() => b.spend("officialPages")).toThrow(ResearchError);
    expect(() => b.spend("modelCalls")).toThrow(/modelCalls/); // basic: zero model calls
    expect(() => b.spend("searchQueries")).toThrow(/searchQueries/); // basic: zero paid searches
    t = 101;
    expect(() => b.spend("robots")).toThrow(/timed out/);
  });
});

// --- Research service with fixtures ------------------------------------------------

/** A fake site: 100 product links on the homepage, to prove the crawl stays bounded. */
function fakeSite(pages: Record<string, string>, calls: string[] = []): PageFetcher {
  return {
    async fetchPage(url, opts) {
      calls.push(url);
      if (url.endsWith("/robots.txt")) {
        if (pages["robots"]) return { url, status: 200, contentType: "text/plain", body: pages["robots"], bytes: 10, truncated: false };
        throw new FetchError("http_status", "HTTP 404");
      }
      const path = new URL(url).pathname;
      const body = pages[path];
      if (body === undefined) throw new FetchError("http_status", "HTTP 404");
      void opts;
      return { url, status: 200, contentType: "text/html", body, bytes: body.length, truncated: false };
    },
  };
}

const manyLinks = FIXTURE_HOME.replace("</nav>", `${Array.from({ length: 100 }, (_, i) => `<a href="/products/p${i}">Product ${i}</a><a href="/news/${i}">News ${i}</a>`).join("")}</nav>`);
const SITE = { "/": manyLinks, "/about": FIXTURE_ABOUT, "/news": "<html><body><h1>News</h1></body></html>" };
const paidMustNotBeCalled: WebSearchProvider & ModelProvider = {
  id: "forbidden",
  async search() {
    throw new Error("paid search called");
  },
  async complete() {
    throw new Error("paid model called");
  },
};

const base = (deps: Partial<ResearchDeps>): ResearchDeps => ({ fetcher: fakeSite(SITE), search: null, model: null, now: () => new Date("2026-09-30T12:00:00Z"), ...deps });

describe("research service", () => {
  test("basic mode: official site only, bounded, real stages, no paid provider", async () => {
    const calls: string[] = [];
    const stages: ResearchStage[] = [];
    const usage: ProviderUsage[] = [];
    // Even if providers were wired in, basic mode never calls them.
    const out = await runCompanyResearch(
      { ...base({ fetcher: fakeSite(SITE, calls), search: paidMustNotBeCalled, model: null }), onUsage: (u) => void usage.push(u) },
      { target: { kind: "website", domain: "nimbusfabric.example", url: "https://nimbusfabric.example" }, knownWebsite: null, mode: "basic", own: OWN_HARDWARE_INTEGRATOR, locale: "en" },
      (s) => void stages.push(s),
    );
    expect(stages).toEqual(["resolving", "sources", "reading", "structuring", "comparing", "evaluating"]);
    expect(usage).toEqual([]);
    const pageCalls = calls.filter((u) => !u.endsWith("robots.txt"));
    expect(pageCalls.length).toBeLessThanOrEqual(RESEARCH_LIMITS.basic.maxOfficialPages);
    expect(out.counters.officialPages).toBeLessThanOrEqual(RESEARCH_LIMITS.basic.maxOfficialPages);
    expect(out.counters.modelCalls).toBe(0);
    expect(out.counters.searchQueries).toBe(0);
    expect(out.profile.name).toBe("NimbusFabric");
    expect(out.profile.sources.every((s) => s.authority === "official")).toBe(true);
    expect(out.summary.status).toBe("opportunities");
  });

  test("name input: inferred domain must be verified against the homepage", async () => {
    const ok = await runCompanyResearch(base({ fetcher: fakeSite({ "/": FIXTURE_HOME }) }), { target: { kind: "name", name: "NimbusFabric" }, knownWebsite: null, mode: "basic", own: null, locale: "en" });
    expect(ok.profile.resolution).toEqual({ method: "inferred_domain", confidence: "limited" });
    expect(ok.profile.domain).toBe("nimbusfabric.com");
    expect(ok.summary.status).toBe("own_profile_missing");

    const wrong = runCompanyResearch(base({ fetcher: fakeSite({ "/": FIXTURE_HOME }) }), { target: { kind: "name", name: "Totally Other Corp" }, knownWebsite: null, mode: "basic", own: null, locale: "en" });
    await expect(wrong).rejects.toMatchObject({ code: "not_resolved" });
    const parked = runCompanyResearch(base({ fetcher: fakeSite({ "/": FIXTURE_PARKED }) }), { target: { kind: "name", name: "Nimbus" }, knownWebsite: null, mode: "basic", own: null, locale: "en" });
    await expect(parked).rejects.toMatchObject({ code: "not_resolved" });
  });

  test("a known Network website is used instead of guessing", async () => {
    const calls: string[] = [];
    const out = await runCompanyResearch(base({ fetcher: fakeSite(SITE, calls) }), { target: { kind: "name", name: "Nimbus" }, knownWebsite: "https://www.nimbusfabric.example/", mode: "basic", own: null, locale: "en" });
    expect(out.profile.resolution.method).toBe("network");
    expect(calls[0]).toBe("https://nimbusfabric.example/robots.txt");
  });

  test("failure states are explicit", async () => {
    const run = (pages: Record<string, string>) => runCompanyResearch(base({ fetcher: fakeSite(pages) }), { target: { kind: "website", domain: "x.example", url: "https://x.example" }, knownWebsite: null, mode: "basic", own: null, locale: "en" });
    await expect(run({ robots: "User-agent: *\nDisallow: /", "/": FIXTURE_HOME })).rejects.toMatchObject({ code: "robots_disallowed" });
    await expect(run({})).rejects.toMatchObject({ code: "site_unreachable" });
    await expect(run({ "/": "<html><body><p>hi</p></body></html>" })).rejects.toMatchObject({ code: "no_evidence" });
    const blocked: PageFetcher = { fetchPage: async () => Promise.reject(new FetchError("blocked_url", "no")) };
    await expect(runCompanyResearch(base({ fetcher: blocked }), { target: { kind: "website", domain: "x.example", url: "https://x.example" }, knownWebsite: null, mode: "basic", own: null, locale: "en" })).rejects.toMatchObject({ code: "site_blocked" });
    const slow: PageFetcher = { fetchPage: async () => Promise.reject(new FetchError("timeout", "slow")) };
    await expect(runCompanyResearch(base({ fetcher: slow }), { target: { kind: "website", domain: "x.example", url: "https://x.example" }, knownWebsite: null, mode: "basic", own: null, locale: "en" })).rejects.toMatchObject({ code: "timeout" });
  });

  test("deep mode refuses to run without a model provider (no silent fallback)", async () => {
    await expect(runCompanyResearch(base({}), { target: { kind: "website", domain: "x.example", url: "https://x.example" }, knownWebsite: null, mode: "deep", own: null, locale: "en" })).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  test("deep mode: bounded paid calls, usage recorded, model output verified", async () => {
    const usage: ProviderUsage[] = [];
    let searches = 0;
    let modelCalls = 0;
    const search: WebSearchProvider = {
      id: "fake-search",
      async search(q) {
        searches++;
        const hits = q.includes("official website")
          ? [{ title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Nimbus", snippet: "…" }, { title: "NimbusFabric", url: "https://www.nimbusfabric.example/", snippet: "Composable" }]
          : [{ title: "Press", url: "https://press.example/nimbus", snippet: "partnership" }, { title: "Self", url: "https://nimbusfabric.example/news", snippet: "" }];
        return { hits, usage: { provider: "fake-search", service: "web", operation: "web_search", succeeded: true, units: { queries: 1, results: hits.length }, costUsd: null } };
      },
    };
    const model: ModelProvider = {
      id: "fake-model",
      async complete({ task }) {
        modelCalls++;
        const data: ModelClaims | ModelHypotheses =
          task === "extraction"
            ? {
                claims: [
                  { field: "customer", statement: "Serves cloud service providers", sourceKey: "s0", quote: "cloud service providers across North America", epistemic: "fact" },
                  { field: "customer", statement: "Invented Pentagon contract", sourceKey: "s0", quote: "signed a Pentagon contract", epistemic: "fact" },
                ],
              }
            : { hypotheses: [{ relationship: "strategic", title: "Strategic synergies", mechanism: "Both companies use AI, so they could collaborate to create synergies.", ownBrings: "AI", targetBrings: "AI", targetClaimIds: ["c1"], ownFields: ["summary"], whyNowClaimIds: [], assumptions: [], questions: [], nextStep: "Talk" }] };
        return { data: data as never, usage: { provider: "fake-model", service: "m", operation: task, succeeded: true, units: { promptTokens: 100, completionTokens: 50 }, costUsd: 0.001 } };
      },
    };
    const pages = { ...SITE, "/nimbus": "<html><body><p>Press: NimbusFabric announced a partnership with a European defense integrator in 2026.</p></body></html>" };
    const fetcher: PageFetcher = {
      fetchPage: async (url, o) => (url.startsWith("https://press.example") ? { url, status: 200, contentType: "text/html", body: pages["/nimbus"], bytes: 100, truncated: false } : fakeSite(pages).fetchPage(url, o)),
    };
    const out = await runCompanyResearch(
      { ...base({ fetcher, search, model }), onUsage: (u) => void usage.push(u) },
      { target: { kind: "name", name: "NimbusFabric" }, knownWebsite: null, mode: "deep", own: OWN_HARDWARE_INTEGRATOR, locale: "fr" },
    );
    expect(out.profile.resolution).toMatchObject({ method: "search" });
    expect(out.profile.domain).toBe("nimbusfabric.example");
    expect(searches).toBeLessThanOrEqual(RESEARCH_LIMITS.deep.maxSearchQueries);
    expect(modelCalls).toBeLessThanOrEqual(RESEARCH_LIMITS.deep.maxModelCalls);
    expect(usage.length).toBe(searches + modelCalls);
    expect(usage.find((u) => u.provider === "fake-model")?.costUsd).toBe(0.001);
    // Only the quote that exists in the source survives.
    const modelClaims = out.profile.claims.filter((c) => c.method === "model_extraction");
    expect(modelClaims.map((c) => c.statement)).toEqual(["Serves cloud service providers"]);
    expect(out.profile.sources.some((s) => s.authority === "third_party")).toBe(true);
    // The generic model idea is stored as a hypothesis but can never pass the critic.
    expect(out.hypotheses).toHaveLength(1);
    expect(out.summary.rejected).toBeGreaterThanOrEqual(1);
  });

  test("ambiguous names surface candidates instead of guessing (deep)", async () => {
    const search: WebSearchProvider = {
      id: "s",
      search: async () => ({ hits: [{ title: "A", url: "https://alpha.example/", snippet: "x" }, { title: "B", url: "https://beta.example/", snippet: "y" }], usage: { provider: "s", service: "w", operation: "web_search", succeeded: true, units: {}, costUsd: null } }),
    };
    const model = paidMustNotBeCalled;
    await expect(runCompanyResearch(base({ search, model }), { target: { kind: "name", name: "Delta" }, knownWebsite: null, mode: "deep", own: null, locale: "en" })).rejects.toMatchObject({ code: "ambiguous", candidates: ["alpha.example", "beta.example"] });
  });

  test("slug normalization", () => {
    expect(nameSlug("Acme Robotics, Inc.")).toBe("acmerobotics");
    expect(nameSlug("Société Générale SA")).toBe("societegenerale");
  });
});

describe("providers", () => {
  test("brave adapter normalizes results and reports usage; failures still report usage", async () => {
    const ok = braveSearchProvider("k", (async () => Response.json({ web: { results: [{ title: "<b>A</b>", url: "https://a.example", description: "d<i>x</i>" }, { title: "bad", url: "javascript:x", description: "y" }] } })) as unknown as typeof fetch);
    const r = await ok.search("q", { count: 5, timeoutMs: 1000 });
    expect(r.hits).toEqual([{ title: "A", url: "https://a.example", snippet: "dx" }]);
    expect(r.usage).toMatchObject({ provider: "brave", succeeded: true, units: { queries: 1, results: 1 }, costUsd: null });
    const failing = braveSearchProvider("k", (async () => new Response("no", { status: 429 })) as unknown as typeof fetch);
    const err = await failing.search("q", { count: 5, timeoutMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderCallError);
    expect((err as ProviderCallError).usage.succeeded).toBe(false);
  });
});
