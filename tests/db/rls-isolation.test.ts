/**
 * Cross-tenant isolation, enforced by Postgres RLS and checked against the
 * real Supabase project through the Data API as real signed-in users.
 *
 * User A owns Organization A and fills every tenant table (fixture import plus
 * a real engine evaluation). User B owns Organization B. For every tenant
 * table, B must not read, update, delete, or insert rows claiming to belong to
 * Organization A. Row contents are verified unchanged through the direct
 * database connection, not through B's own (filtered) view.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEMO_NOW } from "@/lib/data/seed";
import { AppError } from "@/lib/server/errors";
import { createCapability, createCompany, createSource } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { evaluateRelationshipForOrganization } from "@/lib/server/orqo/evaluate";
import { importDemoRelationship, type ImportedFixture } from "../support/demo-fixture";
import { repositorySink } from "../support/repository-sink";
import { addMember, anonClient, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

type Payload = Record<string, unknown>;
interface TableSpec {
  table: string;
  insert: () => Payload;
  update: Payload;
}

let A: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;
let fixture: ImportedFixture;
let opportunityA: string;
const idsOf = new Map<string, string[]>();
const now = new Date().toISOString();

const TENANT_TABLES = [
  "companies",
  "sources",
  "company_capabilities",
  "company_needs",
  "contacts",
  "relationships",
  "analysis_runs",
  "opportunities",
  "opportunity_participants",
  "audit_events",
] as const;

async function fingerprint(table: string, organizationId: string): Promise<{ n: number; digest: string | null }> {
  const [r] = await sql.unsafe(`select count(*)::int as n, md5(string_agg(to_jsonb(t)::text, ',' order by t.id::text)) as digest from public.${table} t where organization_id = $1`, [organizationId]);
  return { n: r.n, digest: r.digest };
}

beforeAll(async () => {
  await cleanupTestData();
  A = await createTestUser("rls-a");
  B = await createTestUser("rls-b");
  orgA = await createOrganization(A.db, { name: "Org A" });
  orgB = await createOrganization(B.db, { name: "Org B" });
  fixture = await importDemoRelationship(repositorySink(A.db, orgA), "r-maya-lukas");
  const outcome = await evaluateRelationshipForOrganization(A.db, { userId: A.id, organizationId: orgA, relationshipId: fixture.relationshipId, now: new Date(DEMO_NOW) });
  opportunityA = outcome.opportunities[0].id;
  await createCompany(B.db, orgB, { name: "B's own company" });
  for (const table of TENANT_TABLES) {
    const rows = await sql.unsafe(`select id::text as id from public.${table} where organization_id = $1`, [orgA]);
    idsOf.set(table, rows.map((r: { id: string }) => r.id));
  }
});
afterAll(cleanupTestData);

const companyA = () => fixture.ids.get("c-edgevision") ?? "";
const SPECS: TableSpec[] = [
  { table: "companies", insert: () => ({ organization_id: orgA, name: "Injected by B" }), update: { name: "Renamed by B" } },
  { table: "sources", insert: () => ({ organization_id: orgA, kind: "news", label: "Injected", retrieved_at: now }), update: { label: "Changed by B" } },
  { table: "company_capabilities", insert: () => ({ organization_id: orgA, company_id: companyA(), label: "Injected" }), update: { label: "Changed by B" } },
  { table: "company_needs", insert: () => ({ organization_id: orgA, company_id: companyA(), label: "Injected" }), update: { label: "Changed by B" } },
  { table: "contacts", insert: () => ({ organization_id: orgA, name: "Injected" }), update: { name: "Changed by B" } },
  {
    table: "relationships",
    insert: () => ({ organization_id: orgA, contact_a_id: fixture.ids.get("p-maya"), contact_b_id: fixture.ids.get("p-lukas") }),
    update: { encounter_note: "Changed by B" },
  },
  {
    table: "analysis_runs",
    insert: () => ({ organization_id: orgA, relationship_id: fixture.relationshipId, engine: "deterministic", trigger: { kind: "connection" }, outcome: "opportunity", summary: "Injected" }),
    update: { summary: "Changed by B" },
  },
  {
    table: "opportunities",
    insert: () => ({ organization_id: orgA, engine_key: "injected", pattern_id: "x", kind: "customer", title: "Injected", confidence: {}, critic: {}, trigger: { kind: "connection" }, engine: "deterministic", discovered_at: now }),
    update: { title: "Changed by B" },
  },
  { table: "opportunity_participants", insert: () => ({ organization_id: orgA, opportunity_id: opportunityA, company_id: companyA(), role: "partner", position: 9 }), update: { contributions: ["Changed by B"] } },
  { table: "audit_events", insert: () => ({ organization_id: orgA, actor_type: "user", action: "forged.event", target_table: "companies" }), update: { action: "tampered" } },
];

describe("setup sanity", () => {
  test("Organization A has rows in every tenant table", () => {
    for (const table of TENANT_TABLES) expect({ table, n: (idsOf.get(table) ?? []).length > 0 }).toEqual({ table, n: true });
  });
});

describe.each(SPECS)("User B vs Organization A: $table", (spec) => {
  test("positive control: User A can read Organization A's rows", async () => {
    const ids = idsOf.get(spec.table) ?? [];
    const { data, error } = await A.db.from(spec.table).select("id").in("id", ids);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(ids.length);
  });

  test("SELECT by id and by organization_id returns nothing", async () => {
    const byId = await B.db.from(spec.table).select("*").in("id", idsOf.get(spec.table) ?? []);
    expect(byId.data ?? []).toEqual([]);
    const byOrg = await B.db.from(spec.table).select("*").eq("organization_id", orgA);
    expect(byOrg.data ?? []).toEqual([]);
  });

  test("UPDATE changes nothing", async () => {
    const before = await fingerprint(spec.table, orgA);
    const r = await B.db.from(spec.table).update(spec.update).in("id", idsOf.get(spec.table) ?? []).select("id");
    expect(r.data ?? []).toEqual([]);
    expect(await fingerprint(spec.table, orgA)).toEqual(before);
  });

  test("DELETE removes nothing", async () => {
    const before = await fingerprint(spec.table, orgA);
    const r = await B.db.from(spec.table).delete().in("id", idsOf.get(spec.table) ?? []).select("id");
    expect(r.data ?? []).toEqual([]);
    expect(await fingerprint(spec.table, orgA)).toEqual(before);
  });

  test("INSERT claiming organization_id = A is rejected", async () => {
    const before = await fingerprint(spec.table, orgA);
    const r = await B.db.from(spec.table).insert(spec.insert()).select("id");
    expect(r.error?.code).toBe("42501");
    expect(await fingerprint(spec.table, orgA)).toEqual(before);
  });
});

describe("tenancy tables", () => {
  test("User B cannot read, rename or join Organization A", async () => {
    expect((await B.db.from("organizations").select("id").eq("id", orgA)).data).toEqual([]);
    expect((await B.db.from("organization_memberships").select("id").eq("organization_id", orgA)).data).toEqual([]);
    expect((await B.db.from("organizations").update({ name: "Taken over" }).eq("id", orgA).select("id")).data).toEqual([]);
    const [org] = await sql`select name from public.organizations where id = ${orgA}`;
    expect(org.name).toBe("Org A");
  });

  test("User B cannot read User A's profile", async () => {
    expect((await B.db.from("profiles").select("id").eq("id", A.id)).data).toEqual([]);
  });
});

describe("server-side evaluation across tenants", () => {
  test("User B cannot evaluate Organization A's relationship, via A's id or their own", async () => {
    const attempt = (organizationId: string) =>
      evaluateRelationshipForOrganization(B.db, { userId: B.id, organizationId, relationshipId: fixture.relationshipId }).then(
        () => "ok",
        (e: unknown) => (e instanceof AppError ? e.code : "unexpected"),
      );
    expect(await attempt(orgA)).toBe("not_found");
    expect(await attempt(orgB)).toBe("not_found");
    const [runs] = await sql`select count(*)::int as n from public.analysis_runs where organization_id = ${orgA}`;
    expect(runs.n).toBe(1);
  });
});

describe("structural guarantees", () => {
  test("a member of both organizations cannot move a row from one to the other", async () => {
    const C = await createTestUser("rls-c");
    await addMember(orgA, C.id, "member");
    await addMember(orgB, C.id, "member");
    const [bCompany] = await sql`select id::text as id from public.companies where organization_id = ${orgB} limit 1`;
    const r = await C.db.from("companies").update({ organization_id: orgA }).eq("id", bCompany.id).select("id");
    expect(r.error?.code).toBe("42501");
    const [after] = await sql`select organization_id::text as org from public.companies where id = ${bCompany.id}`;
    expect(after.org).toBe(orgB);
  });

  test("a row in Organization A cannot reference Organization B's company (composite foreign key)", async () => {
    const [bCompany] = await sql`select id::text as id from public.companies where organization_id = ${orgB} limit 1`;
    const r = await A.db.from("company_capabilities").insert({ organization_id: orgA, company_id: bCompany.id, label: "Cross-tenant link" }).select("id");
    expect(r.error?.code).toBe("23503");
  });

  test("evidence in Organization A cannot cite Organization B's source", async () => {
    const bSource = await createSource(B.db, orgB, { kind: "news", label: "B-only source", retrievedAt: now });
    const attempt = createCapability(A.db, orgA, { companyId: companyA(), label: "Cites B", evidence: [{ sourceId: bSource, excerpt: "x", epistemic: "fact" }] }).then(
      () => "ok",
      (e: unknown) => (e instanceof AppError ? e.code : "unexpected"),
    );
    expect(await attempt).toBe("invalid_input");
  });

  test("created_by cannot be forged", async () => {
    const r = await A.db.from("companies").insert({ organization_id: orgA, name: "Forged creator", created_by: B.id }).select("created_by").single();
    expect(r.data?.created_by).toBe(A.id);
  });

  test("the audit trail is append-only, even for the organization owner", async () => {
    const before = await fingerprint("audit_events", orgA);
    expect((await A.db.from("audit_events").insert({ organization_id: orgA, actor_type: "user", action: "forged", target_table: "x" })).error?.code).toBe("42501");
    expect((await A.db.from("audit_events").update({ action: "tampered" }).eq("organization_id", orgA)).error?.code).toBe("42501");
    expect((await A.db.from("audit_events").delete().eq("organization_id", orgA)).error?.code).toBe("42501");
    expect(await fingerprint("audit_events", orgA)).toEqual(before);
  });
});

describe("anonymous role", () => {
  const anonCases: [string, () => Payload][] = [
    ...TENANT_TABLES.map((t): [string, () => Payload] => [t, () => ({ organization_id: orgA })]),
    ["organization_memberships", () => ({ organization_id: orgA, user_id: A.id, role: "owner" })],
    ["organizations", () => ({ name: "Anonymous org" })],
    ["profiles", () => ({ id: A.id })],
  ];
  test.each(anonCases)("%s: no rows readable, no inserts", async (table, payload) => {
    const anon = anonClient();
    const read = await anon.from(table).select("*").limit(5);
    expect(read.data ?? []).toEqual([]);
    const write = await anon.from(table).insert(payload());
    expect(write.error?.code).toBe("42501");
  });
});
