import "server-only";
/**
 * Recovery (Nov 2026): the PostgreSQL connection and the request-scoped database handle (`Db`).
 *
 * A `Db` acts as ONE identity:
 *   - userDb(userId): role `authenticated`, auth.uid() = userId → every query is filtered by RLS;
 *   - anonDb():       role `anon`, auth.uid() = NULL → RLS denies all tenant data.
 * Each statement runs in its own short transaction (the same unit of work PostgREST used), with
 *   set_config('role', …, true)                     — the switch to the unprivileged role,
 *   set_config('request.jwt.claim.sub', …, true)    — the identity read by auth.uid(),
 *   set_config('statement_timeout', …, true)        — a hard per-statement limit,
 * all transaction-local, so a pooled connection (Neon / PgBouncer transaction mode) never leaks an identity.
 *
 * The owner connection itself is used directly only by the account/session module (auth.* tables, which the
 * application roles cannot read) — see src/lib/server/auth/accounts.ts.
 */
import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { recordOperation } from "@/lib/server/observability";
import { QueryBuilder, RpcBuilder, type Catalog, type Compiled, type Executor, type FunctionInfo } from "./postgrest";
import { databaseUrl } from "./config";

const STATEMENT_TIMEOUT_MS = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const globalForPool = globalThis as unknown as { __orqoPool?: Pool; __orqoCatalog?: Promise<Catalog> };

/** The shared pool (one per server instance). Small on purpose: serverless instances are many and short-lived. */
export function pool(): Pool {
  if (!globalForPool.__orqoPool) {
    const p = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.ORQO_DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      // Neon may close idle connections; errors on idle clients must not crash the process.
      allowExitOnIdle: true,
    });
    p.on("error", (e) => console.error("[orqo] idle database client error", e instanceof Error ? e.name : typeof e));
    // Vercel Fluid compute: release idle pool clients before the function instance suspends (Neon guidance).
    // A no-op outside Vercel.
    attachDatabasePool(p);
    globalForPool.__orqoPool = p;
  }
  return globalForPool.__orqoPool;
}

/** Test/maintenance hook: closes the pool so a process can exit. */
export async function closePool(): Promise<void> {
  const p = globalForPool.__orqoPool;
  globalForPool.__orqoPool = undefined;
  globalForPool.__orqoCatalog = undefined;
  if (p) await p.end();
}

async function loadCatalog(): Promise<Catalog> {
  const client = await pool().connect();
  try {
    const fks = await client.query<{ table: string; columns: string[]; ref_table: string; ref_columns: string[] }>(`
      select c.conrelid::regclass::text as table, c.confrelid::regclass::text as ref_table,
             array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as columns,
             array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as ref_columns
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'f' and n.nspname = 'public'`);
    const pks = await client.query<{ table: string; columns: string[] }>(`
      select c.conrelid::regclass::text as table,
             array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as columns
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'p' and n.nspname = 'public'`);
    const fns = await client.query<{ name: string; arg_names: string[] | null; arg_types: string[]; returns_set: boolean; returns_void: boolean }>(`
      select p.proname::text as name, p.proargnames::text[] as arg_names,
             array(select t::regtype::text from unnest(p.proargtypes) t) as arg_types,
             p.proretset as returns_set, p.prorettype = 'void'::regtype as returns_void
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'`);
    const strip = (t: string) => t.replace(/^public\./, "").replace(/^"(.*)"$/, "$1");
    const functions = new Map<string, FunctionInfo[]>();
    for (const f of fns.rows) {
      // proargnames includes OUT/TABLE columns after the inputs; only the first n (input) names are arguments.
      const argNames = (f.arg_names ?? []).slice(0, f.arg_types.length);
      const info: FunctionInfo = { name: f.name, argNames, argTypes: f.arg_types, returnsSet: f.returns_set, returnsVoid: f.returns_void };
      functions.set(f.name, [...(functions.get(f.name) ?? []), info]);
    }
    return {
      foreignKeys: fks.rows.map((r) => ({ table: strip(r.table), columns: r.columns, refTable: strip(r.ref_table), refColumns: r.ref_columns })),
      primaryKeys: new Map(pks.rows.map((r) => [strip(r.table), r.columns])),
      functions,
    };
  } finally {
    client.release();
  }
}

function catalog(): Promise<Catalog> {
  if (!globalForPool.__orqoCatalog) {
    globalForPool.__orqoCatalog = loadCatalog().catch((e) => {
      globalForPool.__orqoCatalog = undefined;
      throw e;
    });
  }
  return globalForPool.__orqoCatalog;
}

/** Runs `fn` in one transaction as the given identity (null = anon). Exported for the few multi-statement needs. */
export async function asIdentity<T>(userId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  let broken: Error | undefined;
  try {
    // One round trip: BEGIN and the transaction-local identity. Only constants and a UUID validated against a
    // strict pattern are inlined (never caller text); everything the statement itself uses stays parameterized.
    if (userId !== null && !UUID.test(userId)) throw new Error("Invalid user id.");
    await client.query(
      `begin; select set_config('role', '${userId ? "authenticated" : "anon"}', true), set_config('request.jwt.claim.sub', '${userId ?? ""}', true), set_config('statement_timeout', '${STATEMENT_TIMEOUT_MS}', true)`,
    );
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch((re) => {
      broken = re instanceof Error ? re : new Error("rollback failed");
    });
    throw e;
  } finally {
    client.release(broken);
  }
}

/** True for errors that mean the database could not be reached (not a SQL error such as an RLS denial). */
export function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  if (typeof code === "string" && /^(08|57P0|53)/.test(code)) return true; // connection exception, shutdown, resources
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) return true; // ECONNREFUSED, ENOTFOUND, ETIMEDOUT…
  return e instanceof Error && /timeout exceeded when trying to connect|Connection terminated/i.test(e.message);
}

function executorFor(userId: string | null): Executor {
  return {
    catalog,
    run: async (c: Compiled) => {
      try {
        return await asIdentity(userId, async (client) => (await client.query(c.sql, c.params)).rows[0] as Record<string, unknown> | undefined);
      } catch (e) {
        // An outage must be visible at ERROR level (the Supabase outage was only logged as a warning).
        if (isConnectionError(e)) recordOperation({ operation: "db.connect", outcome: "unavailable", errorCategory: "database_unreachable" });
        throw e;
      }
    },
  };
}

/** The request-scoped database handle: the supabase-js query surface ORQO uses, enforced by RLS. */
export class Db {
  private readonly executor: Executor;
  constructor(readonly userId: string | null) {
    this.executor = executorFor(userId);
  }
  from(table: string): QueryBuilder {
    return new QueryBuilder(this.executor, table);
  }
  rpc(name: string, args: Record<string, unknown> = {}): RpcBuilder {
    return new RpcBuilder(this.executor, name, args);
  }
}

export function userDb(userId: string): Db {
  if (!UUID.test(userId)) throw new Error("userDb needs a user id.");
  return new Db(userId);
}

export function anonDb(): Db {
  return new Db(null);
}
