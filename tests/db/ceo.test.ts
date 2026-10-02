/**
 * Phase 16B against the isolated ORQO Test database, as signed-in users under RLS:
 * - the CEO resolves companies only inside the caller's organization (names and URL ids alike);
 * - Work's briefing and every CEO answer are read-only: no research run, usage event, agent run or write;
 * - the briefing prioritizes credible opportunities only.
 * Synthetic organizations, fictional companies, no provider.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { answerCeo } from "@/lib/server/ceo/answer";
import { loadBriefing } from "@/lib/server/ceo/briefing";
import { createCompany } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { APPLIANCE_INTEGRATOR, fixtureProfile, SERVER_MAKER, SERVER_MAKER_OUTSOURCING } from "@/lib/understanding/fixtures";
import { cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

let A: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;
let positive: string;
let negative: string;

const SUPPLIER = fixtureProfile("Kestrel Storage", "kestrel-storage.example", SERVER_MAKER.profile.claims.map((c) => [c.field, c.statement.replaceAll("Kestrel Compute", "Kestrel Storage"), c.epistemic] as [typeof c.field, string, typeof c.epistemic]));

async function research(db: TestUser["db"], org: string, fx: { profile: typeof SERVER_MAKER.profile }) {
  const runId = await startResearchRun(db, org, "basic", fx.profile.domain, fx.profile.domain);
  await saveIntelligence(db, org, runId, "basic", fx.profile, []);
  await finishRun(db, org, runId, { ok: true, domain: fx.profile.domain, counters: {} });
}

/** Everything a read-only page must leave untouched. */
async function activity(org: string) {
  const [r] = await sql`select
    (select count(*)::int from public.research_runs where organization_id = ${org}) as runs,
    (select count(*)::int from public.usage_events where organization_id = ${org}) as usage,
    (select count(*)::int from public.agent_runs where organization_id = ${org}) as agents,
    (select count(*)::int from public.audit_events where organization_id = ${org}) as audit,
    (select count(*)::int from public.tracked_opportunities where organization_id = ${org}) as tracked`;
  return r;
}

beforeAll(async () => {
  await cleanupTestData();
  [A, B] = await Promise.all([createTestUser("p16b-a"), createTestUser("p16b-b")]);
  orgA = await createOrganization(A.db, { name: "P16B Org A" });
  orgB = await createOrganization(B.db, { name: "P16B Org B" });
  await createCompany(A.db, orgA, { name: "Arvenor Systems", website: "https://arvenor.example", isOwnCompany: true });
  positive = (await createCompany(A.db, orgA, { name: "Kestrel Compute", website: "https://kestrel.example" })).id;
  negative = (await createCompany(A.db, orgA, { name: "Kestrel Storage", website: "https://kestrel-storage.example" })).id;
  await research(A.db, orgA, APPLIANCE_INTEGRATOR);
  await research(A.db, orgA, SERVER_MAKER_OUTSOURCING);
  await research(A.db, orgA, SUPPLIER);
  await createCompany(B.db, orgB, { name: "B Own", website: "https://b-own.example", isOwnCompany: true });
});
afterAll(cleanupTestData);

describe("Work briefing", () => {
  test("credible opportunities only, from stored records, without any activity", async () => {
    const before = await activity(orgA);
    const b = await loadBriefing(A.db, orgA);
    expect(b.top.map((x) => (x.kind === "lead" ? x.companyId : x.opportunity.targetCompanyId))).toEqual([positive]);
    expect(b.noOpportunity).toBe(1);
    expect(b.continue.map((c) => c.remembered.company.id).sort()).toEqual([positive, negative].sort());
    expect(await activity(orgA)).toEqual(before);
  });

  test("another organization's briefing knows nothing of A", async () => {
    const b = await loadBriefing(B.db, orgB);
    expect(b.top).toEqual([]);
    expect(b.continue).toEqual([]);
    expect(b.remembered).toBe(0);
    // Even when asking for A's organization id, RLS returns nothing.
    const leak = await loadBriefing(B.db, orgA);
    expect(leak.continue).toEqual([]);
    expect(leak.top).toEqual([]);
  });
});

describe("ORQO CEO", () => {
  test("answers inside the organization, read-only", async () => {
    const before = await activity(orgA);
    const pos = await answerCeo(A.db, orgA, "What could we do with Kestrel Compute?");
    expect(pos).toMatchObject({ kind: "company", company: { id: positive } });
    if (pos.kind === "company") expect(pos.dossier.verdict).toBe("opportunity");
    const neg = await answerCeo(A.db, orgA, "Is Kestrel Storage actually interesting for us?");
    if (neg.kind !== "company") throw new Error(neg.kind);
    expect(neg.dossier.verdict).toBe("no_credible_opportunity");
    expect((await answerCeo(A.db, orgA, "Analyze Kestrel")).kind).toBe("clarify");
    expect((await answerCeo(A.db, orgA, "Send an email to Kestrel Compute")).kind).toBe("future");
    expect((await answerCeo(A.db, orgA, "Find companies that could help us enter Germany")).kind).toBe("prospects");
    expect((await answerCeo(A.db, orgA, "What should I work on today?")).kind).toBe("priorities");
    expect((await answerCeo(A.db, orgA, "Prépare-moi pour mon rendez-vous avec Kestrel Compute")).kind).toBe("company");
    expect(await activity(orgA)).toEqual(before);
  });

  test("another organization can resolve neither A's company names nor A's company ids", async () => {
    const byName = await answerCeo(B.db, orgB, "What could we do with Kestrel Compute?");
    expect(byName.kind).toBe("not_researched");
    if (byName.kind === "not_researched") expect(byName.company.id).toBeNull();
    const byId = await answerCeo(B.db, orgB, "Analyze it", { as: "analyze_company", company: positive });
    expect(byId.kind === "company" && byId.company.id === positive).toBe(false);
    const crossOrg = await answerCeo(B.db, orgA, "What could we do with Kestrel Compute?", { company: positive });
    expect(crossOrg.kind === "company").toBe(false);
  });

  test("an invented intent from the URL is ignored", async () => {
    const r = await answerCeo(A.db, orgA, "Kestrel Compute", { as: "delete_everything" });
    expect(r.kind).toBe("company");
  });
});
