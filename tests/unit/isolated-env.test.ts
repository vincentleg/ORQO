/**
 * Phase 13 (ported to PostgreSQL/Neon in the Nov 2026 recovery): the isolated-test-database planner refuses
 * everything that could reach the real database, and builds an environment with no fallback to .env.local.
 * Fictional endpoints and credentials only; no file, no network.
 */
import { describe, expect, test } from "bun:test";
import { FORCED_OFF, mask, parseEnvFile, planIsolatedEnv, REQUIRED_TEST_VARS } from "../support/isolated-env";

const REAL = {
  DATABASE_URL: "postgresql://owner:REALPASS@ep-real-proj-r000-pooler.us-east-1.aws.neon.tech/neondb",
  ORQO_AGENT_PREVIEW_ORGS: "11111111-1111-4111-8111-111111111111",
  OPENROUTER_API_KEY: "sk-or-v1-REALFAKE",
  NEO4J_PASSWORD: "REALNEO",
};
const TEST = {
  DATABASE_URL: "postgresql://owner:TESTPASS@ep-test-proj-f111-pooler.us-east-1.aws.neon.tech/neondb",
  ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-test-proj-f111",
};
const base = { PATH: "/usr/bin", HOME: "/home/fictional", OPENROUTER_API_KEY: "sk-or-v1-INHERITED", ORQO_AGENT_PREVIEW_ORGS: "11111111-1111-4111-8111-111111111111", DATABASE_URL: "INHERITED-DB" };
const plan = (test: Record<string, string> = TEST, real: Record<string, string> = REAL) =>
  planIsolatedEnv({ test, real, exampleNames: ["ORQO_SITE_URL", "BRAVE_API_KEY", "ORQO_LIVE_AI"], realPreviewIds: new Set([REAL.ORQO_AGENT_PREVIEW_ORGS]), base, testEnvFile: "/fictional/.env.test.local", serverOrigin: "http://localhost:3100" });

describe("isolated test environment planner", () => {
  test("refuses a missing variable, a guard mismatch, the real project and reused credentials", () => {
    for (const k of REQUIRED_TEST_VARS) {
      const t: Record<string, string> = { ...TEST };
      delete t[k];
      expect(() => plan(t)).toThrow("missing");
    }
    expect(() => plan({ ...TEST, ORQO_DESTRUCTIVE_TESTS_PROJECT: "otherref" })).toThrow("does not match");
    expect(() => plan({ ...TEST, DATABASE_URL: REAL.DATABASE_URL })).toThrow();
    // The test file pointing at the real database, with the guard "authorizing" it: still refused.
    expect(() => plan({ ...REAL, ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-real-proj-r000" } as Record<string, string>)).toThrow("same database");
    // The same endpoint through its direct host is the same database.
    expect(() => plan({ DATABASE_URL: REAL.DATABASE_URL.replace("-pooler", ""), ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-real-proj-r000" })).toThrow("same database");
  });

  test("refuses a real or non-synthetic preview organization", () => {
    expect(() => plan({ ...TEST, TEST_PREVIEW_ORG: REAL.ORQO_AGENT_PREVIEW_ORGS })).toThrow("REAL preview");
    expect(() => plan({ ...TEST, TEST_PREVIEW_ORG: "22222222-2222-4222-8222-222222222222" })).toThrow("reserved prefix");
    expect(() => plan({ ...TEST, ORQO_AGENT_PREVIEW_ORGS: REAL.ORQO_AGENT_PREVIEW_ORGS })).toThrow("REAL preview");
  });

  test("builds an environment with no fallback: every known name explicit, real values never copied, providers off", () => {
    const { env, maskedRef } = plan();
    expect(env.DATABASE_URL).toBe(TEST.DATABASE_URL);
    // Names known from the real file / example but absent from the test file are blank, not missing.
    for (const k of ["NEO4J_PASSWORD", "ORQO_LIVE_AI", "BRAVE_API_KEY"]) expect(env[k]).toBe("");
    for (const [k, v] of Object.entries(FORCED_OFF)) expect(env[k]).toBe(v);
    expect(env.ORQO_PROVIDERS_KILL_SWITCH).toBe("on");
    expect(env.ORQO_AGENT_PREVIEW_ORGS).toBe("7e570000-0000-4000-8000-000000000001");
    expect(env.ORQO_SITE_URL).toBe("http://localhost:3100");
    expect(env.BASE_URL).toBe("http://localhost:3100");
    expect(env.ORQO_TEST_ENV_FILE).toBe("/fictional/.env.test.local");
    expect(env.PATH).toBe("/usr/bin");
    const all = JSON.stringify(env);
    for (const leak of ["REALFAKE", "REALPASS", "REALNEO", "ep-real-proj", "INHERITED", "11111111-1111"]) expect(all).not.toContain(leak);
    expect(maskedRef).toBe("****f111");
    expect(maskedRef).not.toContain("ep-test-proj");
  });

  test("env file parsing and masking", () => {
    expect(parseEnvFile('# c\nA=1\nexport B="two"\nlower=x\nC=\n=bad')).toEqual({ A: "1", B: "two", C: "" });
    expect(mask("ab")).toBe("****");
  });
});

describe("Phase 13 Stage G: production is a protected project", () => {
  const PROD = {
    ORQO_ENVIRONMENT: "production",
    ORQO_PRODUCTION_PROJECT: "ep-prod-proj-p222",
    DATABASE_URL: "postgresql://owner:PRODPASS@ep-prod-proj-p222-pooler.us-east-1.aws.neon.tech/neondb",
  };
  const withProd = (test: Record<string, string>) =>
    planIsolatedEnv({ test, real: REAL, protectedEnvs: [PROD], exampleNames: [], realPreviewIds: new Set(), base, testEnvFile: "/fictional/.env.test.local", serverOrigin: "http://localhost:3100" });

  test("the runner refuses a test file that points at production, even with the guard 'authorizing' it", () => {
    const asProd = { ...PROD, ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-prod-proj-p222" };
    delete (asProd as Record<string, string>).ORQO_ENVIRONMENT;
    expect(() => withProd(asProd)).toThrow("protected (production)");
  });

  test("the runner refuses reused production credentials and a production label", () => {
    // Same production database through its direct host, "authorized" by the guard: still refused.
    expect(() => withProd({ DATABASE_URL: PROD.DATABASE_URL.replace("-pooler", ""), ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-prod-proj-p222" })).toThrow("protected (production)");
    expect(() => withProd({ ...TEST, ORQO_ENVIRONMENT: "production" })).toThrow("labelled PRODUCTION");
    expect(withProd(TEST).env.DATABASE_URL).toBe(TEST.DATABASE_URL);
    expect(JSON.stringify(withProd(TEST).env)).not.toMatch(/PRODPASS|ep-prod-proj/);
  });

  test("the destructive suites' own guard refuses development and production refs", async () => {
    const { assertNotProtectedProject, protectedRefsIn } = await import("../support/safety");
    const refs = protectedRefsIn([Object.entries(PROD).map(([k, v]) => `${k}=${v}`).join("\n"), `DATABASE_URL=${REAL.DATABASE_URL}`]);
    expect([...refs].sort()).toEqual(["ep-prod-proj-p222", "ep-real-proj-r000"]);
    expect(() => assertNotProtectedProject({ DATABASE_URL: PROD.DATABASE_URL }, refs)).toThrow("protected");
    expect(() => assertNotProtectedProject({ DATABASE_URL: REAL.DATABASE_URL.replace("-pooler", "") }, refs)).toThrow("protected");
    expect(() => assertNotProtectedProject({ ORQO_ENVIRONMENT: "production" }, refs)).toThrow("PRODUCTION");
    expect(() => assertNotProtectedProject({ DATABASE_URL: TEST.DATABASE_URL }, refs)).not.toThrow();
  });
});
