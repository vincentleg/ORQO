/**
 * Recovery (Nov 2026): a PostgREST-compatible query builder over plain PostgreSQL.
 *
 * ORQO's repositories were written against supabase-js (`db.from(t).select(...).eq(...)`, `db.rpc(...)`). This
 * module keeps that exact surface — the subset ORQO uses — and compiles it to parameterized SQL, so the business
 * logic and its 140+ call sites are unchanged. Results are produced by PostgreSQL itself with json_agg / to_json,
 * the same serialization PostgREST uses, so timestamps, numerics, arrays and jsonb keep their former JSON shapes.
 *
 * Security: identifiers are validated against a strict pattern and always quoted; every value is a bound
 * parameter. The executor (client.ts) runs each statement in its own transaction as role `authenticated`
 * (or `anon`) with the user id set for auth.uid(), so Row Level Security decides what is visible, exactly as
 * with PostgREST.
 *
 * Supported: select (columns, *, one-level embedded resources `rel(cols)` / `rel!inner(cols)` resolved from
 * foreign keys), count exact/head, eq, neq, gt, gte, lt, lte, in, is, not(col,'is',v), like, ilike, match,
 * order (ascending, nullsFirst), limit, single, maybeSingle, insert, update, upsert (onConflict,
 * ignoreDuplicates), delete, returning via .select(), and rpc (named arguments, scalar / composite / set
 * results). Anything else fails loudly with code PGRST100 instead of silently returning wrong data.
 */

export interface DbError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

/** Same shape as a supabase-js response. `data` is untyped, as with the untyped Supabase client ORQO used. */
export interface DbResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  error: DbError | null;
  count: number | null;
  status: number;
}

export interface ForeignKey {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export interface FunctionInfo {
  name: string;
  argNames: string[];
  /** format_type of each argument, e.g. "uuid", "jsonb", "text[]", "org_role". */
  argTypes: string[];
  returnsSet: boolean;
  returnsVoid: boolean;
}

export interface Catalog {
  foreignKeys: ForeignKey[];
  primaryKeys: Map<string, string[]>;
  functions: Map<string, FunctionInfo[]>;
}

export interface Compiled {
  sql: string;
  params: unknown[];
}

export interface Executor {
  catalog(): Promise<Catalog>;
  /** Runs one statement under the caller's role; returns the first row. */
  run(compiled: Compiled): Promise<Record<string, unknown> | undefined>;
}

export class QueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export function ident(name: string): string {
  if (!IDENT.test(name)) throw new QueryError("PGRST100", `Invalid identifier: ${JSON.stringify(name).slice(0, 80)}`);
  return `"${name}"`;
}

// ---------------------------------------------------------------------------------------------------------
// Select-list parsing
// ---------------------------------------------------------------------------------------------------------

export type SelectItem = { kind: "star" } | { kind: "column"; name: string } | { kind: "embed"; relation: string; inner: boolean; columns: SelectItem[] };

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) throw new QueryError("PGRST100", "Unbalanced parentheses in select.");
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (depth !== 0) throw new QueryError("PGRST100", "Unbalanced parentheses in select.");
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export function parseSelect(columns: string, nested = false): SelectItem[] {
  const items: SelectItem[] = [];
  for (const part of splitTopLevel(columns.replace(/\s+/g, " "))) {
    if (part === "*") {
      items.push({ kind: "star" });
      continue;
    }
    const embed = /^([a-z_][a-z0-9_]*)(!inner)?\s*\((.*)\)$/.exec(part);
    if (embed) {
      if (nested) throw new QueryError("PGRST100", "Nested embedding is not supported.");
      items.push({ kind: "embed", relation: embed[1], inner: Boolean(embed[2]), columns: parseSelect(embed[3], true) });
      continue;
    }
    ident(part);
    items.push({ kind: "column", name: part });
  }
  if (items.length === 0) items.push({ kind: "star" });
  return items;
}

// ---------------------------------------------------------------------------------------------------------
// SQL compilation
// ---------------------------------------------------------------------------------------------------------

type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "isnot" | "like" | "ilike";
interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}
interface Order {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

const OPS: Record<Exclude<FilterOp, "in" | "is" | "isnot">, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };

function isLiteral(v: unknown): v is null | boolean {
  return v === null || v === true || v === false;
}

function filterSql(alias: string, f: Filter, p: Params): string {
  const col = `${alias}.${ident(f.column)}`;
  switch (f.op) {
    case "in": {
      if (!Array.isArray(f.value)) throw new QueryError("PGRST100", "in() needs an array.");
      if (f.value.length === 0) return "false";
      return `${col} = any(${p.add(f.value.map((v) => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : v)))})`;
    }
    case "is":
    case "isnot": {
      if (!isLiteral(f.value)) throw new QueryError("PGRST100", "is() accepts null, true or false.");
      return `${col} is ${f.op === "isnot" ? "not " : ""}${f.value === null ? "null" : String(f.value)}`;
    }
    default: {
      // supabase-js would send eq.null as the string "null"; treat a null value as SQL NULL semantics instead.
      if (f.value === null || f.value === undefined) return f.op === "neq" ? `${col} is not null` : f.op === "eq" ? `${col} is null` : "false";
      const value = typeof f.value === "object" ? JSON.stringify(f.value) : f.value;
      return `${col} ${OPS[f.op]} ${p.add(value)}`;
    }
  }
}

function relation(catalog: Catalog, base: string, rel: string): { many: boolean; on: (b: string, e: string) => string } {
  const toOne = catalog.foreignKeys.filter((fk) => fk.table === base && fk.refTable === rel);
  const toMany = catalog.foreignKeys.filter((fk) => fk.table === rel && fk.refTable === base);
  const candidates = [...toOne.map((fk) => ({ fk, many: false })), ...toMany.map((fk) => ({ fk, many: true }))];
  if (candidates.length === 0) throw new QueryError("PGRST200", `No relationship between ${base} and ${rel}.`);
  // Several foreign keys can link the same pair (e.g. a plain id FK plus a composite same-organization FK).
  // They all describe the same link when one's columns include the other's; use the most specific (composite).
  candidates.sort((a, b) => b.fk.columns.length - a.fk.columns.length);
  const best = candidates[0];
  const compatible = candidates.every((c) => c.many === best.many && c.fk.columns.every((col) => best.fk.columns.includes(col)));
  if (!compatible) throw new QueryError("PGRST201", `More than one relationship between ${base} and ${rel}.`);
  const { fk, many } = best;
  return {
    many,
    on: (b, e) =>
      fk.columns
        .map((c, i) => (many ? `${e}.${ident(c)} = ${b}.${ident(fk.refColumns[i])}` : `${e}.${ident(fk.refColumns[i])} = ${b}.${ident(c)}`))
        .join(" and "),
  };
}

function plainColumns(items: SelectItem[]): string {
  return items.map((i) => (i.kind === "star" ? "_e.*" : i.kind === "column" ? `_e.${ident(i.name)}` : (() => { throw new QueryError("PGRST100", "Nested embedding is not supported."); })())).join(", ");
}

function projection(catalog: Catalog, table: string, items: SelectItem[], innerJoins: string[]): string {
  return items
    .map((item) => {
      if (item.kind === "star") return "_b.*";
      if (item.kind === "column") return `_b.${ident(item.name)}`;
      const r = relation(catalog, table, item.relation);
      const source = `from public.${ident(item.relation)} _e where ${r.on("_b", "_e")}`;
      if (item.inner) innerJoins.push(`exists (select 1 ${source})`);
      const sub = r.many
        ? `coalesce((select json_agg(_s) from (select ${plainColumns(item.columns)} ${source}) _s), '[]'::json)`
        : `(select row_to_json(_s) from (select ${plainColumns(item.columns)} ${source} limit 1) _s)`;
      return `${sub} as ${ident(item.relation)}`;
    })
    .join(", ");
}

type Cardinality = "many" | "single" | "maybe";
type Action = "select" | "insert" | "update" | "upsert" | "delete";

/**
 * The builder. Methods return `this`, so `let q = db.from(t).select(c); if (x) q = q.eq(...)` keeps working, and
 * it is a PromiseLike, so `await` executes it.
 */
export class QueryBuilder implements PromiseLike<DbResult> {
  private action: Action = "select";
  private columns = "*";
  private returning: string | null = null;
  private countExact = false;
  private head = false;
  private readonly filters: Filter[] = [];
  private readonly orders: Order[] = [];
  private limitCount: number | null = null;
  private values: Record<string, unknown>[] = [];
  private onConflict: string | null = null;
  private ignoreDuplicates = false;
  private cardinality: Cardinality = "many";

  constructor(
    private readonly executor: Executor,
    private readonly table: string,
  ) {
    ident(table);
  }

  select(columns = "*", opts?: { count?: "exact"; head?: boolean }): this {
    if (this.action === "select") {
      this.columns = columns;
      if (opts?.count) {
        if (opts.count !== "exact") throw new QueryError("PGRST100", "Only count: 'exact' is supported.");
        this.countExact = true;
      }
      this.head = Boolean(opts?.head);
    } else this.returning = columns;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.action = "insert";
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.action = "upsert";
    this.values = Array.isArray(values) ? values : [values];
    this.onConflict = opts?.onConflict ?? null;
    this.ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.action = "update";
    this.values = [values];
    return this;
  }

  delete(): this {
    this.action = "delete";
    return this;
  }

  private push(column: string, op: FilterOp, value: unknown): this {
    ident(column);
    this.filters.push({ column, op, value });
    return this;
  }
  eq(column: string, value: unknown): this {
    return this.push(column, "eq", value);
  }
  neq(column: string, value: unknown): this {
    return this.push(column, "neq", value);
  }
  gt(column: string, value: unknown): this {
    return this.push(column, "gt", value);
  }
  gte(column: string, value: unknown): this {
    return this.push(column, "gte", value);
  }
  lt(column: string, value: unknown): this {
    return this.push(column, "lt", value);
  }
  lte(column: string, value: unknown): this {
    return this.push(column, "lte", value);
  }
  like(column: string, pattern: string): this {
    return this.push(column, "like", pattern);
  }
  ilike(column: string, pattern: string): this {
    return this.push(column, "ilike", pattern);
  }
  in(column: string, values: readonly unknown[]): this {
    return this.push(column, "in", [...values]);
  }
  is(column: string, value: null | boolean): this {
    return this.push(column, "is", value);
  }
  not(column: string, operator: string, value: unknown): this {
    if (operator !== "is") throw new QueryError("PGRST100", `not(${operator}) is not supported.`);
    return this.push(column, "isnot", value);
  }
  match(query: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(query)) this.eq(k, v);
    return this;
  }
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    ident(column);
    this.orders.push({ column, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(count: number): this {
    if (!Number.isInteger(count) || count < 0) throw new QueryError("PGRST100", "limit() needs a non-negative integer.");
    this.limitCount = count;
    return this;
  }
  single(): this {
    this.cardinality = "single";
    return this;
  }
  maybeSingle(): this {
    this.cardinality = "maybe";
    return this;
  }

  /** Compiles to SQL (exported for unit tests). */
  compile(catalog: Catalog): Compiled | null {
    const p = new Params();
    const t = `public.${ident(this.table)}`;
    const where = (alias: string, extra: string[] = []) => {
      const parts = [...this.filters.map((f) => filterSql(alias, f, p)), ...extra];
      return parts.length ? ` where ${parts.join(" and ")}` : "";
    };

    if (this.action === "select") {
      const inner: string[] = [];
      const proj = projection(catalog, this.table, parseSelect(this.columns), inner);
      const w = where("_b", inner);
      const order = this.orders.length
        ? ` order by ${this.orders.map((o) => `_b.${ident(o.column)} ${o.ascending ? "asc" : "desc"}${o.nullsFirst === undefined ? "" : o.nullsFirst ? " nulls first" : " nulls last"}`).join(", ")}`
        : "";
      const limit = this.limitCount === null ? "" : ` limit ${this.limitCount}`;
      const count = this.countExact ? `(select count(*)::bigint from ${t} _b${w})` : "null::bigint";
      if (this.head) return { sql: `select null::json as data, ${count} as count`, params: p.values };
      return { sql: `select coalesce((select json_agg(_r) from (select ${proj} from ${t} _b${w}${order}${limit}) _r), '[]'::json) as data, ${count} as count`, params: p.values };
    }

    // RETURNING with embedded resources (PostgREST supports them): the same projection, over the modified rows.
    // An `!inner` embed filters the returned rows only (the modification itself is not filtered by it).
    const retInner: string[] = [];
    const ret = this.returning === null ? null : projection(catalog, this.table, parseSelect(this.returning), retInner);
    const retWhere = retInner.length ? ` where ${retInner.join(" and ")}` : "";
    // `target` is the alias of the modified table: RETURNING must name it (an UPDATE … FROM also exposes the
    // source row's columns, which would make `*` ambiguous).
    const wrap = (cte: string, target: string) =>
      ret === null
        ? { sql: `with _m as (${cte} returning 1) select null::json as data, null::bigint as count`, params: p.values }
        : { sql: `with _b as (${cte} returning ${target}.*) select coalesce((select json_agg(_r) from (select ${ret} from _b${retWhere}) _r), '[]'::json) as data, null::bigint as count`, params: p.values };

    if (this.action === "delete") return wrap(`delete from ${t} as _b${where("_b")}`, "_b");

    if (this.action === "update") {
      const keys = Object.keys(this.values[0] ?? {}).filter((k) => this.values[0][k] !== undefined);
      if (keys.length === 0) throw new QueryError("PGRST100", "update() needs at least one column.");
      const json = p.add(JSON.stringify(this.values[0]));
      const set = keys.map((k) => `${ident(k)} = _v.${ident(k)}`).join(", ");
      return wrap(`update ${t} as _b set ${set} from json_populate_record(null::${t}, ${json}::json) _v${where("_b")}`, "_b");
    }

    // insert / upsert
    if (this.values.length === 0) return null;
    const keys = [...new Set(this.values.flatMap((v) => Object.keys(v).filter((k) => v[k] !== undefined)))];
    if (keys.length === 0) throw new QueryError("PGRST100", "insert() needs at least one column.");
    const cols = keys.map(ident).join(", ");
    const json = p.add(JSON.stringify(this.values));
    let conflict = "";
    if (this.action === "upsert") {
      const target = this.onConflict ? this.onConflict.split(",").map((c) => c.trim()) : catalog.primaryKeys.get(this.table);
      if (!target || target.length === 0) throw new QueryError("PGRST100", `upsert on ${this.table} needs onConflict.`);
      const updates = keys.filter((k) => !target.includes(k));
      conflict =
        this.ignoreDuplicates || updates.length === 0
          ? ` on conflict (${target.map(ident).join(", ")}) do nothing`
          : ` on conflict (${target.map(ident).join(", ")}) do update set ${updates.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`;
    }
    return wrap(`insert into ${t} as _t (${cols}) select ${cols} from json_populate_recordset(null::${t}, ${json}::json)${conflict}`, "_t");
  }

  async execute(): Promise<DbResult> {
    try {
      const compiled = this.compile(await this.executor.catalog());
      if (compiled === null) return { data: this.returning === null ? null : [], error: null, count: null, status: 201 };
      const row = await this.executor.run(compiled);
      const rows = (row?.data ?? null) as Record<string, unknown>[] | null;
      const count = row?.count === null || row?.count === undefined ? null : Number(row.count);
      if (this.cardinality !== "many") {
        const list = rows ?? [];
        if (list.length > 1 || (list.length === 0 && this.cardinality === "single")) {
          return { data: null, error: { code: "PGRST116", message: `JSON object requested, ${list.length} rows returned`, details: null, hint: null }, count, status: 406 };
        }
        return { data: list[0] ?? null, error: null, count, status: 200 };
      }
      return { data: rows, error: null, count, status: this.action === "select" ? 200 : 201 };
    } catch (e) {
      return { data: null, error: toDbError(e), count: null, status: 400 };
    }
  }

  then<R1 = DbResult, R2 = never>(onfulfilled?: ((value: DbResult) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

/** db.rpc(name, args): calls public.<name>(arg => value, ...). */
export class RpcBuilder implements PromiseLike<DbResult> {
  private cardinality: Cardinality = "many";
  constructor(
    private readonly executor: Executor,
    private readonly name: string,
    private readonly args: Record<string, unknown>,
  ) {}

  single(): this {
    this.cardinality = "single";
    return this;
  }
  maybeSingle(): this {
    this.cardinality = "maybe";
    return this;
  }

  compile(catalog: Catalog): Compiled {
    const overloads = catalog.functions.get(this.name) ?? [];
    const keys = Object.keys(this.args).filter((k) => this.args[k] !== undefined);
    const fn = overloads.find((f) => keys.every((k) => f.argNames.includes(k)));
    if (!fn) throw new QueryError("PGRST202", `Could not find the function public.${this.name} with these arguments.`);
    const p = new Params();
    const named = keys.map((k) => {
      const type = fn.argTypes[fn.argNames.indexOf(k)];
      const v = this.args[k];
      const json = type === "json" || type === "jsonb";
      return `${ident(k)} => ${p.add(v === null ? null : json ? JSON.stringify(v) : typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v)}::${type}`;
    });
    const call = `public.${ident(this.name)}(${named.join(", ")})`;
    if (fn.returnsVoid) return { sql: `select null::json as data from (select ${call}) _v`, params: p.values };
    if (fn.returnsSet) return { sql: `select coalesce((select json_agg(_r) from ${call} _r), '[]'::json) as data`, params: p.values };
    return { sql: `select to_json(${call}) as data`, params: p.values };
  }

  async execute(): Promise<DbResult> {
    try {
      const row = await this.executor.run(this.compile(await this.executor.catalog()));
      let data = row?.data ?? null;
      if (this.cardinality !== "many" && Array.isArray(data)) {
        if (data.length > 1 || (data.length === 0 && this.cardinality === "single")) {
          return { data: null, error: { code: "PGRST116", message: `JSON object requested, ${data.length} rows returned`, details: null, hint: null }, count: null, status: 406 };
        }
        data = data[0] ?? null;
      }
      return { data, error: null, count: null, status: 200 };
    } catch (e) {
      return { data: null, error: toDbError(e), count: null, status: 400 };
    }
  }

  then<R1 = DbResult, R2 = never>(onfulfilled?: ((value: DbResult) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

/** PostgreSQL / builder error → the PostgrestError shape (code = SQLSTATE), never a connection string. */
export function toDbError(e: unknown): DbError {
  if (e instanceof QueryError) return { code: e.code, message: e.message, details: null, hint: null };
  const err = (typeof e === "object" && e !== null ? e : {}) as { code?: unknown; message?: unknown; detail?: unknown; hint?: unknown };
  const message = typeof err.message === "string" ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>").slice(0, 500) : "Database error.";
  const code = typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code) ? err.code : "PGRST000";
  return { code, message, details: typeof err.detail === "string" ? err.detail.slice(0, 500) : null, hint: typeof err.hint === "string" ? err.hint.slice(0, 500) : null };
}
