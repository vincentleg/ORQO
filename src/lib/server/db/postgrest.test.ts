/**
 * The PostgREST-compatible compiler: identifiers are validated and quoted, values are always bound parameters,
 * unsupported syntax fails loudly. (Behaviour against a real database is covered by the 260+ tests in tests/db.)
 */
import { describe, expect, test } from "bun:test";
import { parseSelect, QueryBuilder, RpcBuilder, type Catalog, type Executor } from "./postgrest";

const catalog: Catalog = {
  foreignKeys: [
    { table: "organization_memberships", columns: ["organization_id"], refTable: "organizations", refColumns: ["id"] },
    { table: "opportunity_participants", columns: ["opportunity_id"], refTable: "opportunities", refColumns: ["id"] },
    { table: "opportunity_participants", columns: ["organization_id", "opportunity_id"], refTable: "opportunities", refColumns: ["organization_id", "id"] },
  ],
  primaryKeys: new Map([["companies", ["id"]]]),
  functions: new Map([["create_organization", [{ name: "create_organization", argNames: ["org_name", "settings"], argTypes: ["text", "jsonb"], returnsSet: false, returnsVoid: false }]]]),
};
const noExec: Executor = { catalog: async () => catalog, run: async () => undefined };
const q = (table: string) => new QueryBuilder(noExec, table);

describe("select compilation", () => {
  test("filters become bound parameters; identifiers are quoted", () => {
    const c = q("companies").select("id, name").eq("organization_id", "o1").neq("name", "x'; drop table companies; --").in("id", ["a", "b"]).order("created_at", { ascending: false }).limit(5).compile(catalog)!;
    expect(c.params).toEqual(["o1", "x'; drop table companies; --", ["a", "b"]]);
    expect(c.sql).toContain('_b."organization_id" = $1');
    expect(c.sql).toContain('_b."id" = any($3)');
    expect(c.sql).toContain('order by _b."created_at" desc limit 5');
    expect(c.sql).not.toContain("drop table");
  });

  test("hostile identifiers are refused, never interpolated", () => {
    expect(() => q('companies"; drop table x; --')).toThrow("Invalid identifier");
    expect(() => q("companies").eq("id = 1 or 1", 1)).toThrow("Invalid identifier");
    expect(() => q("companies").select("id, (select 1)").compile(catalog)).toThrow();
    expect(() => q("companies").order("name desc; --")).toThrow("Invalid identifier");
  });

  test("is / not-is / empty in", () => {
    const c = q("contacts").select("id").is("company_id", null).not("event_id", "is", null).in("id", []).compile(catalog)!;
    expect(c.sql).toContain('_b."company_id" is null');
    expect(c.sql).toContain('_b."event_id" is not null');
    expect(c.sql).toContain("false");
    expect(() => q("contacts").not("x", "eq", 1)).toThrow("not supported");
  });

  test("embedded resources resolve through foreign keys, preferring the composite same-organization key", () => {
    const toOne = q("organization_memberships").select("role, organizations!inner(id, name)").compile(catalog)!;
    expect(toOne.sql).toContain("row_to_json");
    expect(toOne.sql).toContain('exists (select 1 from public."organizations" _e where _e."id" = _b."organization_id")');
    const toMany = q("opportunities").select("id, opportunity_participants(company_id, role)").compile(catalog)!;
    expect(toMany.sql).toContain("json_agg");
    expect(toMany.sql).toContain('_e."organization_id" = _b."organization_id" and _e."opportunity_id" = _b."id"');
    expect(() => q("companies").select("id, opportunities(id)").compile(catalog)).toThrow("No relationship");
  });

  test("count head compiles to a count only", () => {
    const c = q("research_runs").select("id", { count: "exact", head: true }).eq("mode", "deep").compile(catalog)!;
    expect(c.sql).toContain("count(*)");
    expect(c.sql).toContain("null::json as data");
  });
});

describe("mutations", () => {
  test("insert sends rows as one JSON parameter; RETURNING names the target", () => {
    const c = q("companies").insert([{ name: "A", website: null }, { name: "B" }]).select("id").compile(catalog)!;
    expect(c.params).toEqual([JSON.stringify([{ name: "A", website: null }, { name: "B" }])]);
    expect(c.sql).toContain('insert into public."companies" as _t ("name", "website")');
    expect(c.sql).toContain("returning _t.*");
  });

  test("update sets only the given columns; upsert and ignoreDuplicates", () => {
    const u = q("profiles").update({ locale: "fr", ignored: undefined }).eq("id", "u1").compile(catalog)!;
    expect(u.sql).toContain('set "locale" = _v."locale"');
    expect(u.sql).not.toContain("ignored");
    const up = q("companies").upsert({ id: "c1", name: "A" }).compile(catalog)!;
    expect(up.sql).toContain('on conflict ("id") do update set "name" = excluded."name"');
    const ign = q("company_signals").upsert([{ a: 1 }], { onConflict: "organization_id,dedup_key", ignoreDuplicates: true }).compile(catalog)!;
    expect(ign.sql).toContain('on conflict ("organization_id", "dedup_key") do nothing');
    expect(() => q("profiles").update({}).compile(catalog)).toThrow();
  });

  test("an empty insert is a no-op", () => {
    expect(q("companies").insert([]).compile(catalog)).toBeNull();
  });
});

describe("rpc", () => {
  test("named, typed arguments; json arguments are serialized; unknown functions fail", () => {
    const c = new RpcBuilder(noExec, "create_organization", { org_name: "Acme", settings: { a: [1] } }).compile(catalog);
    expect(c.sql).toBe('select to_json(public."create_organization"("org_name" => $1::text, "settings" => $2::jsonb)) as data');
    expect(c.params).toEqual(["Acme", '{"a":[1]}']);
    expect(() => new RpcBuilder(noExec, "create_organization", { evil: 1 }).compile(catalog)).toThrow();
    expect(() => new RpcBuilder(noExec, "nope", {}).compile(catalog)).toThrow();
  });
});

test("select lists parse", () => {
  expect(parseSelect("*")).toEqual([{ kind: "star" }]);
  expect(parseSelect("id,\n  name")).toEqual([{ kind: "column", name: "id" }, { kind: "column", name: "name" }]);
  expect(() => parseSelect("a(b(c))")).toThrow("Nested");
});
