/**
 * Phase 13 production-readiness regressions: canonical site URL, HTTPS-aware
 * cookies, CSP report sanitization and PII-free denial events. No network, no
 * database; fictional values only.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cspReportEvents } from "./csp-report";
import { AppError } from "./errors";
import { recordDenial, toErrorResponse } from "./http";
import { setOperationSink } from "./observability";
import { configuredSiteOrigin, secureCookies, siteOrigin, SiteUrlError } from "./site";

type Event = Record<string, string | number | null>;
let events: Event[] = [];
let restore: () => void = () => undefined;
beforeEach(() => {
  events = [];
  restore = setOperationSink((e) => events.push(e));
});
afterEach(() => restore());

const env = (over: Record<string, string>) => ({ ...over }) as NodeJS.ProcessEnv;

describe("canonical site URL (ORQO_SITE_URL)", () => {
  test("production requires a valid https origin; loopback http is allowed for a local production build", () => {
    expect(siteOrigin({ env: env({ NODE_ENV: "production", ORQO_SITE_URL: "https://app.fictional.example/" }) })).toBe("https://app.fictional.example");
    expect(siteOrigin({ env: env({ NODE_ENV: "production", ORQO_SITE_URL: "http://localhost:3001" }) })).toBe("http://localhost:3001");
    for (const bad of ["", "http://app.fictional.example", "https://u:p@app.fictional.example", "https://app.fictional.example/path", "https://app.fictional.example/?x=1", "javascript:alert(1)", "not a url"]) {
      expect(() => siteOrigin({ env: env({ NODE_ENV: "production", ORQO_SITE_URL: bad }) })).toThrow(SiteUrlError);
    }
  });

  test("production never trusts the request Origin, even a plausible one", () => {
    expect(() => siteOrigin({ env: env({ NODE_ENV: "production" }), requestOrigin: "https://app.fictional.example" })).toThrow(SiteUrlError);
    expect(new SiteUrlError().code).toBe("unavailable");
  });

  test("development falls back to a loopback request origin, never to a foreign one", () => {
    expect(siteOrigin({ env: env({ NODE_ENV: "development" }), requestOrigin: "http://localhost:3001" })).toBe("http://localhost:3001");
    expect(siteOrigin({ env: env({ NODE_ENV: "development" }), requestOrigin: "https://evil.example" })).toBe("http://localhost:3000");
    expect(siteOrigin({ env: env({ NODE_ENV: "development" }), requestOrigin: null })).toBe("http://localhost:3000");
    expect(siteOrigin({ env: env({ NODE_ENV: "development", ORQO_SITE_URL: "https://app.fictional.example" }), requestOrigin: "http://localhost:3001" })).toBe("https://app.fictional.example");
  });

  test("configuredSiteOrigin rejects ambiguous values", () => {
    expect(configuredSiteOrigin(env({ ORQO_SITE_URL: "https://app.fictional.example#x" }))).toBeNull();
    expect(configuredSiteOrigin(env({}))).toBeNull();
  });
});

describe("HTTPS-aware cookies", () => {
  test("Secure in production (fail safe when unconfigured), not for a loopback http build or in development", () => {
    expect(secureCookies(env({ NODE_ENV: "production", ORQO_SITE_URL: "https://app.fictional.example" }))).toBe(true);
    expect(secureCookies(env({ NODE_ENV: "production" }))).toBe(true);
    expect(secureCookies(env({ NODE_ENV: "production", ORQO_SITE_URL: "http://localhost:3001" }))).toBe(false);
    expect(secureCookies(env({ NODE_ENV: "development" }))).toBe(false);
    expect(secureCookies(env({ NODE_ENV: "test", ORQO_SITE_URL: "https://app.fictional.example" }))).toBe(false);
  });
});

describe("CSP report sanitization", () => {
  test("keeps only the directive and the blocked origin or keyword — never paths, queries, samples or page URLs", () => {
    const legacy = { "csp-report": { "document-uri": "https://app.fictional.example/workspace/network/0a000000?secret=1", "violated-directive": "script-src-elem", "effective-directive": "script-src-elem", "blocked-uri": "https://cdn.evil.example/x.js?token=abc", "script-sample": "alert('PRIVATE')" } };
    expect(cspReportEvents(legacy)).toEqual([{ directive: "script-src-elem", blocked: "https://cdn.evil.example" }]);
    const modern = [{ type: "csp-violation", body: { documentURL: "https://app.fictional.example/x", effectiveDirective: "style-src-attr", blockedURL: "inline", sample: "PRIVATE" } }];
    expect(cspReportEvents(modern)).toEqual([{ directive: "style-src-attr", blocked: "inline" }]);
    expect(cspReportEvents({ "csp-report": { "effective-directive": "x; DROP", "blocked-uri": "javascript:alert(1)" } })).toEqual([{ directive: "unknown", blocked: "javascript" }]);
    expect(cspReportEvents(null)).toEqual([]);
    expect(cspReportEvents(Array.from({ length: 50 }, () => modern[0])).length).toBe(10);
  });
});

describe("PII-free denial events", () => {
  test("auth, entitlement, quota and availability refusals are recorded with route label and category only", () => {
    class Denied extends AppError {
      constructor(readonly reason: string) {
        super("forbidden", "denied");
      }
    }
    toErrorResponse(new AppError("unauthenticated", "Sign in required."), "POST research");
    recordDenial(new Denied("plan_required"), "POST agent mission");
    recordDenial(Object.assign(new AppError("rate_limited", "Limit"), { reason: "quota_exhausted" }), "POST research");
    recordDenial(new AppError("unavailable", "x"), "action:signUp");
    expect(events).toEqual([
      { outcome: "denied", operation: "request.refused", errorCategory: "unauthenticated", target: "POST research" },
      { outcome: "denied", operation: "request.refused", errorCategory: "plan_required", target: "POST agent mission" },
      { outcome: "denied", operation: "request.refused", errorCategory: "quota_exhausted", target: "POST research" },
      { outcome: "unavailable", operation: "request.refused", errorCategory: "unavailable", target: "action:signUp" },
    ]);
  });

  test("validation, not-found and conflict errors are not recorded (noise, not security signals)", () => {
    for (const code of ["invalid_input", "not_found", "conflict"] as const) toErrorResponse(new AppError(code, "x"), "POST companies");
    recordDenial(new Error("plain"), "x");
    expect(events).toEqual([]);
  });
});
