/**
 * Phase 3 persistence: research runs, company intelligence, evidence store and
 * usage ledger — tenant isolation, the atomic quota/concurrency guard, and
 * round-trip fidelity, against the real Supabase development project.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extractTargetProfile } from "@/lib/intelligence/extract";
import { FIXTURE_ABOUT, FIXTURE_HOME } from "@/lib/intelligence/fixtures";
import { parseHtml } from "@/lib/intelligence/html";
import type { TargetProfile } from "@/lib/intelligence/types";
import { createCompany, createSource, getOwnCompanyProfile, updateOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { findIntelligence, finishRun, recordUsage, RunRefusedError, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { addMember, anonClient, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

const TABLES: string[] = ["research_runs", "company_intelligence", "evidence_items", "usage_events"];
let A: TestUser;
let B: TestUser;
let V: TestUser;
let orgA: string;
let orgB: string;
let runA: string;
let intelA: string;
let sourceB: string;
let profile: TargetProfile;

function fixtureProfile(): TargetProfile {
  const now = new Date();
  const src = (key: string, url: string, pageType: "home" | "about") => ({ key, url, title: url, authority: "official" as const, pageType, retrievedAt: now.toISOString() });
  return extractTargetProfile({
    nameHint: null,
    domain: "nimbusfabric.example",
    website: "https://nimbusfabric.example",
    resolution: { method: "url", confidence: "strong" },
    pages: [
      { doc: parseHtml(FIXTURE_HOME, "https://nimbusfabric.example/"), source: src("s0", "https://nimbusfabric.example/", "home") },
      { doc: parseHtml(FIXTURE_ABOUT, "https://nimbusfabric.example/about"), source: src("s1", "https://nimbusfabric.example/about", "about") },
    ],
    now,
  });
}

async function fingerprint(table: string, organizationId: string) {
  const [r] = await sql.unsafe(`select count(*)::int as n, md5(string_agg(to_jsonb(t)::text, ',' order by t.id::text)) as digest from public.${table} t where organization_id = $1`, [organizationId]);
  return r;
}

beforeAll(async () => {
  await cleanupTestData();
  [A, B, V] = await Promise.all([createTestUser("p3-a"), createTestUser("p3-b"), createTestUser("p3-viewer")]);
  orgA = await createOrganization(A.db, { name: "P3 Org A" });
  orgB = await createOrganization(B.db, { name: "P3 Org B" });
  await addMember(orgA, V.id, "viewer");
  profile = fixtureProfile();
  runA = await startResearchRun(A.db, orgA, "basic", "nimbusfabric.example", "nimbusfabric.example");
  await recordUsage(A.db, orgA, runA, { provider: "brave", service: "web/search", operation: "web_search", succeeded: true, units: { queries: 1 }, costUsd: null });
  intelA = await saveIntelligence(A.db, orgA, runA, "basic", profile, []);
  await finishRun(A.db, orgA, runA, { ok: true, domain: profile.domain, counters: { officialPages: 2 } });
  sourceB = await createSource(B.db, orgB, { kind: "company-website", label: "B source", retrievedAt: new Date().toISOString() });
});
afterAll(cleanupTestData);

describe("round trip", () => {
  test("stored intelligence reads back identically (claims, sources, provenance)", async () => {
    const got = await findIntelligence(A.db, orgA, { domain: "nimbusfabric.example" });
    expect(got?.id).toBe(intelA);
    expect(got?.profile.claims.map((c) => [c.id, c.field, c.epistemic, c.excerpt, c.sourceKey])).toEqual(profile.claims.map((c) => [c.id, c.field, c.epistemic, c.excerpt, c.sourceKey]));
    expect(got?.profile.sources.map((s) => [s.key, s.url, s.authority, s.pageType])).toEqual(profile.sources.map((s) => [s.key, s.url, s.authority, s.pageType]));
    expect(got?.profile.unknowns).toEqual(profile.unknowns);
    // Found by name too (cache hit for a name search).
    expect((await findIntelligence(A.db, orgA, { name: "Nimbus Fabric" }))?.id ?? (await findIntelligence(A.db, orgA, { name: "NimbusFabric" }))?.id).toBe(intelA);
  });

  test("saving again replaces evidence and reuses sources (no duplicates)", async () => {
    const run = await startResearchRun(A.db, orgA, "basic", "again", "nimbusfabric.example");
    await saveIntelligence(A.db, orgA, run, "basic", profile, []);
    await finishRun(A.db, orgA, run, { ok: true, domain: profile.domain, counters: {} });
    const [{ n: intel }] = await sql`select count(*)::int as n from public.company_intelligence where organization_id = ${orgA}`;
    const [{ n: ev }] = await sql`select count(*)::int as n from public.evidence_items where organization_id = ${orgA}`;
    const [{ n: src }] = await sql`select count(*)::int as n from public.sources where organization_id = ${orgA} and url like 'https://nimbusfabric.example%'`;
    expect(intel).toBe(1);
    expect(ev).toBe(profile.claims.length);
    expect(src).toBe(2);
  });

  test("own-company profile update (member) round-trips; unknown goals are refused", async () => {
    await createCompany(A.db, orgA, { name: "Own A", isOwnCompany: true });
    await updateOwnCompanyProfile(A.db, orgA, { name: "Own A", website: null, summary: "Rugged servers", offerings: ["Rugged servers"], customerSegments: ["Defense"], markets: ["Europe"], geographies: ["France"], soughtCapabilities: ["GPU fabric"], partnershipGoals: ["supplier"] });
    expect(await getOwnCompanyProfile(A.db, orgA)).toMatchObject({ offerings: ["Rugged servers"], partnership_goals: ["supplier"] });
    await expect(updateOwnCompanyProfile(A.db, orgA, { name: "Own A", website: null, summary: "", offerings: [], customerSegments: [], markets: [], geographies: [], soughtCapabilities: [], partnershipGoals: ["world_domination" as never] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(updateOwnCompanyProfile(V.db, orgA, { name: "Hijack", website: null, summary: "", offerings: [], customerSegments: [], markets: [], geographies: [], soughtCapabilities: [], partnershipGoals: [] })).rejects.toBeTruthy();
    expect((await getOwnCompanyProfile(A.db, orgA))?.name).toBe("Own A");
  });
});

describe("tenant isolation (Phase 3 tables)", () => {
  test.each(TABLES)("%s: B cannot read, change or delete A's rows", async (table) => {
    const before = await fingerprint(table, orgA);
    expect(before.n).toBeGreaterThan(0);
    const { data } = await B.db.from(table).select("*").eq("organization_id", orgA);
    expect(data ?? []).toEqual([]);
    await B.db.from(table).update({ organization_id: orgB }).eq("organization_id", orgA);
    await B.db.from(table).delete().eq("organization_id", orgA);
    expect(await fingerprint(table, orgA)).toEqual(before);
  });

  test("B cannot insert rows claiming Org A", async () => {
    const attempts = [
      B.db.from("company_intelligence").insert({ organization_id: orgA, domain: "evil.example", name: "x", name_key: "x", mode: "basic", profile: {}, researched_at: new Date().toISOString() }),
      B.db.from("evidence_items").insert({ organization_id: orgA, intelligence_id: intelA, claim_key: "c1", field: "summary", statement: "x", epistemic: "inference", method: "page_text" }),
      B.db.from("usage_events").insert({ organization_id: orgA, provider: "brave", service: "x", operation: "web_search", succeeded: true }),
      B.db.from("research_runs").insert({ organization_id: orgA, mode: "basic", query: "x" }),
    ];
    for (const r of await Promise.all(attempts)) expect(r.error?.code).toBe("42501");
  });

  test("anonymous callers see nothing and cannot write", async () => {
    const anon = anonClient();
    for (const table of TABLES) {
      const { data } = await anon.from(table).select("*").limit(1);
      expect(data ?? []).toEqual([]);
    }
    const { error } = await anon.rpc("start_research_run", { p_organization_id: orgA, p_mode: "basic", p_query: "x", p_domain: null, p_max_runs: 10, p_window_hours: 24, p_stale_after_seconds: 60 });
    expect(error).toBeTruthy();
  });

  test("evidence cannot cite another organization's source; facts must cite a source", async () => {
    const cross = await A.db.from("evidence_items").insert({ organization_id: orgA, intelligence_id: intelA, source_id: sourceB, claim_key: "x1", field: "summary", statement: "x", epistemic: "fact", method: "page_text" });
    expect(cross.error?.code).toBe("23503");
    const unsourced = await A.db.from("evidence_items").insert({ organization_id: orgA, intelligence_id: intelA, source_id: null, claim_key: "x2", field: "summary", statement: "x", epistemic: "fact", method: "page_text" });
    expect(unsourced.error?.code).toBe("23514");
  });

  test("usage ledger: append-only; viewers cannot read cost metadata", async () => {
    const { data: owner } = await A.db.from("usage_events").select("id").eq("organization_id", orgA);
    expect((owner ?? []).length).toBeGreaterThan(0);
    const { data: viewer } = await V.db.from("usage_events").select("id").eq("organization_id", orgA);
    expect(viewer ?? []).toEqual([]);
    const upd = await A.db.from("usage_events").update({ cost_usd: 0 }).eq("organization_id", orgA);
    expect(upd.error?.code).toBe("42501");
    const del = await A.db.from("usage_events").delete().eq("organization_id", orgA);
    expect(del.error?.code).toBe("42501");
  });

  test("service_role and anon hold no privileges on Phase 3 tables", async () => {
    const rows = await sql`select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ('research_runs','company_intelligence','evidence_items','usage_events') and grantee in ('anon','service_role')`;
    expect(rows).toEqual([]);
  });
});

describe("quota and concurrency guard (start_research_run)", () => {
  const rpc = (u: TestUser, org: string, max = 100) =>
    u.db.rpc("start_research_run", { p_organization_id: org, p_mode: "deep", p_query: "q", p_domain: null, p_max_runs: max, p_window_hours: 24, p_stale_after_seconds: 60 });

  test("non-members and viewers cannot start runs", async () => {
    expect((await rpc(B, orgA)).error?.code).toBe("42501");
    expect((await rpc(V, orgA)).error?.code).toBe("42501");
  });

  test("one run at a time per organization, even under concurrent requests", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => rpc(B, orgB)));
    const ok = results.filter((r) => !r.error);
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.error?.code === "55P03")).toHaveLength(5);
    await finishRun(B.db, orgB, ok[0].data as string, { ok: false, errorCode: "timeout" });
  });

  test("the window quota is enforced atomically and cannot be reset by the client", async () => {
    // One deep run already exists for Org B (above); allow two in the window.
    const second = await rpc(B, orgB, 2);
    expect(second.error).toBeNull();
    await finishRun(B.db, orgB, second.data as string, { ok: true, domain: "x.example", counters: {} });
    const third = await rpc(B, orgB, 2);
    expect(third.error?.code).toBe("54000");
    // Runs cannot be deleted or back-dated by members to free quota.
    const del = await B.db.from("research_runs").delete().eq("organization_id", orgB);
    expect(del.error?.code).toBe("42501");
    const backdate = await B.db.from("research_runs").update({ started_at: "2000-01-01T00:00:00Z" }).eq("organization_id", orgB);
    expect(backdate.error?.code).toBe("42501");
    const modeFlip = await B.db.from("research_runs").update({ mode: "basic" }).eq("organization_id", orgB);
    expect(modeFlip.error?.code).toBe("42501");
    expect((await rpc(B, orgB, 2)).error?.code).toBe("54000");
  });

  test("repository maps refusals to typed errors", async () => {
    await expect(startResearchRun(V.db, orgA, "basic", "q", null)).rejects.toMatchObject({ code: "forbidden" });
    const running = await startResearchRun(A.db, orgA, "basic", "q", null);
    await expect(startResearchRun(A.db, orgA, "basic", "q", null)).rejects.toBeInstanceOf(RunRefusedError);
    await finishRun(A.db, orgA, running, { ok: false, errorCode: "timeout" });
  });
});
