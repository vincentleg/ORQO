/**
 * Phase 17A governance (pure): entitlement, Authority Contract, narrowing, model policy, structural guards.
 * No model, no network, no database.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { AuthorityExpansionError, AuthoritySchema, buildAuthority, deriveChild, expansions, parseAuthority, sameAuthority, type AuthorityContract } from "./authority";
import { mayUsePaidProviders, parseBudget, resolveEntitlementFrom, type Entitlement } from "./entitlement";
import { BRAVE_QUERY_RESERVATION_USD, DEFAULT_MODEL, reservationFor, selectModel, TIER_PRICE_CAPS } from "./model-policy";

const ROOT = join(import.meta.dir, "../../..");
const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const USER = "00000000-0000-4000-8000-0000000000c3";
const RUN = "00000000-0000-4000-8000-0000000000d4";
const CHILD = "00000000-0000-4000-8000-0000000000e5";
const env = (over: Record<string, string> = {}) => ({ ORQO_INTERNAL_ORGS: ORG, ORQO_INTERNAL_BUDGET_USD: "10", ...over });

describe("Entitlement", () => {
  test("Free, Pro and Business keep their meaning; Internal is server configuration only", () => {
    expect(resolveEntitlementFrom(OTHER, "free", env())).toMatchObject({ tier: "free", internal: false, featurePlan: "free", budgetUsd: null });
    expect(resolveEntitlementFrom(OTHER, "pro", env())).toMatchObject({ tier: "pro", featurePlan: "pro" });
    expect(resolveEntitlementFrom(OTHER, "business", env())).toMatchObject({ tier: "business", featurePlan: "business" });
    expect(resolveEntitlementFrom(ORG, "free", env())).toMatchObject({ tier: "internal", internal: true, featurePlan: "business", budgetUsd: 10 });
    expect(resolveEntitlementFrom(ORG.toUpperCase(), "free", env()).internal).toBe(true);
    // The legacy research preview is Internal; the legacy agents preview never grants paid spend.
    expect(resolveEntitlementFrom(OTHER, "free", { ORQO_RESEARCH_PREVIEW_ORGS: OTHER, ORQO_INTERNAL_BUDGET_USD: "5" }).internal).toBe(true);
    expect(resolveEntitlementFrom(OTHER, "free", { ORQO_AGENT_PREVIEW_ORGS: OTHER })).toMatchObject({ internal: false, agentPreview: true, budgetUsd: null });
  });

  test("a missing or invalid ceiling fails safe: no paid spend", () => {
    for (const bad of [undefined, "", "abc", "-1", "0", "1e3", "5000", "10.1234567", " "]) expect(parseBudget(bad)).toBeNull();
    expect(parseBudget("25")).toBe(25);
    expect(parseBudget("0.5")).toBe(0.5);
    expect(mayUsePaidProviders(resolveEntitlementFrom(ORG, "free", env({ ORQO_INTERNAL_BUDGET_USD: "" })))).toBe(false);
    expect(mayUsePaidProviders(resolveEntitlementFrom(ORG, "free", env()))).toBe(true);
    expect(mayUsePaidProviders(resolveEntitlementFrom(OTHER, "free", env()))).toBe(false);
    // Paid plans have no configured ceiling yet: no paid spend until one exists.
    expect(mayUsePaidProviders(resolveEntitlementFrom(OTHER, "business", env()))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const internal = (): Entitlement => resolveEntitlementFrom(ORG, "free", env());
const free = (): Entitlement => resolveEntitlementFrom(ORG, "free", {});
const research = (e: Entitlement, envelope = { maxCostUsd: 0.5 }) => buildAuthority({ principal: { organizationId: ORG, userId: USER }, entitlement: e, agent: AGENT_REGISTRY.research, capability: "company_research", autonomy: 2, envelope, ids: { missionId: null, runId: RUN } });

describe("Authority Contract: registry ∩ entitlement ∩ envelope", () => {
  test("Internal research holds the paid tools, within its envelope and ceiling", () => {
    const a = research(internal());
    expect(AuthoritySchema.safeParse(a).success).toBe(true);
    expect(a.tools).toEqual(expect.arrayContaining(["official_site_research", "deep_company_research"]));
    expect(a.network).toBe("public_search");
    expect(a.providers).toEqual({ openrouter: { tasks: ["extraction", "business_reasoning"], maxTier: "standard" }, brave: true });
    expect(a.writes).toEqual(["internal_evidence"]);
    expect(a.limits.maxCostUsd).toBe(0.5);
    expect(a.killSwitch).toBe("enforced");
    expect(research(internal(), { maxCostUsd: 50 }).limits.maxCostUsd).toBe(10); // capped by the ceiling
  });

  test("Free holds no paid tool, no provider and no money, whatever the envelope says", () => {
    const a = research(free(), { maxCostUsd: 100 });
    expect(a.tools).not.toContain("deep_company_research");
    expect(a.providers).toEqual({ openrouter: null, brave: false });
    expect(a.network).toBe("official_sites");
    expect(a.limits).toMatchObject({ maxCostUsd: 0, maxProviderCalls: 0, maxModelCalls: 0 });
  });

  test("the envelope can only narrow: dropped tools, lower network, fewer writes", () => {
    const a = buildAuthority({ principal: { organizationId: ORG, userId: USER }, entitlement: internal(), agent: AGENT_REGISTRY.research, capability: "company_research", autonomy: 2, envelope: { network: "official_sites", writes: [], maxCostUsd: 1 } });
    expect(a.network).toBe("official_sites");
    expect(a.tools).not.toContain("deep_company_research");
    expect(a.writes).toEqual([]);
    expect(a.providers.brave).toBe(false);
  });

  test("an agent cannot be given a capability it does not hold", () => {
    const a = buildAuthority({ principal: { organizationId: ORG, userId: USER }, entitlement: internal(), agent: AGENT_REGISTRY.partnership, capability: "prospect_discovery", autonomy: 1 });
    expect(a.tools).toEqual([]);
    expect(a.network).toBe("none");
  });

  test("the synthesis agent (Partnership) has no network and no provider even on Internal", () => {
    const a = buildAuthority({ principal: { organizationId: ORG, userId: USER }, entitlement: internal(), agent: AGENT_REGISTRY.partnership, capability: "opportunity_qualification", autonomy: 1, envelope: { maxCostUsd: 5 } });
    expect(a.network).toBe("none");
    expect(a.providers).toEqual({ openrouter: null, brave: false });
    expect(a.limits.maxCostUsd).toBe(0);
  });

  test("a stored snapshot is compared with the server's rebuild, independent of key order", () => {
    const a = research(internal());
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse())));
    expect(sameAuthority(a, reordered)).toBe(true);
    expect(sameAuthority(a, { ...a, limits: { ...a.limits, maxCostUsd: 0.6 } })).toBe(false);
    expect(sameAuthority(a, { ...a, tools: [...a.tools].reverse() })).toBe(false);
  });

  test("a malformed or tampered persisted authority is no authority", () => {
    const a = research(internal());
    expect(parseAuthority(a)).not.toBeNull();
    expect(parseAuthority({ ...a, tools: [...a.tools, "send_email"] })).toBeNull();
    expect(parseAuthority({ ...a, killSwitch: "off" })).toBeNull();
    expect(parseAuthority({ ...a, limits: { ...a.limits, maxCostUsd: 5000 } })).toBeNull();
    expect(parseAuthority({ ...a, extra: true })).toBeNull();
    expect(parseAuthority(null)).toBeNull();
  });
});

describe("Narrowing: a child is equal or narrower, never broader", () => {
  const parent = (): AuthorityContract => ({ ...research(internal()), limits: { ...research(internal()).limits, maxChildRuns: 3 } });
  const narrow = (p: AuthorityContract): AuthorityContract => ({ ...p, runId: CHILD, parentRunId: p.runId, depth: p.depth + 1, tools: ["official_site_research"], network: "official_sites", providers: { openrouter: null, brave: false }, limits: { ...p.limits, maxCostUsd: 0.1, maxChildRuns: 0 } });

  test("a narrower child is accepted", () => {
    const p = parent();
    const c = deriveChild(p, narrow(p), { runId: CHILD });
    expect(c).toMatchObject({ depth: 1, parentRunId: RUN, killSwitch: "enforced" });
  });

  test.each([
    ["tools", (c: AuthorityContract) => ({ ...c, tools: [...c.tools, "search_web_candidates" as const] })],
    ["network", (c: AuthorityContract) => ({ ...c, network: "public_search" as const })],
    ["providers", (c: AuthorityContract) => ({ ...c, providers: { openrouter: { tasks: ["critique" as const], maxTier: "standard" as const }, brave: false } })],
    ["writes", (c: AuthorityContract) => ({ ...c, writes: ["tracked_opportunity" as const] })],
    ["runtime", (c: AuthorityContract) => ({ ...c, limits: { ...c.limits, maxDurationMs: c.limits.maxDurationMs + 1 } })],
    ["cost", (c: AuthorityContract) => ({ ...c, limits: { ...c.limits, maxCostUsd: 0.51 } })],
    ["child_runs", (c: AuthorityContract) => ({ ...c, limits: { ...c.limits, maxChildRuns: 3 } })],
    ["depth", (c: AuthorityContract) => ({ ...c, limits: { ...c.limits, maxDepth: 3 } })],
    ["provider_calls", (c: AuthorityContract) => ({ ...c, limits: { ...c.limits, maxProviderCalls: 999 } })],
    ["autonomy", (c: AuthorityContract) => ({ ...c, autonomy: 3 as const })],
    ["organization", (c: AuthorityContract) => ({ ...c, organizationId: OTHER })],
    ["approval", (c: AuthorityContract) => ({ ...c, approval: { variableCost: "pre_approved" as const } })],
  ] as const)("expanding %s is refused", (dimension, widen) => {
    // For the network case the parent itself is limited to official sites.
    const p = dimension === "network" ? { ...parent(), network: "official_sites" as const, tools: ["official_site_research" as const], providers: { openrouter: null, brave: false } } : parent();
    const attempt = widen(narrow(p));
    expect(() => deriveChild(p, attempt, { runId: CHILD })).toThrow(AuthorityExpansionError);
    expect(expansions(p, { ...attempt, depth: 1, parentRunId: RUN })).toContain(dimension);
  });

  test("delegation depth and child-run count are bounded", () => {
    const p = parent();
    const grand = deriveChild(p, narrow(p), { runId: CHILD });
    // The child holds no child runs, so it cannot delegate further.
    expect(() => deriveChild(grand, narrow(grand), { runId: RUN })).toThrow(AuthorityExpansionError);
    const deep = { ...p, depth: 2 };
    expect(expansions(deep, { ...narrow(deep), depth: 3 })).toContain("depth");
    const noChildren = { ...p, limits: { ...p.limits, maxChildRuns: 0 } };
    expect(expansions(noChildren, narrow(noChildren))).toContain("child_runs");
  });
});

describe("Model Policy Engine", () => {
  test("deterministic; economy by default; never more than the authority's tier", () => {
    const e = selectModel("extraction", { maxTier: "standard", env: {} })!;
    expect(e.primary).toMatchObject({ model: DEFAULT_MODEL, tier: "economy", maxPrice: TIER_PRICE_CAPS.economy });
    expect(e.fallback).toBeNull();
    expect(selectModel("business_reasoning", { maxTier: "standard", env: {} })!.primary.tier).toBe("standard");
    expect(selectModel("business_reasoning", { maxTier: "economy", env: {} })!.primary.tier).toBe("economy"); // Pro ceiling
    expect(selectModel("extraction", { maxTier: null, env: {} })).toBeNull(); // no tier, no model
    expect(selectModel("synthesis", { maxTier: "standard", env: {} })).toEqual(selectModel("synthesis", { maxTier: "standard", env: {} }));
  });

  test("configured models are tried in order, with at most one fallback; malformed ids are ignored", () => {
    const s = selectModel("business_reasoning", { maxTier: "standard", env: { ORQO_MODEL_REASONING: "b/strong", ORQO_DISCOVERY_MODEL: "a/cheap", OPENROUTER_MODEL: "c/other" } })!;
    expect(s.primary.model).toBe("b/strong");
    expect(s.fallback?.model).toBe("a/cheap");
    expect(selectModel("extraction", { maxTier: "standard", env: { ORQO_MODEL_EXTRACTION: "bad model; rm -rf" } })!.primary.model).toBe(DEFAULT_MODEL);
  });

  test("the reservation is the true worst case at the price cap", () => {
    expect(reservationFor("economy", 16_000, 4_000)).toBeCloseTo((16_000 * 0.5 + 4_000 * 3) / 1e6, 6);
    const s = selectModel("extraction", { maxTier: "standard", env: {}, inputTokens: 99_999 })!;
    expect(s.primary.maxInputTokens).toBe(16_000); // a caller can only ask for less
    expect(BRAVE_QUERY_RESERVATION_USD).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("Structural guards", () => {
  const src = files(join(ROOT, "src")).filter((f) => !/\.test\.tsx?$/.test(f));
  const rel = (f: string) => f.slice(ROOT.length + 1);

  test("only the transports talk to the paid providers' hosts", () => {
    const offenders = src.filter((f) => /openrouter\.ai\/api|api\.search\.brave\.com/.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(offenders).toEqual(["src/lib/server/ai/openrouter.ts", "src/lib/server/governance/transports.ts"]);
  });

  test("only the provider gate issues permits; only the transports call OpenRouter", () => {
    expect(src.filter((f) => /\bissuePermit\(/.test(readFileSync(f, "utf8"))).map(rel).sort()).toEqual(["src/lib/server/governance/permit.ts", "src/lib/server/governance/provider-gate.ts"]);
    expect(src.filter((f) => /\bstructuredCompletion\(/.test(readFileSync(f, "utf8"))).map(rel).sort()).toEqual(["src/lib/server/governance/transports.ts"]);
    expect(src.filter((f) => /from "(\.\/transports|[^"]*governance\/transports)"/.test(readFileSync(f, "utf8"))).map(rel)).toEqual(["src/lib/server/governance/provider-gate.ts"]);
  });

  test("the OpenRouter and Brave transports consume a permit before anything else", () => {
    const or = readFileSync(join(ROOT, "src/lib/server/ai/openrouter.ts"), "utf8");
    expect(or.indexOf('consumePermit(permit, "openrouter")')).toBeGreaterThan(0);
    expect(or.indexOf('consumePermit(permit, "openrouter")')).toBeLessThan(or.indexOf("fetch("));
    const tr = readFileSync(join(ROOT, "src/lib/server/governance/transports.ts"), "utf8");
    expect(tr.indexOf('consumePermit(permit, "brave")')).toBeLessThan(tr.indexOf("fetchImpl(url"));
  });

  test("the governance layer holds no business-domain or company assumption", () => {
    for (const f of [...files(join(ROOT, "src/lib/governance")), ...files(join(ROOT, "src/lib/server/governance"))].filter((x) => !x.endsWith(".test.ts"))) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect({ f: rel(f), hit: code.match(/infodip|gigaio|dell\b|hardware|appliance|saas|biotech|pharma|logistic|manufactur/i)?.[0] ?? null }).toEqual({ f: rel(f), hit: null });
    }
  });

  test("no service-role key or client in the workforce path", () => {
    for (const f of src.filter((x) => /governance|agents|research|discovery/.test(x))) expect({ f: rel(f), ok: !/SUPABASE_SECRET_KEY|service_role/.test(readFileSync(f, "utf8")) }).toEqual({ f: rel(f), ok: true });
  });
});
