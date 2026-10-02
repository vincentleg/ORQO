/**
 * Phase 13: runs the destructive / integration suites against the ISOLATED
 * Supabase test project only. Values come from `.env.test.local` exclusively
 * (git-ignored; see `.env.test.example` and docs/orqo-v2/ISOLATED-TEST-ENVIRONMENT.md).
 *
 *   bun scripts/isolated-test.ts check            validate the configuration (no network)
 *   bun scripts/isolated-test.ts migrate-status   list applied migrations on the TEST project
 *   bun scripts/isolated-test.ts migrate          apply repository migrations to the TEST project
 *   bun scripts/isolated-test.ts db               bun test tests/db
 *   bun scripts/isolated-test.ts http             bun test tests/http (isolated server)
 *   bun scripts/isolated-test.ts e2e:app|e2e:agents|e2e:discover|e2e:network   (isolated server)
 *
 * Safety (see tests/support/isolated-env.ts): the existing destructive-test guard,
 * a refusal when the test project equals the real one, no reused credential,
 * synthetic preview organizations only, every known variable set explicitly,
 * paid providers forced off. Children run with `bun --no-env-file`, so
 * `.env.local` is never auto-loaded. The app server for http/e2e is built and
 * started in a temporary git worktree that has no env file at all, so the
 * production `.next` build and any running dev server are untouched.
 * No credential or full project ref is ever printed.
 */
import { spawn } from "bun";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnvFile, planIsolatedEnv } from "../tests/support/isolated-env";
import { PRODUCTION_ENV_FILE, realPreviewOrgIds, UnsafeTestEnvironmentError } from "../tests/support/safety";

const ROOT = resolve(import.meta.dir, "..");
const TEST_FILE = join(ROOT, ".env.test.local");
const PORT = 3100;
const ORIGIN = `http://localhost:${PORT}`;

const SUITES: Record<string, { cmd: string[]; server: boolean }> = {
  "migrate-status": { cmd: ["scripts/db-migrate.ts", "status"], server: false },
  migrate: { cmd: ["scripts/db-migrate.ts", "up"], server: false },
  db: { cmd: ["test", "--timeout", "60000", "tests/db"], server: false },
  http: { cmd: ["test", "--timeout", "60000", "tests/http"], server: true },
  "e2e:app": { cmd: ["scripts/e2e-app.ts"], server: true },
  "e2e:agents": { cmd: ["scripts/e2e-agents.ts"], server: true },
  "e2e:discover": { cmd: ["scripts/e2e-discover.ts"], server: true },
  "e2e:network": { cmd: ["scripts/e2e-network.ts"], server: true },
  "e2e:understanding": { cmd: ["scripts/e2e-understanding.ts"], server: true },
};

function fail(message: string): never {
  console.error(`[isolated-test] REFUSED: ${message}`);
  process.exit(2);
}

async function run(cmd: string[], env: Record<string, string>, cwd = ROOT): Promise<number> {
  const p = spawn(["bun", "--no-env-file", ...cmd], { cwd, env, stdout: "inherit", stderr: "inherit" });
  return p.exited;
}

async function waitFor(url: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return true;
    } catch {
      // not up yet
    }
    await Bun.sleep(1000);
  }
  return false;
}

const suite = process.argv[2] ?? "check";
if (suite !== "check" && !SUITES[suite]) fail(`unknown suite "${suite}". Use: check, ${Object.keys(SUITES).join(", ")}.`);
if (!existsSync(TEST_FILE)) fail(".env.test.local does not exist. Create it from .env.test.example with the ISOLATED test project's values.");

let plan;
try {
  const realFile = join(ROOT, ".env.local");
  const exampleNames = Object.keys(parseEnvFile(readFileSync(join(ROOT, ".env.example"), "utf8")));
  plan = planIsolatedEnv({
    test: parseEnvFile(readFileSync(TEST_FILE, "utf8")),
    real: existsSync(realFile) ? parseEnvFile(readFileSync(realFile, "utf8")) : {},
    protectedEnvs: [PRODUCTION_ENV_FILE].map((f) => join(ROOT, f)).filter(existsSync).map((f) => parseEnvFile(readFileSync(f, "utf8"))),
    exampleNames,
    realPreviewIds: realPreviewOrgIds(ROOT),
    base: process.env,
    testEnvFile: TEST_FILE,
    serverOrigin: ORIGIN,
  });
} catch (e) {
  fail(e instanceof UnsafeTestEnvironmentError ? e.message : "could not read the environment files.");
}

console.log(`[isolated-test] test project ${plan.maskedRef} — guard passed, distinct from the real project, paid providers forced off.`);
if (suite === "check") process.exit(0);

const { cmd, server } = SUITES[suite];
// Never reuse a server that is already listening: it could be running with the REAL credentials.
if (server && (await fetch(`${ORIGIN}/login`).then(() => true, () => false))) fail(`port ${PORT} is already in use; stop that server first (it may not be the isolated one).`);

let worktree: string | null = null;
let app: ReturnType<typeof spawn> | null = null;
let code = 1;
try {
  if (server) {
    // A clean checkout of HEAD with no env file: the test build can only see the test values.
    worktree = mkdtempSync(join(tmpdir(), "orqo-isolated-"));
    const add = spawn(["git", "worktree", "add", "--detach", worktree, "HEAD"], { cwd: ROOT, stdout: "ignore", stderr: "inherit" });
    if ((await add.exited) !== 0) throw new Error("could not create the temporary worktree.");
    // Turbopack refuses a node_modules symlink that points outside the project root, so the dependencies are
    // copied — as an APFS copy-on-write clone (`cp -c`, instant, no network); plain copy where cloning is unavailable.
    const clone = spawn(["cp", "-cR", join(ROOT, "node_modules"), join(worktree, "node_modules")], { stdout: "ignore", stderr: "ignore" });
    if ((await clone.exited) !== 0 && (await spawn(["cp", "-R", join(ROOT, "node_modules"), join(worktree, "node_modules")], { stdout: "ignore", stderr: "inherit" }).exited) !== 0) throw new Error("could not copy dependencies into the worktree.");
    console.log("[isolated-test] building the isolated app server (test values only)…");
    if ((await run(["--bun", "next", "build"], plan.env, worktree)) !== 0) throw new Error("isolated build failed.");
    app = spawn(["bun", "--no-env-file", "--bun", "next", "start", "-p", String(PORT)], { cwd: worktree, env: plan.env, stdout: "ignore", stderr: "inherit" });
    if (!(await waitFor(`${ORIGIN}/login`, 90_000))) throw new Error("isolated app server did not start.");
  }
  code = await run(cmd, plan.env);
} catch (e) {
  console.error(`[isolated-test] FAILED: ${e instanceof Error ? e.message : "unexpected error"}`);
  code = 2;
} finally {
  app?.kill();
  if (worktree) {
    await spawn(["git", "worktree", "remove", "--force", worktree], { cwd: ROOT, stdout: "ignore", stderr: "ignore" }).exited;
    rmSync(worktree, { recursive: true, force: true });
  }
}
process.exit(code);
