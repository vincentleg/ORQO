/**
 * Applies version-controlled SQL migrations from supabase/migrations/ to the
 * database in SUPABASE_DB_URL (loaded from .env.local by Bun).
 *
 *   bun run db:status    list applied and pending migrations
 *   bun run db:migrate   apply pending migrations, each in its own transaction
 *
 * Bookkeeping uses supabase_migrations.schema_migrations, the table the
 * Supabase CLI uses, so `supabase db push` stays compatible later. There is no
 * reset or down command: rollbacks in supabase/rollbacks/ are manual.
 * Connection details are never printed; errors report only a code and the
 * server's message.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "supabase", "migrations");
const FILE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

interface Migration {
  version: string;
  name: string;
  sql: string;
}

function describeError(e: unknown): string {
  if (typeof e !== "object" || e === null) return "unknown error";
  const err = e as { code?: unknown; errno?: unknown; message?: unknown };
  const code = typeof err.errno === "string" ? err.errno : typeof err.code === "string" ? err.code : "ERR";
  const message = typeof err.message === "string" ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>").slice(0, 300) : "";
  return `${code} ${message}`.trim();
}

async function load(): Promise<Migration[]> {
  const names = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
  const migrations: Migration[] = [];
  for (const file of names) {
    const m = FILE.exec(file);
    if (!m) throw new Error(`Unexpected migration file name: ${file}`);
    migrations.push({ version: m[1], name: m[2], sql: await Bun.file(join(DIR, file)).text() });
  }
  return migrations;
}

const command = process.argv[2] ?? "status";
if (command !== "status" && command !== "up") {
  console.error(`Unknown command "${command}". Use "status" or "up".`);
  process.exit(2);
}
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set (expected in .env.local).");
  process.exit(2);
}

const sql = new Bun.SQL(url, { max: 1, connectionTimeout: 15 });
let exitCode = 0;
try {
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
  `);
  const applied = new Map<string, string>(
    // Only rows written by this runner hold the whole file as one statement; CLI rows are split per statement.
    (await sql`select version, case when array_length(statements, 1) = 1 then statements[1] else '' end as body from supabase_migrations.schema_migrations`).map(
      (r: { version: string; body: string }) => [r.version, r.body],
    ),
  );
  const migrations = await load();

  for (const m of migrations) {
    const body = applied.get(m.version);
    if (body !== undefined && body !== "" && body !== m.sql) {
      throw new Error(`Migration ${m.version}_${m.name} was edited after it was applied. Add a new migration instead.`);
    }
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  for (const m of migrations) console.log(`${applied.has(m.version) ? "applied" : "pending"}  ${m.version}_${m.name}`);
  const unknown = [...applied.keys()].filter((v) => !migrations.some((m) => m.version === v));
  for (const v of unknown) console.log(`applied  ${v} (not in repository)`);

  if (command === "up") {
    if (pending.length === 0) console.log("Nothing to apply.");
    for (const m of pending) {
      await sql.begin(async (tx) => {
        await tx.unsafe(m.sql);
        await tx`insert into supabase_migrations.schema_migrations (version, name, statements) values (${m.version}, ${m.name}, array[${m.sql}::text])`;
      });
      console.log(`✓ applied ${m.version}_${m.name}`);
    }
  }
} catch (e) {
  console.error(`✗ ${e instanceof Error && !("errno" in e) && !("code" in e) ? e.message : describeError(e)}`);
  exitCode = 1;
} finally {
  await sql.close();
}
process.exit(exitCode);
