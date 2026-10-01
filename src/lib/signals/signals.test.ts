/**
 * Phase 7 — Intelligence & signals: the pure, deterministic core. Fictional
 * companies only (no real workspace, prospect or person).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { TOOLS } from "@/lib/agents/tools";
import { featureAccess } from "@/lib/entitlements/plans";
import { extractTargetProfile, type RetrievedPage } from "@/lib/intelligence/extract";
import { parseHtml } from "@/lib/intelligence/html";
import type { OwnCompanyContext, TargetProfile } from "@/lib/intelligence/types";
import { nextBestAction, type FollowUpView, type InteractionView } from "@/lib/network/model";
import { signalReasoningDecision } from "./access";
import { canTransition, classifyChange, dedupKey, detectDelta, evidenceQuality, factGist, normalizeSourceUrl, type SignalView } from "./model";
import { assessSignal, needsAttention, privateContextMatches, reevaluate, signalUnknowns, type RelationshipMemory } from "./relevance";

// ---------------------------------------------------------------------------
// Fictional fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-30T10:00:00Z");
const DOMAIN = "borealis-robotics.example";

function page(key: string, path: string, type: RetrievedPage["source"]["pageType"], html: string, retrievedAt = NOW.toISOString()): RetrievedPage {
  const url = `https://${DOMAIN}${path}`;
  return { doc: parseHtml(html, url, { maxTextChars: 20_000, maxLinks: 200 }), source: { key, url, title: `${type} | Borealis`, authority: "official", pageType: type, retrievedAt } };
}

const HOME_V1 = `<html lang="en"><head><title>Borealis Robotics</title><meta name="description" content="Borealis Robotics designs autonomous mobile robots for warehouses in North America."></head><body>
<nav><a href="/products/rover-one">Rover One</a><a href="/news">News</a></nav>
<h1>Autonomous mobile robots for warehouses</h1>
<p>Borealis Robotics serves logistics operators across North America with fleets of warehouse robots.</p>
</body></html>`;

const HOME_V2 = `<html lang="en"><head><title>Borealis Robotics</title><meta name="description" content="Borealis Robotics designs autonomous mobile robots for warehouses in North America."></head><body>
<nav><a href="/products/rover-one">Rover One</a><a href="/products/rover-heavy">Rover Heavy</a><a href="/news">News</a></nav>
<h1>Autonomous mobile robots for warehouses</h1>
<p>Borealis Robotics serves logistics operators across North America with fleets of warehouse robots.</p>
</body></html>`;

const NEWS_V2 = `<html><head><title>News | Borealis</title></head><body>
<h1>News</h1>
<p>Borealis Robotics announces its expansion into Europe with a new office in Rotterdam to serve European logistics customers.</p>
</body></html>`;

function analyze(pages: RetrievedPage[]): TargetProfile {
  return extractTargetProfile({ nameHint: "Borealis Robotics", domain: DOMAIN, website: `https://${DOMAIN}`, resolution: { method: "url", confidence: "strong" }, pages, now: NOW });
}

const BEFORE = analyze([page("s0", "/", "home", HOME_V1, "2026-03-01T09:00:00.000Z")]);
const AFTER = analyze([page("s0", "/", "home", HOME_V2), page("s1", "/news", "news", NEWS_V2)]);
const PREVIOUS = { profile: BEFORE, researchedAt: "2026-03-01T09:00:00.000Z", mode: "basic" as const };

const OWN: OwnCompanyContext = {
  name: "Atelier Fictif Integration",
  website: "https://atelier-fictif.example",
  summary: "Hardware assembly, configuration and system integration for robotics and industrial equipment makers.",
  offerings: ["Hardware assembly", "System integration", "Testing and validation", "Logistics services"],
  customerSegments: ["OEMs", "Robotics companies"],
  markets: ["Industrial", "Logistics"],
  geographies: ["Europe", "France"],
  soughtCapabilities: [],
  partnershipGoals: ["oem", "market_entry"],
};

let seq = 0;
function signal(over: Partial<SignalView> = {}): SignalView {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    companyId: "00000000-0000-4000-8000-00000000c0b0",
    kind: "geographic_expansion",
    origin: "research",
    headline: "Borealis Robotics announces its expansion into Europe with a new office in Rotterdam.",
    detail: "",
    excerpt: "Borealis Robotics announces its expansion into Europe with a new office in Rotterdam.",
    field: "strategy",
    concepts: ["europe"],
    epistemic: "fact",
    evidenceQuality: "strong",
    sourceUrl: `https://${DOMAIN}/news`,
    sourceLabel: "News | Borealis",
    sourceAuthority: "official",
    publishedOn: null,
    retrievedAt: NOW.toISOString(),
    previousResearchedAt: "2026-03-01T09:00:00.000Z",
    previousConcepts: ["north_america"],
    status: "new",
    statusChangedAt: null,
    followUpId: null,
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    ...over,
  };
}

function interaction(over: Partial<InteractionView> = {}): InteractionView {
  return { id: "00000000-0000-4000-8000-0000000000a1", companyId: "00000000-0000-4000-8000-00000000c0b0", contactId: null, kind: "meeting", occurredAt: "2026-02-10T14:00:00.000Z", title: "Intro meeting at trade fair", summary: "", outcome: "", nextStep: "", createdAt: "2026-02-10T15:00:00.000Z", ...over };
}

function followUp(over: Partial<FollowUpView> = {}): FollowUpView {
  return { id: "00000000-0000-4000-8000-0000000000f1", companyId: "00000000-0000-4000-8000-00000000c0b0", contactId: null, interactionId: null, title: "Check in again in 2027", description: "", dueOn: "2027-03-01", status: "open", priority: "normal", origin: "manual", assignedTo: null, closedAt: null, createdAt: "2026-02-10T15:00:00.000Z", ...over };
}

/** Company B scenario: met once, domestic focus; the team privately noted that expansion timing matters. */
const MEMORY_B: RelationshipMemory = {
  stage: "conversation",
  reason: "",
  interactions: [interaction({ summary: "Mostly domestic today. They might consider international expansion in 1–2 years; that would make a local integration partner relevant." })],
  followUps: [followUp()],
};

// ---------------------------------------------------------------------------

describe("classification", () => {
  test("business changes are classified generically (EN and FR); plain descriptions are not changes", () => {
    expect(classifyChange("Northwind Labs raises $20M Series B")).toBe("funding");
    expect(classifyChange("Northwind Labs annonce une levée de fonds de 5 M€")).toBe("funding");
    expect(classifyChange("We are opening a new office in Lyon")).toBe("geographic_expansion");
    expect(classifyChange("Northwind s'implante en Allemagne")).toBe("geographic_expansion");
    expect(classifyChange("Northwind enters partnership with a fictional cloud vendor: partnership with Example Cloud")).toBe("partnership");
    expect(classifyChange("Northwind acquires Example Sensors")).toBe("acquisition");
    expect(classifyChange("The X200 moves to volume production at a new plant")).toBe("manufacturing");
    expect(classifyChange("Northwind unveils its new appliance")).toBe("product_launch");
    expect(classifyChange("Northwind achieves ISO 27001 certification")).toBe("certification");
    expect(classifyChange("Northwind builds robots for warehouses")).toBeNull();
  });
});

describe("delta detection (what is new relative to ORQO's previous analysis)", () => {
  const candidates = detectDelta({ previous: PREVIOUS, next: AFTER });

  test("a first analysis is a baseline: no signals", () => {
    expect(detectDelta({ previous: null, next: AFTER })).toEqual([]);
  });

  test("an unchanged site produces no signals", () => {
    expect(detectDelta({ previous: PREVIOUS, next: BEFORE })).toEqual([]);
  });

  test("a newly published expansion is a FACT signal citing its official source, with no invented date", () => {
    const expansion = candidates.find((c) => c.kind === "geographic_expansion" && c.epistemic === "fact");
    expect(expansion).toBeDefined();
    expect(expansion?.headline).toContain("expansion into Europe");
    expect(expansion?.sourceUrl).toBe(`https://${DOMAIN}/news`);
    expect(expansion?.sourceAuthority).toBe("official");
    expect(expansion?.evidenceQuality).toBe("strong");
    expect(expansion?.publishedOn).toBeNull();
    expect(expansion?.retrievedAt).toBe(NOW.toISOString());
    expect(expansion?.previousResearchedAt).toBe(PREVIOUS.researchedAt);
  });

  test("a product newly listed on the official site is an offering change", () => {
    expect(candidates.some((c) => c.kind === "offering_change" && c.headline === "Rover Heavy")).toBe(true);
    expect(candidates.some((c) => c.headline === "Rover One")).toBe(false);
  });

  test("a new concept mention is only an INFERENCE with limited evidence", () => {
    for (const c of candidates.filter((x) => x.epistemic === "inference")) expect(c.evidenceQuality).toBe("limited");
  });

  test("deep → basic or basic → deep differences in model-extracted claims are not treated as changes", () => {
    const modelClaim = { ...AFTER.claims[0], id: "m1", field: "strategy" as const, statement: "Raises $10M Series A", excerpt: "Raises $10M Series A", method: "model_extraction" as const, epistemic: "fact" as const, sourceKey: "s1" };
    const next = { ...AFTER, claims: [...AFTER.claims, modelClaim] };
    expect(detectDelta({ previous: PREVIOUS, next }).some((c) => c.kind === "funding")).toBe(false);
    expect(detectDelta({ previous: { ...PREVIOUS, mode: "deep" }, next }).some((c) => c.kind === "funding")).toBe(true);
  });

  test("search snippets are never a signal's evidence", () => {
    const next = { ...AFTER, sources: AFTER.sources.map((s) => ({ ...s, authority: "search_result" as const })) };
    expect(detectDelta({ previous: PREVIOUS, next })).toEqual([]);
  });

  test("another domain is never compared", () => {
    expect(detectDelta({ previous: { ...PREVIOUS, profile: { ...BEFORE, domain: "other.example" } }, next: AFTER })).toEqual([]);
  });
});

describe("deduplication", () => {
  test("same change reworded with a date, or read on another page, has one key; different changes differ", () => {
    expect(factGist("Borealis announces expansion into Europe — March 2026")).toBe(factGist("Borealis announces expansion into Europe (12 March 2026)"));
    const a = dedupKey("geographic_expansion", { field: "strategy", fact: factGist("Borealis announces expansion into Europe — March 2026") });
    const b = dedupKey("geographic_expansion", { field: "strategy", fact: factGist("Borealis announces expansion into Europe (12 March 2026)") });
    expect(a).toBe(b);
    expect(dedupKey("funding", { field: "strategy", fact: factGist("Borealis announces expansion into Europe") })).not.toBe(a);
    expect(a).toMatch(/^[a-z_]{1,40}:[a-z_]{1,40}:[0-9a-f]{8,16}$/);
  });

  test("manual signals deduplicate on the normalized source URL, not on the title", () => {
    expect(normalizeSourceUrl("https://WWW.News.example/a/b/?utm_source=x&id=3#top")).toBe(normalizeSourceUrl("http://news.example/a/b?id=3"));
    expect(dedupKey("funding", { url: "https://news.example/a?utm_campaign=z" })).toBe(dedupKey("funding", { url: "https://www.news.example/a/" }));
  });

  test("the same sentence reached through two claim fields is one signal", () => {
    const sentence = "Borealis Robotics announces its expansion into Europe with a new office in Rotterdam.";
    const base = AFTER.claims[0];
    const twice = { ...AFTER, claims: [{ ...base, id: "x1", field: "strategy" as const, statement: sentence, excerpt: sentence, epistemic: "fact" as const, method: "page_text" as const, sourceKey: "s1" }, { ...base, id: "x2", field: "geography" as const, statement: "Europe", excerpt: sentence, epistemic: "inference" as const, method: "page_text" as const, concepts: ["europe"], sourceKey: "s1" }] };
    expect(detectDelta({ previous: PREVIOUS, next: twice }).filter((c) => c.kind === "geographic_expansion")).toHaveLength(1);
  });

  test("a delta never proposes the same change twice", () => {
    const keys = detectDelta({ previous: PREVIOUS, next: AFTER }).map((c) => c.dedupKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("evidence quality", () => {
  test("strong needs a stated fact with an excerpt; team-reported is moderate; inference or snippet is limited", () => {
    expect(evidenceQuality({ epistemic: "fact", authority: "official", origin: "research", hasExcerpt: true })).toBe("strong");
    expect(evidenceQuality({ epistemic: "fact", authority: "third_party", origin: "research", hasExcerpt: false })).toBe("moderate");
    expect(evidenceQuality({ epistemic: "fact", authority: "official", origin: "manual", hasExcerpt: false })).toBe("moderate");
    expect(evidenceQuality({ epistemic: "inference", authority: "official", origin: "research", hasExcerpt: true })).toBe("limited");
    expect(evidenceQuality({ epistemic: "fact", authority: "search_result", origin: "research", hasExcerpt: true })).toBe("limited");
  });
});

describe("relevance (deterministic, explainable)", () => {
  test("Company B scenario: public expansion + private expansion note → relevant, revisit the relationship, existing follow-up kept", () => {
    const s = signal();
    const a = assessSignal(s, OWN, MEMORY_B);
    expect(a.state).toBe("relevant");
    expect(a.reasons.find((r) => r.dimension === "geography")).toMatchObject({ basis: "fact", concepts: ["europe"] });
    expect(a.reasons.find((r) => r.dimension === "private_context")?.basis).toBe("private");
    expect(a.privateMatches).toEqual([{ kind: "interaction", id: MEMORY_B.interactions[0].id, title: "Intro meeting at trade fair", at: "2026-02-10T14:00:00.000Z" }]);
    const r = reevaluate(s, a, MEMORY_B);
    expect(r).toEqual({ kind: "revisit_relationship", followUp: MEMORY_B.followUps[0] });
    // Need, scope and timing stay explicit unknowns.
    expect(a.unknowns).toEqual(expect.arrayContaining(["need_unproven", "expansion_scope", "date_unknown", "change_timing"]));
  });

  test("FACT vs INFERENCE: a build-type fit is always an inference, never a stated need", () => {
    const a = assessSignal(signal({ kind: "product_launch", concepts: [], headline: "Borealis unveils Rover Heavy" }), OWN, null);
    const fit = a.reasons.find((r) => r.dimension === "capability_fit");
    expect(fit?.basis).toBe("inference");
    expect(a.unknowns).toContain("need_unproven");
    expect(a.unknowns).toContain("build_or_partner");
  });

  test("weak evidence never yields a business consequence: limited evidence → needs validation → review only", () => {
    const s = signal({ epistemic: "inference", evidenceQuality: "limited" });
    const a = assessSignal(s, OWN, MEMORY_B);
    expect(a.state).toBe("needs_validation");
    expect(reevaluate(s, a, MEMORY_B)).toEqual({ kind: "review" });
  });

  test("no link to the organization → no material change; no own profile → needs validation and says why", () => {
    const unrelated = signal({ kind: "hiring", concepts: ["apac"] });
    const a = assessSignal(unrelated, OWN, { stage: "watching", reason: "", interactions: [], followUps: [] });
    expect(a.state).toBe("no_clear_link");
    expect(reevaluate(unrelated, a, null)).toEqual({ kind: "no_material_change", why: "no_clear_link" });
    const noOwn = assessSignal(unrelated, null, null);
    expect(noOwn.state).toBe("needs_validation");
    expect(noOwn.unknowns).toContain("own_profile_missing");
  });

  test("an opportunity-stage company → re-evaluate the opportunity", () => {
    const memory = { ...MEMORY_B, stage: "opportunity" as const };
    const s = signal();
    expect(reevaluate(s, assessSignal(s, OWN, memory), memory).kind).toBe("reevaluate_opportunity");
  });
});

describe("public evidence vs private memory", () => {
  test("private context is referenced by kind/id/title only — never copied as evidence text", () => {
    const matches = privateContextMatches(signal(), MEMORY_B);
    expect(JSON.stringify(matches)).not.toContain("domestic");
    expect(JSON.stringify(matches)).not.toContain("integration partner");
  });

  test("a private note is never needed for a public signal, and does not change its evidence", () => {
    const s = signal();
    const withPrivate = assessSignal(s, OWN, MEMORY_B);
    const without = assessSignal(s, OWN, null);
    expect(without.privateMatches).toEqual([]);
    expect(without.reasons.some((r) => r.basis === "private")).toBe(false);
    expect(withPrivate.reasons.filter((r) => r.basis !== "private")).toEqual(without.reasons.filter((r) => r.basis !== "private"));
  });

  test("an unrelated private note does not match", () => {
    expect(privateContextMatches(signal({ kind: "funding", concepts: [] }), { ...MEMORY_B, interactions: [interaction({ summary: "Talked about warehouse robots." })], followUps: [] })).toEqual([]);
  });

  test("the signal record type has no private field", () => {
    const keys = Object.keys(signal());
    for (const forbidden of ["notes", "summary", "outcome", "nextStep", "contact", "interaction"]) expect(keys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
  });
});

describe("lifecycle", () => {
  test("explicit transitions only; acted_on and dismissed can be reopened", () => {
    expect(canTransition("new", "reviewed")).toBe(true);
    expect(canTransition("new", "dismissed")).toBe(true);
    expect(canTransition("reviewed", "dismissed")).toBe(true);
    expect(canTransition("dismissed", "new")).toBe(true);
    expect(canTransition("acted_on", "new")).toBe(true);
    expect(canTransition("dismissed", "reviewed")).toBe(false);
    expect(canTransition("dismissed", "acted_on")).toBe(false);
    expect(canTransition("acted_on", "dismissed")).toBe(false);
  });

  test("dismissed or acted-on signals propose nothing and leave Needs attention", () => {
    for (const status of ["dismissed", "acted_on"] as const) {
      const s = signal({ status });
      const a = assessSignal(s, OWN, MEMORY_B);
      const r = reevaluate(s, a, MEMORY_B);
      expect(r).toEqual({ kind: "no_material_change", why: "closed" });
      expect(needsAttention([{ signal: s, assessment: a, reevaluation: r }])).toEqual([]);
    }
    const reviewed = signal({ status: "reviewed" });
    const ar = assessSignal(reviewed, OWN, MEMORY_B);
    expect(needsAttention([{ signal: reviewed, assessment: ar, reevaluation: reevaluate(reviewed, ar, MEMORY_B) }])).toEqual([]);
  });

  test("Needs attention orders relevant before potentially relevant", () => {
    const strong = signal();
    const weaker = signal({ kind: "hiring", concepts: ["europe"] });
    const items = [weaker, strong].map((s) => {
      const a = assessSignal(s, OWN, s === strong ? MEMORY_B : null);
      return { signal: s, assessment: a, reevaluation: reevaluate(s, a, s === strong ? MEMORY_B : null) };
    });
    expect(needsAttention(items).map((x) => x.signal.id)).toEqual([strong.id, weaker.id]);
  });
});

describe("Next Best Action is not overridden by signals", () => {
  test("the open human follow-up stays the Next Best Action; the signal only suggests reviewing it", () => {
    const nba = nextBestAction({ stage: "conversation", contacts: [], interactions: MEMORY_B.interactions, followUps: MEMORY_B.followUps, validationQuestion: null, today: "2026-09-30" });
    expect(nba).toMatchObject({ kind: "follow_up", followUp: { id: MEMORY_B.followUps[0].id } });
    const s = signal();
    const r = reevaluate(s, assessSignal(s, OWN, MEMORY_B), MEMORY_B);
    // Same follow-up, not a replacement; its due date is untouched.
    expect(r.kind === "revisit_relationship" && r.followUp?.dueOn).toBe("2027-03-01");
  });
});

describe("dates", () => {
  test("an unknown publication date stays unknown (never the retrieval or first-seen day)", () => {
    expect(signalUnknowns({ kind: "funding", publishedOn: null, origin: "manual" })).toContain("date_unknown");
    expect(signalUnknowns({ kind: "funding", publishedOn: "2026-09-12", origin: "manual" })).not.toContain("date_unknown");
    for (const c of detectDelta({ previous: PREVIOUS, next: AFTER })) expect(c.publishedOn).toBeNull();
  });
});

describe("entitlements and cost", () => {
  test("the Intelligence workspace is a Free capability; monitoring and the Signals Agent are not unlocked", () => {
    expect(featureAccess("free", "intelligence.feed").state).toBe("available");
    expect(featureAccess("free", "intelligence.monitoring").state).toBe("locked");
    expect(featureAccess("pro", "intelligence.monitoring").state).toBe("coming_soon");
    expect(AGENT_REGISTRY.signal.status).toBe("coming_soon");
  });

  test("AI reasoning over signals is refused on Free, on Pro and in operator preview while the agent is not built", () => {
    expect(signalReasoningDecision({ entitledPlan: "free", preview: false })).toEqual({ ok: false, reason: "agent_unavailable" });
    expect(signalReasoningDecision({ entitledPlan: "free", preview: true })).toEqual({ ok: false, reason: "agent_unavailable" });
    expect(signalReasoningDecision({ entitledPlan: "business", preview: false })).toEqual({ ok: false, reason: "agent_unavailable" });
  });

  test("the signals agent seam is read-only, internal and free", () => {
    const tool = TOOLS.read_company_signals;
    expect(tool.risk).toBe("read");
    expect(tool.externalNetwork).toBe(false);
    expect(tool.variableCost).toBe(false);
    expect(tool.limits.maxModelCalls).toBe(0);
    expect(tool.limits.maxExternalRequests).toBe(0);
  });

  test("no signal code path can reach a provider, a model, the fetcher or a URL", () => {
    const root = join(import.meta.dir, "..", "..");
    const files = [
      ...readdirSync(join(root, "lib/signals")).map((f) => join(root, "lib/signals", f)),
      ...readdirSync(join(root, "lib/server/signals")).map((f) => join(root, "lib/server/signals", f)),
      join(root, "lib/server/repositories/signals.ts"),
      join(root, "app/actions/signals.ts"),
      join(root, "components/orqo/signals.tsx"),
      join(root, "components/orqo/signal-forms.tsx"),
      join(root, "app/workspace/intelligence/page.tsx"),
    ].filter((f) => statSync(f).isFile() && !f.endsWith(".test.ts"));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/research\/(providers|brave|fetcher)|ai\/openrouter|configuredProviders|createPageFetcher|\bfetch\(/);
    }
  });
});
