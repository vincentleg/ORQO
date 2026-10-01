/**
 * Phase 13: the isolated-test-project planner refuses everything that could reach
 * the real project, and builds an environment with no fallback to .env.local.
 * Fictional project refs and credentials only; no file, no network.
 */
import { describe, expect, test } from "bun:test";
import { FORCED_OFF, mask, parseEnvFile, planIsolatedEnv, REQUIRED_TEST_VARS } from "../support/isolated-env";

const REAL = {
  NEXT_PUBLIC_SUPABASE_URL: "https://realprojref000.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_REALFAKE",
  SUPABASE_SECRET_KEY: "sb_secret_REALFAKE",
  SUPABASE_DB_URL: "postgresql://postgres.realprojref000:REALPASS@aws-0-eu.pooler.supabase.com:5432/postgres",
  ORQO_AGENT_PREVIEW_ORGS: "11111111-1111-4111-8111-111111111111",
  OPENROUTER_API_KEY: "sk-or-v1-REALFAKE",
  NEO4J_PASSWORD: "REALNEO",
};
const TEST = {
  NEXT_PUBLIC_SUPABASE_URL: "https://testprojref111.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TESTFAKE",
  SUPABASE_SECRET_KEY: "sb_secret_TESTFAKE",
  SUPABASE_DB_URL: "postgresql://postgres.testprojref111:TESTPASS@aws-0-eu.pooler.supabase.com:5432/postgres",
  ORQO_DESTRUCTIVE_TESTS_PROJECT: "testprojref111",
};
const base = { PATH: "/usr/bin", HOME: "/home/fictional", OPENROUTER_API_KEY: "sk-or-v1-INHERITED", ORQO_AGENT_PREVIEW_ORGS: "11111111-1111-4111-8111-111111111111", SUPABASE_DB_URL: "INHERITED-DB" };
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
    expect(() => plan({ ...TEST, SUPABASE_DB_URL: REAL.SUPABASE_DB_URL })).toThrow();
    // The test file pointing at the real project, with the guard "authorizing" it: still refused.
    expect(() => plan({ ...REAL, ORQO_DESTRUCTIVE_TESTS_PROJECT: "realprojref000" } as Record<string, string>)).toThrow("same Supabase project");
    expect(() => plan({ ...TEST, SUPABASE_SECRET_KEY: REAL.SUPABASE_SECRET_KEY })).toThrow("identical to the real one");
    expect(() => plan({ ...TEST, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: REAL.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY })).toThrow("identical to the real one");
  });

  test("refuses a real or non-synthetic preview organization", () => {
    expect(() => plan({ ...TEST, TEST_PREVIEW_ORG: REAL.ORQO_AGENT_PREVIEW_ORGS })).toThrow("REAL preview");
    expect(() => plan({ ...TEST, TEST_PREVIEW_ORG: "22222222-2222-4222-8222-222222222222" })).toThrow("reserved prefix");
    expect(() => plan({ ...TEST, ORQO_AGENT_PREVIEW_ORGS: REAL.ORQO_AGENT_PREVIEW_ORGS })).toThrow("REAL preview");
  });

  test("builds an environment with no fallback: every known name explicit, real values never copied, providers off", () => {
    const { env, maskedRef } = plan();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(TEST.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.SUPABASE_DB_URL).toBe(TEST.SUPABASE_DB_URL);
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
    for (const leak of ["REALFAKE", "REALPASS", "REALNEO", "realprojref000", "INHERITED", "11111111-1111"]) expect(all).not.toContain(leak);
    expect(maskedRef).toBe("****f111");
    expect(maskedRef).not.toContain("testprojref");
  });

  test("env file parsing and masking", () => {
    expect(parseEnvFile('# c\nA=1\nexport B="two"\nlower=x\nC=\n=bad')).toEqual({ A: "1", B: "two", C: "" });
    expect(mask("ab")).toBe("****");
  });
});
