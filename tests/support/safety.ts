/**
 * Destructive-test safety guards (pure: no database, no network).
 *
 * Incident (Phase 5): a real development workspace was deleted because an
 * HTTP/E2E suite accepted a real preview organization id as its fixture id and
 * ran an unconditional `delete from public.organizations where id = …`.
 * These guards make that impossible:
 *
 * 1. Environment: destructive suites run only when the operator explicitly
 *    authorizes the exact Supabase project (ORQO_DESTRUCTIVE_TESTS_PROJECT
 *    must equal the project ref of BOTH the API URL and the database URL).
 * 2. Fixture identity ≠ preview authorization: a synthetic preview org id must
 *    sit in the reserved test namespace, and must never be one of the real
 *    preview ids configured in the repository's .env files.
 * 3. Legacy variables that used to carry real ids are refused outright.
 * Ownership is then proven in the database before any delete (see test-orgs.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Every synthetic organization id used as a fixture starts with this (reserved test namespace). */
export const TEST_ORG_PREFIX = "7e570000-";
/** Default synthetic preview organization (start the test server with ORQO_AGENT_PREVIEW_ORGS set to it). */
export const DEFAULT_TEST_PREVIEW_ORG = "7e570000-0000-4000-8000-000000000001";
/** Name prefix of synthetic organizations created directly by the suites. */
export const TEST_ORG_NAME_PREFIX = "[orqo-test:";
/** Variables that previously carried real preview ids into destructive suites. Refused. */
export const LEGACY_FIXTURE_VARS = ["AGENT_PREVIEW_ORG", "E2E_AGENT_PREVIEW_ORG"] as const;

export class UnsafeTestEnvironmentError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "abcd" for https://abcd.supabase.co, or for postgres://…@db.abcd.supabase.co / postgres.abcd@…pooler.supabase.com. */
export function projectRef(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const user = decodeURIComponent(u.username).toLowerCase();
    if (/^postgres\.[a-z0-9]+$/.test(user)) return user.slice("postgres.".length);
    const m = host.match(/^(?:db\.)?([a-z0-9]+)\.supabase\.(?:co|com|in)$/);
    if (m && m[1] !== "pooler") return m[1];
    if (host === "localhost" || host === "127.0.0.1") return "local";
    return null;
  } catch {
    return null;
  }
}

/** Throws unless the operator explicitly authorized destructive tests for exactly this project. */
export function assertDestructiveTestsAllowed(env: Record<string, string | undefined>): string {
  const allowed = (env.ORQO_DESTRUCTIVE_TESTS_PROJECT ?? "").trim().toLowerCase();
  const api = projectRef(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const db = projectRef(env.SUPABASE_DB_URL ?? "");
  if (!allowed) throw new UnsafeTestEnvironmentError("Destructive tests are not authorized: set ORQO_DESTRUCTIVE_TESTS_PROJECT to the Supabase project ref of a TEST project.");
  if (!api || !db) throw new UnsafeTestEnvironmentError("Cannot identify the Supabase project of the API or database URL; refusing destructive tests.");
  if (api !== db) throw new UnsafeTestEnvironmentError("The API URL and the database URL point to different projects; refusing destructive tests.");
  if (allowed !== api) throw new UnsafeTestEnvironmentError("ORQO_DESTRUCTIVE_TESTS_PROJECT does not match the configured Supabase project; refusing destructive tests.");
  for (const v of LEGACY_FIXTURE_VARS) if (env[v]) throw new UnsafeTestEnvironmentError(`${v} is no longer accepted (it allowed a real organization to become a test fixture). Use TEST_PREVIEW_ORG with a ${TEST_ORG_PREFIX}… id.`);
  return api;
}

/** Real preview ids configured for the app (ORQO_AGENT_PREVIEW_ORGS / ORQO_RESEARCH_PREVIEW_ORGS) in the given .env file contents. */
export function previewIdsIn(contents: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const text of contents)
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?ORQO_(?:AGENT|RESEARCH)_PREVIEW_ORGS\s*=\s*(.*)$/);
      if (m) for (const id of m[1].replace(/["']/g, "").split(",")) if (UUID.test(id.trim().toLowerCase())) ids.add(id.trim().toLowerCase());
    }
  return ids;
}

/** Real preview ids from the repository's env files (never from the test process environment, which may carry the synthetic id). */
export function realPreviewOrgIds(root: string = join(import.meta.dir, "..", "..")): Set<string> {
  const files = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"].map((f) => join(root, f)).filter(existsSync);
  return previewIdsIn(files.map((f) => readFileSync(f, "utf8")));
}

/** A fixture organization id must be synthetic and must never be a real preview organization. */
export function assertSyntheticTestOrgId(id: string, realPreview: ReadonlySet<string>): string {
  const v = id.trim().toLowerCase();
  if (!UUID.test(v)) throw new UnsafeTestEnvironmentError("Test organization id is not a UUID.");
  if (realPreview.has(v)) throw new UnsafeTestEnvironmentError("Refusing: this organization id is a REAL preview organization configured for the app. Fixture identity and preview authorization are separate.");
  if (!v.startsWith(TEST_ORG_PREFIX)) throw new UnsafeTestEnvironmentError(`Refusing: test organization ids must start with the reserved prefix ${TEST_ORG_PREFIX}.`);
  return v;
}
