/**
 * Company signals (Phase 7) against the real database, as signed-in users
 * under RLS: manual and research-delta signals, deduplication, lifecycle,
 * follow-up from a signal, immutable provenance, tenant isolation and
 * viewer read-only access. Synthetic organizations only (created by this
 * run's test users); no provider is called. Runs only behind the test-safety
 * guard (tests/support/safety.ts), like every DB suite.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCompany } from "@/lib/server/repositories/companies";
import { getCompanyMemory } from "@/lib/server/repositories/network-memory";
import { createFollowUpFromSignal, listSignals, recordManualSignal, setSignalStatus } from "@/lib/server/repositories/signals";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { addMember, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

let A: TestUser;
let V: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;
let companyA: string;
let companyB: string;

const SIGNAL = { kind: "geographic_expansion" as const, headline: "Fictional Rover Co announces a new office in Rotterdam", sourceUrl: "https://rover-fictional.example/news/rotterdam", sourceAuthority: "official" as const };

beforeAll(async () => {
  await cleanupTestData();
  [A, V, B] = await Promise.all([createTestUser("p7-a"), createTestUser("p7-v"), createTestUser("p7-b")]);
  orgA = await createOrganization(A.db, { name: "P7 Org A" });
  orgB = await createOrganization(B.db, { name: "P7 Org B" });
  await addMember(orgA, V.id, "viewer");
  companyA = (await createCompany(A.db, orgA, { name: "Rover Fictional", website: "https://rover-fictional.example" })).id;
  companyB = (await createCompany(B.db, orgB, { name: "B Secret Co", website: "https://b-secret.example" })).id;
});
afterAll(cleanupTestData);

describe("manual signals", () => {
  test("recorded with source, unknown date kept unknown, deduplicated on the URL", async () => {
    expect(await recordManualSignal(A.db, orgA, companyA, SIGNAL)).toEqual({ created: true });
    expect(await recordManualSignal(A.db, orgA, companyA, { ...SIGNAL, headline: "Same news, other title", sourceUrl: `${SIGNAL.sourceUrl}?utm_source=x` })).toEqual({ created: false });
    const [s] = await listSignals(A.db, orgA, { companyId: companyA });
    expect(s).toMatchObject({ origin: "manual", status: "new", publishedOn: null, evidenceQuality: "moderate", sourceAuthority: "official" });
  });

  test("a future publication date and a non-http URL are refused", async () => {
    await expect(recordManualSignal(A.db, orgA, companyA, { ...SIGNAL, sourceUrl: "https://rover-fictional.example/x", publishedOn: "2999-01-01" })).rejects.toThrow();
    await expect(recordManualSignal(A.db, orgA, companyA, { ...SIGNAL, sourceUrl: "javascript:alert(1)" })).rejects.toThrow();
  });
});

describe("lifecycle", () => {
  test("review, dismiss, restore; status time and actor set by the database", async () => {
    const [s] = await listSignals(A.db, orgA, { companyId: companyA });
    await setSignalStatus(A.db, orgA, s.id, "reviewed");
    await setSignalStatus(A.db, orgA, s.id, "dismissed");
    await expect(setSignalStatus(A.db, orgA, s.id, "reviewed")).rejects.toThrow();
    await setSignalStatus(A.db, orgA, s.id, "new");
    const [row] = await sql`select status, status_changed_at, status_changed_by from public.company_signals where id = ${s.id}`;
    expect(row.status).toBe("new");
    expect(row.status_changed_at).not.toBeNull();
    expect(row.status_changed_by).toBe(A.id);
  });

  test("a follow-up created from a signal is a normal Network follow-up (origin signal) and marks the signal acted on", async () => {
    const [s] = await listSignals(A.db, orgA, { companyId: companyA });
    const { followUpId } = await createFollowUpFromSignal(A.db, orgA, s.id, { title: "Review Rover Fictional: expansion", dueOn: null });
    const memory = await getCompanyMemory(A.db, orgA, companyA);
    expect(memory.followUps.find((f) => f.id === followUpId)).toMatchObject({ origin: "signal", status: "open", dueOn: null });
    const [after] = await listSignals(A.db, orgA, { companyId: companyA });
    expect(after).toMatchObject({ status: "acted_on", followUpId });
  });

  test("provenance cannot be edited after insert", async () => {
    const [s] = await listSignals(A.db, orgA, { companyId: companyA });
    const { error } = await A.db.from("company_signals").update({ headline: "Rewritten", source_url: "https://evil.example" }).eq("id", s.id);
    expect(error).not.toBeNull();
  });
});

describe("tenant isolation", () => {
  test("B cannot read, attach to, or change A's signals", async () => {
    expect(await listSignals(B.db, orgA)).toEqual([]);
    const { data } = await B.db.from("company_signals").select("id");
    expect(data ?? []).toEqual([]);
    await expect(recordManualSignal(B.db, orgB, companyA, { ...SIGNAL, sourceUrl: "https://x.example/1" })).rejects.toThrow();
    const { error } = await B.db.from("company_signals").insert({ organization_id: orgB, company_id: companyA, kind: "funding", origin: "manual", headline: "Cross-tenant", epistemic: "fact", evidence_quality: "moderate", source_url: "https://x.example/2", source_authority: "official", dedup_key: "funding:url:0000abcd" });
    expect(error).not.toBeNull();
    const [s] = await listSignals(A.db, orgA, { companyId: companyA });
    await expect(setSignalStatus(B.db, orgB, s.id, "dismissed")).rejects.toThrow();
    expect(await recordManualSignal(B.db, orgB, companyB, { ...SIGNAL, sourceUrl: "https://b-secret.example/news" })).toEqual({ created: true });
  });

  test("a viewer reads but cannot write", async () => {
    expect((await listSignals(V.db, orgA)).length).toBeGreaterThan(0);
    await expect(recordManualSignal(V.db, orgA, companyA, { ...SIGNAL, sourceUrl: "https://x.example/3" })).rejects.toThrow();
  });

  test("anon and service_role hold no privileges; RLS is enabled", async () => {
    const [r] = await sql`select relrowsecurity from pg_class where oid = 'public.company_signals'::regclass`;
    expect(r.relrowsecurity).toBe(true);
    const grants = await sql`select grantee from information_schema.role_table_grants where table_schema = 'public' and table_name = 'company_signals' and grantee in ('anon', 'service_role')`;
    expect(grants).toEqual([]);
  });
});
