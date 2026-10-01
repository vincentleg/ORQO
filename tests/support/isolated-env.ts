/**
 * Phase 13: environment planning for the ISOLATED test project (pure: no file,
 * no network, never prints a value).
 *
 * The integration suites (tests/db, tests/http, scripts/e2e-*) mutate data, so
 * they must only ever reach a dedicated, disposable Supabase project. This
 * planner builds the complete environment for those suites from the values of
 * `.env.test.local` alone, and refuses when anything could reach the real
 * project:
 *
 * 1. The existing destructive-test guard must pass (ORQO_DESTRUCTIVE_TESTS_PROJECT
 *    equals the project ref of both the API URL and the database URL).
 * 2. The test project ref must differ from every project ref found in the real
 *    `.env.local` (API and database URLs).
 * 3. No Supabase credential or URL may be byte-identical to the real one.
 * 4. The synthetic preview organization must sit in the reserved test namespace
 *    and never be a real preview organization.
 * 5. Every variable name known to the app (from the real `.env.local` and from
 *    `.env.example`) is set explicitly: the test value, or "" — never left unset,
 *    because Next.js and the test loader would otherwise fall back to `.env.local`.
 * 6. Paid providers are forced off (kill switch on, keys blank).
 */
import { assertDestructiveTestsAllowed, assertSyntheticTestOrgId, DEFAULT_TEST_PREVIEW_ORG, projectRef, UnsafeTestEnvironmentError } from "./safety";

export const REQUIRED_TEST_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_DB_URL", "ORQO_DESTRUCTIVE_TESTS_PROJECT"] as const;

/** Never compared or inherited across projects. */
const CREDENTIALS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_DB_URL"] as const;

/** Inherited process variables with these prefixes are dropped before the test values are applied. */
const SENSITIVE = /^(NEXT_PUBLIC_|SUPABASE_|ORQO_|OPENROUTER|BRAVE|NEO4J|BAND_|TEST_|E2E_|AGENT_PREVIEW_ORG|BASE_URL$)/;

/** Forced for every isolated run: no paid provider, no graph database. */
export const FORCED_OFF: Record<string, string> = {
  ORQO_PROVIDERS_KILL_SWITCH: "on",
  OPENROUTER_API_KEY: "",
  BRAVE_API_KEY: "",
  BRAVE_SEARCH_API_KEY: "",
  NEO4J_URI: "",
  NEO4J_USERNAME: "",
  NEO4J_USER: "",
  NEO4J_PASSWORD: "",
  ORQO_RESEARCH_PREVIEW_ORGS: "",
  ORQO_DEMO_LIVE_PROVIDERS: "",
  BAND_API_KEY: "",
  // The opt-in live OpenRouter test in tests/http is never enabled by the isolated runner.
  ORQO_TEST_LIVE_AI: "",
};

export interface IsolatedPlan {
  env: Record<string, string>;
  /** Masked, for display: never the full ref. */
  maskedRef: string;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i < 1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, i).replace(/^\s*export\s+/, "").trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    out[key] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export const mask = (ref: string): string => (ref.length <= 4 ? "****" : `****${ref.slice(-4)}`);

export function planIsolatedEnv(input: {
  /** Values from .env.test.local. */
  test: Record<string, string>;
  /** Values from the real .env.local (used only for refusals and variable names; never copied). */
  real: Record<string, string>;
  /** Variable names declared in .env.example. */
  exampleNames: readonly string[];
  /** Real preview organization ids (from the real env files). */
  realPreviewIds: ReadonlySet<string>;
  /** The current process environment (PATH, HOME, …). */
  base: Record<string, string | undefined>;
  /** Absolute path of the test env file, exported as ORQO_TEST_ENV_FILE. */
  testEnvFile: string;
  /** Origin of the isolated app server (for ORQO_SITE_URL / BASE_URL). */
  serverOrigin: string;
}): IsolatedPlan {
  const { test, real } = input;
  const missing = REQUIRED_TEST_VARS.filter((k) => !test[k]);
  if (missing.length > 0) throw new UnsafeTestEnvironmentError(`.env.test.local is missing: ${missing.join(", ")}.`);

  // 1. Existing guard, evaluated on the TEST values only.
  const ref = assertDestructiveTestsAllowed(test);

  // 2. Never the real project.
  const realRefs = new Set([projectRef(real.NEXT_PUBLIC_SUPABASE_URL ?? ""), projectRef(real.SUPABASE_DB_URL ?? "")].filter((x): x is string => Boolean(x)));
  if (realRefs.has(ref)) throw new UnsafeTestEnvironmentError("Refusing: the test project is the same Supabase project as the real .env.local.");

  // 3. No reused credential.
  for (const k of CREDENTIALS) if (real[k] && test[k] === real[k]) throw new UnsafeTestEnvironmentError(`Refusing: ${k} in .env.test.local is identical to the real one.`);

  // 4. Synthetic preview organization only.
  const previewOrg = assertSyntheticTestOrgId(test.TEST_PREVIEW_ORG || DEFAULT_TEST_PREVIEW_ORG, input.realPreviewIds);
  if (test.ORQO_AGENT_PREVIEW_ORGS) for (const id of test.ORQO_AGENT_PREVIEW_ORGS.split(",")) if (id.trim()) assertSyntheticTestOrgId(id, input.realPreviewIds);

  // 5. Explicit values for every known name; inherited sensitive variables are dropped.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.base)) if (v !== undefined && !SENSITIVE.test(k)) env[k] = v;
  for (const k of new Set([...Object.keys(real), ...input.exampleNames, ...Object.keys(test)])) env[k] = test[k] ?? "";
  Object.assign(env, {
    TEST_PREVIEW_ORG: previewOrg,
    ORQO_AGENT_PREVIEW_ORGS: test.ORQO_AGENT_PREVIEW_ORGS || previewOrg,
    ORQO_SITE_URL: input.serverOrigin,
    BASE_URL: input.serverOrigin,
    ORQO_TEST_ENV_FILE: input.testEnvFile,
  });
  // 6. Paid providers and the graph database are off, whatever the test file says.
  Object.assign(env, FORCED_OFF);
  return { env, maskedRef: mask(ref) };
}
