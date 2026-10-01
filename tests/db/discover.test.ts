/**
 * Discover & Prospecting (Phase 5) against the real database, as signed-in
 * users under RLS: the discover_companies mission end to end over stored
 * research (no network — the research gateway is absent), mission/run
 * history, rejection memory read from past results, tenant isolation, and
 * Add to Network with provenance and without duplicates.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DiscoveryResult } from "@/lib/agents/contracts";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { INJECTED, PEER_FIXTURE, SERVICES_OWN, STRONG } from "@/lib/discovery/fixtures";
import type { TargetProfile } from "@/lib/intelligence/types";
import { executeRun } from "@/lib/server/agents/orchestrator";
import { createMission, dbRunStore, getRunDetail, listRuns } from "@/lib/server/agents/repository";
import { TOOL_IMPLEMENTATIONS } from "@/lib/server/agents/tools";
import { readCompanyKnowledge } from "@/lib/server/discovery/knowledge";
import { addDiscoveredCompany } from "@/lib/server/discovery/network";
import { createCompany, listCompanies, updateOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import type { Db } from "@/lib/server/supabase/types";
import { addMember, cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

let A: TestUser;
let V: TestUser;
let B: TestUser;
let orgA: string;
let orgB: string;
let runId: string;
let result: DiscoveryResult;

async function store(db: Db, org: string, profile: TargetProfile) {
  const rr = await startResearchRun(db, org, "basic", profile.domain, profile.domain);
  await saveIntelligence(db, org, rr, "basic", profile, []);
  await finishRun(db, org, rr, { ok: true, domain: profile.domain, counters: {} });
}

beforeAll(async () => {
  await cleanupTestData();
  [A, V, B] = await Promise.all([createTestUser("p5-a"), createTestUser("p5-v"), createTestUser("p5-b")]);
  orgA = await createOrganization(A.db, { name: "P5 Org A" });
  orgB = await createOrganization(B.db, { name: "P5 Org B" });
  await addMember(orgA, V.id, "viewer");
  await createCompany(A.db, orgA, { name: "Own Co", website: "https://own.example", isOwnCompany: true });
  await updateOwnCompanyProfile(A.db, orgA, { ...SERVICES_OWN, website: "https://own.example" });
  // What ORQO already knows: two analyses from Search, one Network company (no analysis yet).
  for (const p of [STRONG, PEER_FIXTURE, INJECTED]) await store(A.db, orgA, p);
  await createCompany(A.db, orgA, { name: "Unanalyzed Co", website: "https://unanalyzed.example" });
  // Org B knows a company too; A must never see it.
  await store(B.db, orgB, { ...STRONG, domain: "secret-b.example", website: "https://secret-b.example" });

  const created = await createMission(A.db, orgA, {
    agentId: "prospecting",
    missionType: "discover_companies",
    capability: "prospect_discovery",
    objective: "discover_companies · customers",
    input: { intent: "customers", source: "workspace_knowledge", maxResults: 5, reevaluate: false },
    autonomy: 1,
    limits: AGENT_REGISTRY.prospecting.limits,
    idempotencyKey: crypto.randomUUID(),
  });
  runId = created.runId;
  const outcome = await executeRun(
    { store: dbRunStore(A.db, orgA), tools: TOOL_IMPLEMENTATIONS, env: { db: A.db, organizationId: orgA, userId: A.id, locale: "en", research: null } },
    { runId, missionId: created.missionId, agent: AGENT_REGISTRY.prospecting, capability: "prospect_discovery", autonomy: 1, missionType: "discover_companies", input: { intent: "customers", source: "workspace_knowledge", maxResults: 5, reevaluate: false }, approvedTools: [], resumed: false },
  );
  if (outcome.status !== "completed") throw new Error(`discovery did not complete: ${JSON.stringify(outcome)}`);
  result = DiscoveryResult.parse(outcome.result);
});
afterAll(cleanupTestData);

describe("discover_companies end to end over stored knowledge", () => {
  test("qualifies from stored evidence, rejects with reasons, never fetches the web, never leaks another tenant", () => {
    expect(result.source).toEqual({ id: "workspace_knowledge", provider: null, live: false });
    expect(result.companies.map((c) => c.domain)).toContain("strong.example");
    expect(result.rejected.find((r) => r.domain === "peer.example")?.stage).toBe("qualification");
    // No research gateway: the unanalyzed company is reported unverified (verification refused), not guessed.
    expect(result.unverified).toEqual([expect.objectContaining({ domain: "unanalyzed.example", reason: "verification_refused", inNetwork: true })]);
    expect(JSON.stringify(result)).not.toContain("secret-b.example");
  });

  test("mission, run, steps and tool calls are persisted through the Phase 4 run system; no provider usage", async () => {
    const d = await getRunDetail(A.db, orgA, runId);
    expect(d?.run).toMatchObject({ status: "completed", agent_id: "prospecting", capability: "prospect_discovery" });
    expect(d?.run.agent_missions.mission_type).toBe("discover_companies");
    expect(d?.steps.map((s) => s.step_key)).toEqual(["load_workspace_context", "build_discovery_plan", "read_existing_knowledge", "find_candidates", "deduplicate_candidates", "verify_candidates", "qualify_candidates", "apply_critic", "produce_result"]);
    expect(d?.toolCalls.some((c) => c.cost_class === "variable" || c.external_network && c.outcome === "succeeded")).toBe(false);
    expect((await sql`select count(*)::int as n from public.usage_events where organization_id = ${orgA}`)[0].n).toBe(0);
    // Discovery history = the agent's runs (viewers read it too).
    expect((await listRuns(V.db, orgA, { agentId: "prospecting" })).map((r) => r.id)).toContain(runId);
    expect(await listRuns(B.db, orgA, { agentId: "prospecting" })).toEqual([]);
  });

  test("rejection memory is read from past mission results of this organization only", async () => {
    const k = await readCompanyKnowledge(A.db, orgA);
    expect(k.decisions.map((d) => d.domain)).toContain("peer.example");
    expect(k.analyses.map((a) => a.domain)).not.toContain("secret-b.example");
    const foreign = await readCompanyKnowledge(B.db, orgA);
    expect([foreign.network.length, foreign.analyses.length, foreign.decisions.length]).toEqual([0, 0, 0]);
  });
});

describe("Add to Network from Discover", () => {
  test("creates once with provenance; a second add (or an existing domain) never duplicates", async () => {
    const first = await addDiscoveredCompany(A.db, orgA, runId, "strong.example");
    expect(first.created).toBe(true);
    const again = await addDiscoveredCompany(A.db, orgA, runId, "strong.example");
    expect(again).toEqual({ companyId: first.companyId, created: false });
    const rows = await sql`select external_ref from public.companies where organization_id = ${orgA} and website = 'https://strong.example'`;
    expect(rows).toEqual([{ external_ref: `discover:${runId}:strong.example` }]);
  });

  test("only companies the stored result presented; viewers, other tenants and forged runs are refused", async () => {
    await expect(addDiscoveredCompany(A.db, orgA, runId, "peer.example")).rejects.toMatchObject({ code: "not_found" });
    await expect(addDiscoveredCompany(A.db, orgA, runId, "evil.example")).rejects.toMatchObject({ code: "not_found" });
    await expect(addDiscoveredCompany(A.db, orgA, crypto.randomUUID(), "strong.example")).rejects.toMatchObject({ code: "not_found" });
    await expect(addDiscoveredCompany(B.db, orgB, runId, "strong.example")).rejects.toMatchObject({ code: "not_found" });
    // A viewer can read the run but RLS refuses the insert (the action also requires member+).
    const injected = result.companies.find((c) => c.domain === "injected.example");
    if (injected) await expect(addDiscoveredCompany(V.db, orgA, runId, "injected.example")).rejects.toBeDefined();
    expect((await listCompanies(B.db, orgB)).some((c) => c.website?.includes("strong.example"))).toBe(false);
  });
});
