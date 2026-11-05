/**
 * Regression tests for the destructive-test guards (pure; no database).
 * Incident: a real preview organization was used as a test fixture and deleted.
 */
import { describe, expect, test } from "bun:test";
import { assertDestructiveTestsAllowed, assertSyntheticTestOrgId, DEFAULT_TEST_PREVIEW_ORG, previewIdsIn, projectRef, UnsafeTestEnvironmentError } from "../support/safety";

const REAL = "8c153dad-a537-49f2-abda-88c7deb857d1";
const env = (over: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: "postgresql://neondb_owner:pw@ep-test-abcd-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-test-abcd",
  ...over,
});

describe("environment authorization", () => {
  test("database identities are read from Neon (pooled and direct), local and legacy Supabase URLs", () => {
    expect(projectRef("postgresql://u:p@ep-test-abcd-pooler.us-east-1.aws.neon.tech/neondb")).toBe("ep-test-abcd");
    expect(projectRef("postgresql://u:p@ep-test-abcd.us-east-1.aws.neon.tech/neondb")).toBe("ep-test-abcd");
    expect(projectRef("postgres://app:pw@localhost:54329/orqo_test")).toBe("local-54329-orqo_test");
    expect(projectRef("postgres://app:pw@127.0.0.1/orqo")).toBe("local-5432-orqo");
    expect(projectRef("http://localhost:3000")).toBe("local");
    expect(projectRef("https://abcdtest.supabase.co")).toBe("abcdtest");
    expect(projectRef("postgresql://postgres:pw@db.abcdtest.supabase.co:5432/postgres")).toBe("abcdtest");
    expect(projectRef("postgresql://postgres.abcdtest:pw@aws-0-eu-west-3.pooler.supabase.com:6543/postgres")).toBe("abcdtest");
    expect(projectRef("not a url")).toBeNull();
  });

  test("destructive suites refuse unless this exact database is explicitly authorized", () => {
    expect(assertDestructiveTestsAllowed(env())).toBe("ep-test-abcd");
    expect(assertDestructiveTestsAllowed(env({ DATABASE_URL: "postgres://a:b@localhost:54329/orqo_test", ORQO_DESTRUCTIVE_TESTS_PROJECT: "local-54329-orqo_test" }))).toBe("local-54329-orqo_test");
    expect(() => assertDestructiveTestsAllowed(env({ ORQO_DESTRUCTIVE_TESTS_PROJECT: undefined }))).toThrow(UnsafeTestEnvironmentError);
    expect(() => assertDestructiveTestsAllowed(env({ ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-other" }))).toThrow(/does not match/);
    // Another local database is another identity.
    expect(() => assertDestructiveTestsAllowed(env({ DATABASE_URL: "postgres://a:b@localhost:54329/orqo_local", ORQO_DESTRUCTIVE_TESTS_PROJECT: "local-54329-orqo_test" }))).toThrow(/does not match/);
    expect(() => assertDestructiveTestsAllowed(env({ DATABASE_URL: "postgresql://u:p@db.example.net/x" }))).toThrow(/Cannot identify/);
    expect(() => assertDestructiveTestsAllowed(env({ DATABASE_URL: undefined }))).toThrow(/Cannot identify/);
    // Stale Supabase variables that point elsewhere are refused rather than ignored.
    expect(() => assertDestructiveTestsAllowed(env({ SUPABASE_DB_URL: "postgresql://postgres:pw@db.otherproj.supabase.co:5432/postgres" }))).toThrow(/different database/);
  });

  test("legacy fixture variables that carried a real id are refused", () => {
    expect(() => assertDestructiveTestsAllowed(env({ AGENT_PREVIEW_ORG: REAL }))).toThrow(/no longer accepted/);
    expect(() => assertDestructiveTestsAllowed(env({ E2E_AGENT_PREVIEW_ORG: REAL }))).toThrow(/no longer accepted/);
  });
});

describe("fixture identity is separate from preview authorization", () => {
  const real = previewIdsIn([`# app config\nORQO_AGENT_PREVIEW_ORGS="${REAL}"\nORQO_RESEARCH_PREVIEW_ORGS=7e570000-0000-4000-8000-0000000000aa\n`]);

  test("real preview ids are read from env file contents", () => {
    expect([...real].sort()).toEqual(["7e570000-0000-4000-8000-0000000000aa", REAL]);
  });

  test("a preview-authorized organization can never become a fixture, even in the reserved namespace", () => {
    expect(() => assertSyntheticTestOrgId(REAL, real)).toThrow(/REAL preview organization/);
    expect(() => assertSyntheticTestOrgId("7e570000-0000-4000-8000-0000000000aa", real)).toThrow(/REAL preview organization/);
  });

  test("only reserved-namespace UUIDs are accepted as synthetic fixtures", () => {
    expect(assertSyntheticTestOrgId(DEFAULT_TEST_PREVIEW_ORG, real)).toBe(DEFAULT_TEST_PREVIEW_ORG);
    expect(() => assertSyntheticTestOrgId("a4a4a4a4-0000-4000-8000-000000000004", real)).toThrow(/reserved prefix/);
    expect(() => assertSyntheticTestOrgId("not-a-uuid", real)).toThrow(/not a UUID/);
  });
});
