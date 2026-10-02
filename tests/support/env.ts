/**
 * `bun test` does not load .env.local, so integration tests load it here.
 * Only variable NAMES are ever reported; values are never printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_DB_URL"] as const;
export type TestEnvName = (typeof REQUIRED)[number];

export function loadTestEnv(): Record<TestEnvName, string> {
  // Phase 13: under the isolated-project runner (scripts/isolated-test.ts) ONLY the test env file is read —
  // never .env.local — and the runner has already set every known variable explicitly.
  const isolated = process.env.ORQO_TEST_ENV_FILE;
  if (isolated && /(^|\/)\.env\.local$/.test(isolated)) throw new Error("ORQO_TEST_ENV_FILE must not point at .env.local.");
  const file = isolated || join(import.meta.dir, "..", "..", ".env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i < 1 || line.trimStart().startsWith("#")) continue;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] ??= value;
    }
  }
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) throw new Error(`Integration tests need ${missing.join(", ")} in .env.local`);
  return Object.fromEntries(REQUIRED.map((k) => [k, process.env[k] ?? ""])) as Record<TestEnvName, string>;
}
