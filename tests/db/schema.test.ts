/** Structural checks on the migrated database, via the direct Postgres connection. */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { LOCALES } from "@/lib/i18n/config";
import { LIFECYCLE_STAGES, NEED_INTENSITIES, PARTICIPANT_ROLES, RELATIONSHIP_STATUSES, SOURCE_KINDS, VISIBILITIES } from "@/lib/server/orqo/schemas";
import { RESEARCH_MODES } from "@/lib/server/research/types";
import { ORG_ROLES } from "@/lib/server/tenancy/roles";
import { sql } from "../support/supabase";

const PUBLIC_TABLES = [
  "agent_approvals",
  "agent_missions",
  "agent_run_steps",
  "agent_run_tool_calls",
  "agent_runs",
  "analysis_runs",
  "audit_events",
  "companies",
  "company_capabilities",
  "company_intelligence",
  "company_needs",
  "contacts",
  "evidence_items",
  "opportunities",
  "opportunity_participants",
  "organization_memberships",
  "organizations",
  "profiles",
  "relationships",
  "research_runs",
  "sources",
  "usage_events",
];

async function enumValues(name: string): Promise<string[]> {
  const rows = await sql`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = ${name} order by e.enumsortorder`;
  return rows.map((r: { enumlabel: string }) => r.enumlabel);
}

describe("migrations", () => {
  test("every migration in supabase/migrations is applied", async () => {
    const files = readdirSync(join(import.meta.dir, "..", "..", "supabase", "migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14));
    const applied = (await sql`select version from supabase_migrations.schema_migrations`).map((r: { version: string }) => r.version);
    expect(files.filter((v) => !applied.includes(v))).toEqual([]);
  });
});

describe("row level security", () => {
  test("every table in the public schema has RLS enabled", async () => {
    const rows = await sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`;
    expect(rows.map((r: { relname: string }) => r.relname)).toEqual(PUBLIC_TABLES);
    expect(rows.filter((r: { relrowsecurity: boolean }) => !r.relrowsecurity)).toEqual([]);
  });

  test("anon and service_role hold no privileges on any public table", async () => {
    const rows = await sql`select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'service_role')`;
    expect(rows).toEqual([]);
  });

  test("every SECURITY DEFINER function pins an empty search_path", async () => {
    const rows = await sql`select n.nspname || '.' || p.proname as fn, coalesce(array_to_string(p.proconfig, ','), '') as cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public', 'private') and p.proname <> 'rls_auto_enable'`;
    expect(rows.filter((r: { cfg: string }) => r.cfg !== 'search_path=""')).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });
});

describe("database enums mirror the TypeScript unions", () => {
  test.each([
    ["org_role", ORG_ROLES],
    ["visibility_level", VISIBILITIES],
    ["need_intensity", NEED_INTENSITIES],
    ["relationship_status", RELATIONSHIP_STATUSES],
    ["lifecycle_stage", LIFECYCLE_STAGES],
    ["participant_role", PARTICIPANT_ROLES],
    ["source_kind", SOURCE_KINDS],
    ["research_mode", RESEARCH_MODES],
    ["research_status", ["running", "succeeded", "failed"]],
  ] as const)("%s", async (name, values) => {
    expect(await enumValues(name)).toEqual([...values]);
  });

  test("locale_code accepts exactly the supported locales", async () => {
    const [r] = await sql`select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_type t on t.oid = c.contypid where t.typname = 'locale_code'`;
    const quoted = [...String(r.def).matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(quoted).toEqual([...LOCALES]);
  });
});
