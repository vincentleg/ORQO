/**
 * Phase 12 hardening regressions. No database, no provider, no network: every
 * outbound call goes through a fake or a trap, and identifiers are fictional.
 *
 * Covers: safe observability (redaction, field whitelist, never throws),
 * paid-provider kill switch, provider error sanitization, CSRF guard, security
 * headers, SSRF edge cases, graph rebuild denial recording, and a static
 * inventory of server boundaries (every API route authenticates, every
 * mutating API route has the CSRF guard, every server action authenticates
 * and checks membership before touching organization data).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import nextConfig, { SECURITY_HEADERS } from "../../../next.config";
import { snapshot } from "@/lib/graph/opportunity/fixtures";
import { AppError } from "./errors";
import { assertSameOriginJson } from "./http";
import { errorCategory, errorSummary, observe, recordOperation, redact, setOperationSink } from "./observability";

const ORG_A = "0a000000-0000-4000-8000-00000000000a";
type Event = Record<string, string | number | null>;

let events: Event[] = [];
let restoreSink: () => void = () => undefined;
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

beforeEach(() => {
  events = [];
  restoreSink = setOperationSink((e) => events.push(e));
  globalThis.fetch = (() => {
    throw new Error("unexpected network access in a Phase 12 test");
  }) as unknown as typeof fetch;
});
afterEach(() => {
  restoreSink();
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

describe("observability is safe by construction", () => {
  test("redaction masks secrets, tokens, credentials, emails, phones and query strings", () => {
    const raw = [
      "Bearer abc.def-ghi_123",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl",
      "sb_secret_FAKEFAKEFAKE sb_publishable_FAKEFAKE",
      "sk-or-v1-FAKEFAKEFAKEFAKE",
      "password=hunter2 api_key: FAKEKEY token=FAKETOKEN",
      "postgresql://user:p4ss@db.example.com/postgres",
      "alex@fictional.example",
      "+33 6 12 34 56 78 and 06 12 34 56 78",
      "https://site.example/path?email=a@b.c&key=1",
    ].join(" | ");
    const out = redact(raw, 2000);
    for (const leak of ["abc.def-ghi_123", "c2lnbmF0dXJl", "FAKEFAKEFAKE", "hunter2", "FAKEKEY", "FAKETOKEN", "p4ss", "alex@fictional.example", "12 34 56 78", "email=a@b.c"]) expect(out).not.toContain(leak);
    expect(out).toContain("https://site.example/path?[query]");
  });

  test("identifiers, dates and durations survive redaction; long text is capped", () => {
    const out = redact(`run ${ORG_A} on 2026-09-30 took 1234 ms`);
    expect(out).toContain(ORG_A);
    expect(out).toContain("2026-09-30");
    expect(redact("x".repeat(1000)).length).toBeLessThanOrEqual(301);
    expect(errorSummary(new Error("failed for alex@fictional.example with Bearer zzz"))).toBe("Error: failed for [email] with Bearer [redacted]");
    expect(errorSummary("a string")).toBe("string");
  });

  test("only whitelisted fields leave recordOperation; ids must look like ids", () => {
    recordOperation({ operation: "provider.call", outcome: "failed", provider: "openrouter", organizationId: ORG_A, runId: "not an id; DROP TABLE", durationMs: 12.7, errorCategory: "http_500", ...({ prompt: "PRIVATE PROMPT", note: "PRIVATE NOTE", apiKey: "sk-or-v1-FAKEFAKEFAKE" } as object) });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(Object.keys(e).sort()).toEqual(["durationMs", "errorCategory", "operation", "organizationId", "outcome", "provider"]);
    expect(e.durationMs).toBe(13);
    expect(JSON.stringify(e)).not.toMatch(/PRIVATE|FAKEFAKE|DROP/);
  });

  test("a failing sink never breaks the observed operation; observe rethrows and categorizes", async () => {
    setOperationSink(() => {
      throw new Error("sink down");
    });
    expect(() => recordOperation({ operation: "x", outcome: "succeeded" })).not.toThrow();
    setOperationSink((e) => events.push(e));
    await expect(observe({ operation: "provider.call", provider: "brave" }, async () => Promise.reject(new Error("Brave HTTP 429")))).rejects.toThrow("Brave HTTP 429");
    expect(events.at(-1)).toMatchObject({ outcome: "failed", errorCategory: "http_429", provider: "brave" });
    expect(await observe({ operation: "y" }, async () => 7)).toBe(7);
    expect(events.at(-1)).toMatchObject({ operation: "y", outcome: "succeeded" });
    expect(errorCategory(new AppError("unavailable", "x"))).toBe("unavailable");
    expect(errorCategory(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("timeout");
  });
});

describe("paid-provider kill switch and provider error hygiene", () => {
  test("the kill switch makes OpenRouter and Brave read as unconfigured; nothing reaches the network", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-FICTIONALKEY";
    process.env.BRAVE_API_KEY = "FICTIONAL-BRAVE";
    process.env.ORQO_PROVIDERS_KILL_SWITCH = "on";
    const { serverConfig, paidProvidersKilled, publicStatus } = await import("./config");
    const { configuredProviders } = await import("./research/providers");
    const { structuredCompletion, AIUnavailableError } = await import("./ai/openrouter");
    const { braveSearch, ResearchUnavailableError } = await import("./research/brave");
    const { z } = await import("zod");
    expect(paidProvidersKilled()).toBe(true);
    expect(serverConfig().openrouter).toMatchObject({ apiKey: undefined, enabled: false });
    expect(serverConfig().brave.apiKey).toBeUndefined();
    expect(configuredProviders()).toEqual({ search: null, model: null });
    expect(publicStatus({ signedIn: true }).ai.available).toBe(false);
    await expect(structuredCompletion({ name: "t", schema: z.object({}), messages: [] })).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(braveSearch("fictional")).rejects.toBeInstanceOf(ResearchUnavailableError);
    // With the switch off, the same keys are visible again (the switch is the only difference).
    process.env.ORQO_PROVIDERS_KILL_SWITCH = "";
    expect(configuredProviders().model).not.toBeNull();
    expect(configuredProviders().search).not.toBeNull();
  });

  test("an OpenRouter HTTP failure never carries the provider's body, and is recorded by category", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-FICTIONALKEY";
    delete process.env.ORQO_PROVIDERS_KILL_SWITCH;
    delete process.env.ORQO_LIVE_AI;
    globalThis.fetch = (async () => new Response("echo: PRIVATE PROMPT and sk-or-v1-FICTIONALKEY", { status: 500 })) as unknown as typeof fetch;
    const { structuredCompletion } = await import("./ai/openrouter");
    const { z } = await import("zod");
    const err = await structuredCompletion({ name: "t", schema: z.object({}), messages: [], model: "fictional/model" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("OpenRouter HTTP 500");
    expect(events.at(-1)).toMatchObject({ operation: "provider.call", provider: "openrouter", model: "fictional/model", outcome: "failed", errorCategory: "http_500" });
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|FICTIONALKEY/);
  });

  test("a Brave failure is a categorized ProviderCallError; the subscription key never appears", async () => {
    const { braveSearchProvider, ProviderCallError } = await import("./research/providers");
    const p = braveSearchProvider("FICTIONAL-BRAVE-KEY", (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch);
    const err = await p.search("fictional query", { count: 3, timeoutMs: 1000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderCallError);
    expect((err as Error).message).toBe("Brave HTTP 429");
    expect(events.at(-1)).toMatchObject({ provider: "brave", outcome: "failed", errorCategory: "http_429" });
    expect(JSON.stringify(events)).not.toContain("FICTIONAL-BRAVE-KEY");
  });
});

describe("web application basics", () => {
  const req = (headers: Record<string, string>) => new Request("https://app.example/api/v1/organizations", { method: "POST", headers });

  test("CSRF guard: JSON only, and a foreign Origin is refused", () => {
    expect(() => assertSameOriginJson(req({ "content-type": "text/plain", host: "app.example" }))).toThrow(AppError);
    expect(() => assertSameOriginJson(req({ "content-type": "application/x-www-form-urlencoded", host: "app.example" }))).toThrow(AppError);
    expect(() => assertSameOriginJson(req({ "content-type": "application/json", host: "app.example", origin: "https://evil.example" }))).toThrow(AppError);
    expect(() => assertSameOriginJson(req({ "content-type": "application/json", host: "app.example", origin: "null" }))).toThrow(AppError);
    expect(() => assertSameOriginJson(req({ "content-type": "application/json", host: "app.example", origin: "https://app.example" }))).not.toThrow();
    // API clients (Bearer, no Origin) still work.
    expect(() => assertSameOriginJson(req({ "content-type": "application/json; charset=utf-8", host: "app.example" }))).not.toThrow();
  });

  test("security headers: framing, sniffing, referrer and permissions — no script CSP that could break the app", async () => {
    const byKey = new Map(SECURITY_HEADERS.map((h) => [h.key.toLowerCase(), h.value]));
    expect(byKey.get("x-frame-options")).toBe("DENY");
    expect(byKey.get("x-content-type-options")).toBe("nosniff");
    expect(byKey.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(byKey.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(byKey.get("content-security-policy")).not.toMatch(/script-src|default-src|style-src|connect-src/);
    expect(byKey.get("permissions-policy")).toContain("camera=()");
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  test("SSRF edge cases: IPv6 literals, trailing dots, octal/short IPv4, internal names, 6to4 and Teredo", async () => {
    const { assertSafeUrlShape, isPublicAddress, assertSafeUrl } = await import("./research/url-safety");
    for (const bad of [
      "http://[::1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://localhost./",
      "http://127.1/",
      "http://0177.0.0.1/",
      "http://fictional.example@127.0.0.1/",
      "https://metadata.google.internal/computeMetadata/v1/",
      "http://printer.local/",
      "file:///etc/passwd",
      "gopher://fictional.example/",
      "ftp://fictional.example/",
      "http://fictional.example:8080/",
      "javascript:alert(1)",
      "http:///nohost",
    ])
      expect(() => assertSafeUrlShape(bad)).toThrow();
    for (const ip of ["2002:7f00:1::", "2002:a9fe:a9fe::1", "2002:0a00:0001::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe"]) expect(isPublicAddress(ip)).toBe(false);
    for (const ip of ["2002:0808:0808::1", "2606:4700::1111"]) expect(isPublicAddress(ip)).toBe(true);
    // A public-looking name that resolves to a 6to4-wrapped metadata address is refused.
    await expect(assertSafeUrl("https://fictional-rebind.example/", async () => ["2002:a9fe:a9fe::1"])).rejects.toThrow("non-public");
    // Legitimate official sites still pass.
    expect(assertSafeUrlShape("https://www.fictional-company.example/about").hostname).toBe("www.fictional-company.example");
  });
});

describe("graph rebuild is recorded without trusting the caller", () => {
  function memberDb(role: "viewer" | "admin" | null) {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: role ? { role, organizations: { id: ORG_A, name: "Fictional workspace", default_locale: "en" } } : null, error: null }),
    };
    return { from: () => q } as never;
  }

  test("a non-admin is denied, and the denial does not record the requested organization id", async () => {
    const { rebuildOrganizationGraph, resetGraphServiceState } = await import("./graph/service");
    const { MemoryGraphStore } = await import("./graph/store");
    resetGraphServiceState();
    const deps = { config: { kind: "ready" as const, store: new MemoryGraphStore() }, load: async () => snapshot(ORG_A) };
    await expect(rebuildOrganizationGraph(memberDb("viewer"), "u", ORG_A, deps)).rejects.toBeInstanceOf(AppError);
    expect(events.at(-1)).toMatchObject({ operation: "graph.rebuild", outcome: "denied", organizationId: null });
    await rebuildOrganizationGraph(memberDb("admin"), "u", ORG_A, deps);
    expect(events.at(-1)).toMatchObject({ operation: "graph.rebuild", outcome: "succeeded", organizationId: ORG_A, provider: "neo4j" });
    resetGraphServiceState();
  });
});

describe("static inventory of server boundaries", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const files = (pattern: string) => [...new Glob(pattern).scanSync({ cwd: process.cwd() })].sort();

  test("every v1 API handler authenticates; every mutating handler has the CSRF guard before reading the body", () => {
    const routes = files("src/app/api/v1/**/route.ts");
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const f of routes) {
      const s = read(f);
      for (const m of s.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b[\s\S]*?\n}\n/g)) {
        const body = m[0];
        expect({ f, method: m[1], auth: /requireAuth\(/.test(body) }).toEqual({ f, method: m[1], auth: true });
        if (m[1] !== "GET") {
          const guard = body.indexOf("assertSameOriginJson(");
          expect({ f, method: m[1], guard: guard >= 0 }).toEqual({ f, method: m[1], guard: true });
          const read = body.indexOf("readJson(");
          if (read >= 0) expect(guard).toBeLessThan(read);
        }
      }
    }
  });

  test("legacy paid routes authenticate and check the operator switch before any provider", () => {
    for (const [f, provider] of [
      ["src/app/api/discover/route.ts", "discoverWithLLM("],
      ["src/app/api/research/route.ts", "researchCompany("],
    ] as const) {
      const s = read(f);
      const auth = s.indexOf("await requireAuth(");
      const gate = s.indexOf("legacyLiveProvidersEnabled()");
      const call = s.indexOf(provider, s.indexOf("export async function"));
      expect(auth).toBeGreaterThan(0);
      expect(gate).toBeGreaterThan(auth);
      expect(call).toBeGreaterThan(gate);
    }
  });

  test("every server action that touches organization data authenticates and checks membership (or admin) first", () => {
    // Account-level actions that act only on the caller's own session or profile.
    const ACCOUNT_LEVEL = new Set(["signInAction", "signUpAction", "signOutAction", "setLocaleAction", "createOrganizationAction"]);
    let checked = 0;
    for (const f of files("src/app/actions/*.ts")) {
      const s = read(f);
      const helper = /async function member\([\s\S]*?requireAuth\(\)[\s\S]*?requireMembership\(/.test(s);
      for (const m of s.matchAll(/export async function (\w+)\([\s\S]*?\n}\n/g)) {
        const [body, name] = [m[0], m[1]];
        if (ACCOUNT_LEVEL.has(name)) continue;
        checked++;
        const direct = /requireAuth\(\)/.test(body) && /(requireMembership\(|rebuildOrganizationGraph\()/.test(body);
        const viaHelper = helper && /await member\(form\)/.test(body);
        expect({ f, name, guarded: direct || viaHelper }).toEqual({ f, name, guarded: true });
      }
    }
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  test("the runtime never reads privileged Supabase credentials", () => {
    for (const f of files("src/**/*.{ts,tsx}").filter((x) => !x.includes(".test."))) {
      const s = read(f);
      expect({ f, secret: /SUPABASE_SECRET_KEY|SUPABASE_DB_URL|service_role/.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")) }).toEqual({ f, secret: false });
    }
  });

  test("no NEXT_PUBLIC_ variable carries a provider or database secret", () => {
    const names = new Set<string>();
    for (const f of [...files("src/**/*.{ts,tsx}"), ".env.example"]) for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) names.add(m[0]);
    expect([...names].sort()).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  });
});
