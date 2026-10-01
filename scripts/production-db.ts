/**
 * Phase 13 Stage G: ORQO PRODUCTION database operator tooling.
 *
 *   bun run prod:db check                    guard only (no network)
 *   bun run prod:db status                   READ-ONLY: applied / pending repository migrations
 *   bun run prod:db inspect                  READ-ONLY: schema, RLS, policies, row counts (numbers only)
 *   bun run prod:db apply --confirm=<last4>  apply pending REPOSITORY migrations (scripts/db-migrate.ts up)
 *
 * Reads ONLY `.env.orqo-production` (never .env.local, .env.test.local or the
 * inherited environment) and is guarded by scripts/production-guard.ts. The
 * read-only commands run inside a READ ONLY transaction, so they cannot create
 * or change anything (unlike `db-migrate.ts status`, which creates its
 * bookkeeping table). `apply` requires the masked project suffix as explicit
 * confirmation, refuses an unexpected starting state, never seeds data and
 * never runs tests. Credentials and the database URL are never printed.
 */
import { spawn } from "bun";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnvFile } from "../tests/support/isolated-env";
import { PRODUCTION_ENV_FILE } from "../tests/support/safety";
import { planProductionTarget, ProductionGuardError, type ProductionTarget } from "./production-guard";

const ROOT = resolve(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const read = (f: string) => (existsSync(join(ROOT, f)) ? parseEnvFile(readFileSync(join(ROOT, f), "utf8")) : {});

function stop(message: string, code = 2): never {
  console.error(`[prod-db] REFUSED: ${message}`);
  process.exit(code);
}

const command = process.argv[2] ?? "check";
if (!["check", "status", "inspect", "apply"].includes(command)) stop(`unknown command "${command}". Use check, status, inspect or apply.`);
if (!existsSync(join(ROOT, PRODUCTION_ENV_FILE))) stop(`${PRODUCTION_ENV_FILE} does not exist.`);

let target: ProductionTarget;
try {
  // Other environments are read only to REFUSE their projects, never as a source of values.
  target = planProductionTarget({ prod: read(PRODUCTION_ENV_FILE), others: [read(".env.local"), read(".env.test.local")] });
} catch (e) {
  stop(e instanceof ProductionGuardError ? e.message : "could not read the environment files.");
}
console.log(`[prod-db] target: ORQO PRODUCTION ${target.maskedRef} — guard passed (distinct from development and test).`);
if (command === "check") process.exit(0);

const repo = readdirSync(MIGRATIONS)
  .map((f) => f.match(/^(\d{14})_([a-z0-9_]+)\.sql$/))
  .filter((m): m is RegExpMatchArray => Boolean(m))
  .map((m) => ({ version: m[1], name: m[2] }))
  .sort((a, b) => a.version.localeCompare(b.version));

interface State {
  applied: string[];
  publicTables: number;
  rlsTables: number;
  policies: number;
  publicRows: number;
  authUsers: number;
}

/** Everything in one READ ONLY transaction: nothing can be created or changed. */
async function readState(): Promise<State> {
  const sql = new Bun.SQL(target.dbUrl, { max: 1, connectionTimeout: 15 });
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe("set transaction read only");
      const [{ t }] = await tx`select to_regclass('supabase_migrations.schema_migrations')::text as t`;
      const applied = t ? (await tx`select version from supabase_migrations.schema_migrations order by version`).map((r: { version: string }) => r.version) : [];
      const tables = await tx`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`;
      let publicRows = 0;
      for (const r of tables as { relname: string }[]) publicRows += Number((await tx.unsafe(`select count(*)::int as n from public."${r.relname.replace(/"/g, '""')}"`))[0].n);
      const [{ p }] = await tx`select count(*)::int as p from pg_policies where schemaname = 'public'`;
      const [{ u }] = await tx`select count(*)::int as u from auth.users`;
      return {
        applied,
        publicTables: tables.length,
        rlsTables: (tables as { relrowsecurity: boolean }[]).filter((r) => r.relrowsecurity).length,
        policies: Number(p),
        publicRows,
        authUsers: Number(u),
      };
    });
  } finally {
    await sql.close();
  }
}

function describe(s: State) {
  const pending = repo.filter((m) => !s.applied.includes(m.version));
  const unknown = s.applied.filter((v) => !repo.some((m) => m.version === v));
  for (const m of repo) console.log(`${s.applied.includes(m.version) ? "applied" : "pending"}  ${m.version}_${m.name}`);
  for (const v of unknown) console.log(`applied  ${v} (NOT in repository)`);
  console.log(`[prod-db] repository migrations: ${repo.length} · applied: ${repo.length - pending.length} · pending: ${pending.length} · unknown: ${unknown.length}`);
  return { pending, unknown };
}

function describeError(e: unknown): string {
  const err = e as { code?: unknown; errno?: unknown; message?: unknown };
  const code = typeof err?.errno === "string" ? err.errno : typeof err?.code === "string" ? err.code : "ERR";
  return `${code} ${typeof err?.message === "string" ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>").slice(0, 200) : ""}`;
}

let state: State;
try {
  state = await readState();
} catch (e) {
  stop(`read-only check failed: ${describeError(e)}`, 1);
}

if (command === "status") {
  describe(state);
  process.exit(0);
}
if (command === "inspect") {
  describe(state);
  console.log(`[prod-db] public tables: ${state.publicTables} · RLS enabled: ${state.rlsTables} · policies: ${state.policies} · rows in public tables: ${state.publicRows} · auth users: ${state.authUsers}`);
  process.exit(0);
}

// apply
const confirm = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
if (confirm !== target.confirmCode) stop(`explicit confirmation required: --confirm=<last 4 characters of the production ref> (${target.maskedRef}).`);
const { pending, unknown } = describe(state);
if (unknown.length > 0) stop("production has migrations that are not in this repository; investigate before applying.");
if (pending.length === 0) {
  console.log("[prod-db] nothing to apply.");
  process.exit(0);
}
// A partially migrated database must have applied a prefix of the repository order.
const appliedRepo = repo.filter((m) => state.applied.includes(m.version));
if (appliedRepo.some((m) => m.version > pending[0].version)) stop("migration history is out of order; investigate before applying.");
if (state.applied.length === 0 && (state.publicTables > 0 || state.publicRows > 0)) stop("no migrations recorded but the public schema is not empty; investigate before applying.");

console.log(`[prod-db] applying ${pending.length} repository migration(s) to ORQO PRODUCTION ${target.maskedRef}…`);
// The proven runner, with ONLY the production database URL; --no-env-file prevents any .env auto-load.
const child = spawn(["bun", "--no-env-file", join(ROOT, "scripts", "db-migrate.ts"), "up"], {
  cwd: ROOT,
  env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SUPABASE_DB_URL: target.dbUrl },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
