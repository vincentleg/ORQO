/**
 * Phase 17A.3 trust baseline (isolated ORQO Test, real roles under RLS):
 * - one adversarial read/write matrix over the high-value tenant tables (owner, viewer, other organization, anonymous);
 * - a run authority written through any path other than the server's own (e.g. a member calling the database
 *   function directly) is refused when the run is resumed after approval, and the attempt is audited.
 * Synthetic organizations and fictional data only; no provider.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { buildAuthority } from "@/lib/governance/authority";
import { resolveEntitlementFrom } from "@/lib/governance/entitlement";
import { createMission, dbRunStore } from "@/lib/server/agents/repository";
import { acceptMission, decideAndResume } from "@/lib/server/agents/service";
import { createCompany } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { reserveSpend, setRunAuthority } from "@/lib/server/governance/ledger";
import { saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { SAAS } from "@/lib/understanding/fixtures";
import { addMember, anonClient, cleanupTestData, createSyntheticPreviewOrg, createTestUser, sql, type TestUser } from "../support/supabase";

let A: TestUser;
let V: TestUser;
let B: TestUser;
let orgA: string;
let companyA: string;

const TABLES = ["companies", "company_intelligence", "evidence_items", "company_validations", "tracked_opportunities", "agent_runs", "provider_spend", "usage_events", "audit_events"] as const;

beforeAll(async () => {
  await cleanupTestData();
  [A, V, B] = await Promise.all([createTestUser("p17t-a"), createTestUser("p17t-v"), createTestUser("p17t-b")]);
  orgA = await createOrganization(A.db, { name: "P17T Org A" });
  await createOrganization(B.db, { name: "P17T Org B" }); // B is a member of its own organization only
  await addMember(orgA, V.id, "viewer");
  companyA = (await createCompany(A.db, orgA, { name: "Ledgerline", website: "https://ledgerline.example" })).id;
  const run = await startResearchRun(A.db, orgA, "deep", "ledgerline.example", "ledgerline.example");
  const intelligenceId = await saveIntelligence(A.db, orgA, run, "basic", SAAS.profile, []);
  await A.db.from("company_validations").insert({ organization_id: orgA, company_id: companyA, kind: "answer", facet: "relationship_role", value: "supplier" });
  const reservation = await reserveSpend(A.db, { organizationId: orgA, agentRunId: null, researchRunId: run, provider: "brave", task: "web_search", model: null, amountUsd: 0.01, ceilingUsd: 1, idempotencyKey: crypto.randomUUID() });
  await A.db.from("usage_events").insert({ organization_id: orgA, research_run_id: run, reservation_id: reservation, provider: "brave", service: "web/search", operation: "web_search", succeeded: true, units: { queries: 1 } });
  // A tracked opportunity row (setup only; its creation path has its own suite).
  await sql`insert into public.tracked_opportunities (organization_id, target_company_id, intelligence_id, scenario_key, mechanism, snapshot, created_by) values (${orgA}, ${companyA}, ${intelligenceId}, 'technical_integration:own', 'technical_integration', '{"v":1}'::jsonb, ${A.id})`;
  await createMission(A.db, orgA, { agentId: "research", missionType: "analyze_company", capability: "company_research", objective: "trust matrix", input: { target: { query: "ledgerline.example" }, depth: "basic", refresh: false }, autonomy: 1, limits: AGENT_REGISTRY.research.limits, idempotencyKey: crypto.randomUUID() });
});
afterAll(cleanupTestData);

describe("tenant matrix: reads", () => {
  // Audit events and provider usage are admin-only by design; everything else is readable by viewers.
  const ADMIN_ONLY = new Set(["audit_events", "usage_events"]);
  test.each(TABLES.map((t) => [t] as const))("%s: owner reads, viewer reads (admin-only tables excepted), other organization and anonymous read nothing", async (table) => {
    const count = async (db: TestUser["db"]) => ((await db.from(table).select("id").eq("organization_id", orgA)).data ?? []).length;
    const owner = await count(A.db);
    expect(owner).toBeGreaterThan(0);
    expect(await count(V.db)).toBe(ADMIN_ONLY.has(table) ? 0 : owner);
    expect(await count(B.db)).toBe(0);
    const anon = await anonClient().from(table).select("id").eq("organization_id", orgA);
    expect(anon.data ?? []).toEqual([]);
  });
});

describe("tenant matrix: writes", () => {
  test("another organization and a viewer cannot write A's records, even naming A's ids", async () => {
    const attempts: [string, Record<string, unknown>][] = [
      ["company_validations", { organization_id: orgA, company_id: companyA, kind: "answer", facet: "relationship_role", value: "customer" }],
      ["usage_events", { organization_id: orgA, provider: "brave", service: "x", operation: "web_search", succeeded: true, units: {} }],
      ["tracked_opportunities", { organization_id: orgA, target_company_id: companyA, scenario_key: "referral:own", mechanism: "referral", snapshot: {} }],
      ["provider_spend", { organization_id: orgA, provider: "brave", task: "web_search", idempotency_key: crypto.randomUUID(), reserved_usd: 0.01, research_run_id: null }],
      ["audit_events", { organization_id: orgA, actor_type: "user", action: "forged", target_table: "companies" }],
      ["agent_runs", { organization_id: orgA, mission_id: crypto.randomUUID(), agent_id: "research", capability: "company_research", autonomy: 3, limits: {} }],
    ];
    for (const [table, row] of attempts) {
      for (const [who, db] of [["outsider", B.db], ["viewer", V.db]] as const) {
        const { error } = await db.from(table).insert(row as never);
        expect({ table, who, refused: error !== null }).toEqual({ table, who, refused: true });
      }
    }
    const before = await sql`select count(*)::int as n from public.companies where organization_id = ${orgA} and name = 'Renamed'`;
    await B.db.from("companies").update({ name: "Renamed" }).eq("id", companyA);
    await V.db.from("companies").update({ name: "Renamed" }).eq("id", companyA);
    const after = await sql`select count(*)::int as n from public.companies where organization_id = ${orgA} and name = 'Renamed'`;
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("authority integrity on resume", () => {
  test("a snapshot written outside the server's own path is refused when the approved run resumes, and audited", async () => {
    // An Internal (agent-entitled) organization, so the resume reaches the authority check.
    const org = await createSyntheticPreviewOrg(A, "P17T Forge");
    const m = await createMission(A.db, org, { agentId: "research", missionType: "analyze_company", capability: "company_research", objective: "forged authority", input: { target: { query: "ledgerline.example" }, depth: "deep", refresh: false }, autonomy: 2, limits: AGENT_REGISTRY.research.limits, idempotencyKey: crypto.randomUUID() });
    // The member writes a generous authority directly (as if calling the database function from a browser).
    const forged = buildAuthority({ principal: { organizationId: org, userId: A.id }, entitlement: resolveEntitlementFrom(org, "free", { ORQO_INTERNAL_ORGS: org, ORQO_INTERNAL_BUDGET_USD: "1000" }), agent: AGENT_REGISTRY.research, capability: "company_research", autonomy: 2, envelope: { maxCostUsd: 1000 }, ids: { missionId: m.missionId, runId: m.runId } });
    await setRunAuthority(A.db, org, m.runId, forged);
    await A.db.from("agent_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", m.runId);
    await A.db.from("agent_missions").update({ status: "running", started_at: new Date().toISOString() }).eq("id", m.missionId);
    const approvalId = await dbRunStore(A.db, org).requestApproval(m.runId, "deep_company_research", { toolId: "deep_company_research" });
    const refused = await decideAndResume(A.db, A.id, org, approvalId, "approve", "en").then(() => null, (e: unknown) => e as { code?: string; message?: string });
    expect({ code: refused?.code, message: refused?.message }).toEqual({ code: "forbidden", message: "This run cannot be resumed." });
    const [run] = await sql`select status, error_code from public.agent_runs where id = ${m.runId}`;
    expect(run).toMatchObject({ status: "failed", error_code: "tool_denied" });
    const audit = await sql`select action from public.audit_events where organization_id = ${org} and action = 'governance.tripwire.authority_modification'`;
    expect(audit).toHaveLength(1);
  });

  test("an authority written by the server's own path passes the check (paid providers stay off in isolation)", async () => {
    const org = await createSyntheticPreviewOrg(A, "P17T Genuine");
    const { accepted } = await acceptMission(A.db, A.id, org, { agentId: "research", missionType: "analyze_company", input: { target: { query: "ledgerline.example" }, depth: "deep", refresh: false }, autonomy: 2, idempotencyKey: crypto.randomUUID() }, "en");
    await A.db.from("agent_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", accepted.runId);
    await A.db.from("agent_missions").update({ status: "running", started_at: new Date().toISOString() }).eq("id", accepted.missionId);
    const approvalId = await dbRunStore(A.db, org).requestApproval(accepted.runId, "deep_company_research", { toolId: "deep_company_research" });
    const outcome = await decideAndResume(A.db, A.id, org, approvalId, "approve", "en").then((r) => r.decision, (e: unknown) => (e as { message?: string }).message);
    expect(outcome).not.toBe("This run cannot be resumed.");
    const audit = await sql`select action from public.audit_events where organization_id = ${org} and action = 'governance.tripwire.authority_modification'`;
    expect(audit).toHaveLength(0);
  });
});
