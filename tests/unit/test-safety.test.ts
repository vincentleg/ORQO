/**
 * Regression tests for the destructive-test guards (pure; no database).
 * Incident: a real preview organization was used as a test fixture and deleted.
 */
import { describe, expect, test } from "bun:test";
import { assertDestructiveTestsAllowed, assertSyntheticTestOrgId, DEFAULT_TEST_PREVIEW_ORG, previewIdsIn, projectRef, UnsafeTestEnvironmentError } from "../support/safety";

const REAL = "8c153dad-a537-49f2-abda-88c7deb857d1";
const env = (over: Record<string, string | undefined> = {}) => ({
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdtest.supabase.co",
  SUPABASE_DB_URL: "postgresql://postgres.abcdtest:pw@aws-0-eu-west-3.pooler.supabase.com:6543/postgres",
  ORQO_DESTRUCTIVE_TESTS_PROJECT: "abcdtest",
  ...over,
});

describe("environment authorization", () => {
  test("project refs are read from API, direct and pooler database URLs", () => {
    expect(projectRef("https://abcdtest.supabase.co")).toBe("abcdtest");
    expect(projectRef("postgresql://postgres:pw@db.abcdtest.supabase.co:5432/postgres")).toBe("abcdtest");
    expect(projectRef("postgresql://postgres.abcdtest:pw@aws-0-eu-west-3.pooler.supabase.com:6543/postgres")).toBe("abcdtest");
    expect(projectRef("not a url")).toBeNull();
  });

  test("destructive suites refuse unless this exact project is explicitly authorized", () => {
    expect(assertDestructiveTestsAllowed(env())).toBe("abcdtest");
    expect(() => assertDestructiveTestsAllowed(env({ ORQO_DESTRUCTIVE_TESTS_PROJECT: undefined }))).toThrow(UnsafeTestEnvironmentError);
    expect(() => assertDestructiveTestsAllowed(env({ ORQO_DESTRUCTIVE_TESTS_PROJECT: "otherproj" }))).toThrow(/does not match/);
    expect(() => assertDestructiveTestsAllowed(env({ SUPABASE_DB_URL: "postgresql://postgres:pw@db.otherproj.supabase.co:5432/postgres" }))).toThrow(/different projects/);
    expect(() => assertDestructiveTestsAllowed(env({ SUPABASE_DB_URL: "postgresql://u:p@db.example.net/x" }))).toThrow(/Cannot identify/);
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
