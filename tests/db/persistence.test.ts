/**
 * Production persistence: data written through the repositories and results of
 * server-side evaluation survive a brand-new session, and match what the
 * unchanged engine concludes on the same data.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { DEMO_NOW } from "@/lib/data/seed";
import { listCompanies } from "@/lib/server/repositories/companies";
import { createOrganization, getProfile, updateProfile } from "@/lib/server/repositories/tenancy";
import { evaluateRelationshipForOrganization, loadRelationshipSnapshot } from "@/lib/server/orqo/evaluate";
import { OpportunityRow } from "@/lib/server/orqo/schemas";
import { buildEvaluationWorld } from "@/lib/server/orqo/world";
import { loadTestEnv } from "../support/env";
import { importDemoRelationship, type ImportedFixture } from "../support/demo-fixture";
import { comparable, referenceEvaluation } from "../support/reference";
import { repositorySink } from "../support/repository-sink";
import { cleanupTestData, createTestUser, sql, type TestUser } from "../support/supabase";

let user: TestUser;
let orgId: string;
let fixture: ImportedFixture;

/** A second, independent session for the same user: nothing is shared with the writer's client. */
async function freshSession(u: TestUser) {
  const env = loadTestEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`fresh sign-in failed: ${error.code}`);
  return db;
}

beforeAll(async () => {
  await cleanupTestData();
  user = await createTestUser("persist");
  orgId = await createOrganization(user.db, { name: "Persistence Org" });
  fixture = await importDemoRelationship(repositorySink(user.db, orgId), "r-maya-lukas");
});
afterAll(cleanupTestData);

describe("server-side evaluation", () => {
  test("finds the same opportunity the engine finds in the demo", async () => {
    const outcome = await evaluateRelationshipForOrganization(user.db, { userId: user.id, organizationId: orgId, relationshipId: fixture.relationshipId, now: new Date(DEMO_NOW) });
    expect(outcome.outcome).toBe("opportunity");
    expect(outcome.opportunities.map(({ title, confidence, created }) => ({ title, confidence, created }))).toEqual([{ title: "European Edge AI Appliance Partnership", confidence: "moderate", created: true }]);
  });

  test("the persisted opportunity, reloaded in a new session, equals the engine's result field for field", async () => {
    const db = await freshSession(user);
    const snapshot = await loadRelationshipSnapshot(db, orgId, fixture.relationshipId);
    const world = buildEvaluationWorld(snapshot, DEMO_NOW);
    const [stored] = Object.values(world.opportunities);
    const ref = referenceEvaluation("r-maya-lukas");
    const [expected] = ref.result.passing.map((p) => comparable(ref.world, p.draft, p.critique));
    const actual = comparable(world, { ...stored, drivingNeeds: [] }, { report: stored.critic, confidence: stored.confidence, watchConditions: [] });
    expect(actual).toEqual(expected);
    expect(snapshot.relationship.status).toBe("active");
    expect(snapshot.runs.map((r) => r.outcome)).toEqual(["opportunity"]);
  });

  test("re-evaluation updates the same opportunity and keeps its lifecycle stage", async () => {
    const [opp] = await sql`select id::text as id from public.opportunities where organization_id = ${orgId}`;
    const moved = await user.db.from("opportunities").update({ stage: "interested" }).eq("id", opp.id).select("id");
    expect(moved.data).toHaveLength(1);

    const again = await evaluateRelationshipForOrganization(user.db, { userId: user.id, organizationId: orgId, relationshipId: fixture.relationshipId, now: new Date(DEMO_NOW) });
    expect(again.opportunities.map((o) => ({ id: o.id, created: o.created }))).toEqual([{ id: opp.id, created: false }]);

    const [counts] = await sql`select (select count(*)::int from public.opportunities where organization_id = ${orgId}) as opportunities,
      (select count(*)::int from public.analysis_runs where organization_id = ${orgId}) as runs,
      (select stage::text from public.opportunities where id = ${opp.id}) as stage`;
    expect(counts).toEqual({ opportunities: 1, runs: 2, stage: "interested" });
  });

  test("stored rows decode into the engine types (no drift between schema and domain model)", async () => {
    const { data, error } = await user.db
      .from("opportunities")
      .select("id, engine_key, source_relationship_id, pattern_id, kind, title, types, summary, why_exists, why_now, structure, evidence, assumptions, unknowns, questions, risks, next_step, missing_capabilities, driving_need_ids, confidence, critic, stage, stage_history, trigger, engine, delta, discovered_at, opportunity_participants(company_id, role, contributions, position)")
      .eq("organization_id", orgId);
    expect(error).toBeNull();
    expect(() => OpportunityRow.array().parse(data)).not.toThrow();
  });

  test("a relationship the critic holds back is stored with its rejected hypotheses and watch conditions", async () => {
    const org = await createOrganization(user.db, { name: "Dormant Org" });
    const dormant = await importDemoRelationship(repositorySink(user.db, org), "r-maya-sophie");
    const outcome = await evaluateRelationshipForOrganization(user.db, { userId: user.id, organizationId: org, relationshipId: dormant.relationshipId, now: new Date(DEMO_NOW) });
    const ref = referenceEvaluation("r-maya-sophie");
    expect(outcome.outcome).toBe("no-strong-opportunity");
    expect(outcome.heldBack.map((h) => h.title)).toEqual(ref.result.evaluated.filter((e) => e.critique.report.verdict !== "pass").map((e) => e.draft.title));

    const [run] = await sql`select watch_conditions, rejected_hypotheses from public.analysis_runs where relationship_id = ${dormant.relationshipId}`;
    expect(run.rejected_hypotheses.map((h: { patternId: string }) => h.patternId)).toContain("channel-distribution");
    expect(run.watch_conditions.flatMap((w: { tags: string[] }) => w.tags)).toContain("eu-support");
    const [rel] = await sql`select status::text as status from public.relationships where id = ${dormant.relationshipId}`;
    expect(rel.status).toBe("dormant");
  });
});

describe("persisted data survives a new session", () => {
  test("companies written earlier are loaded from the database, not from any client cache", async () => {
    const db = await freshSession(user);
    expect((await listCompanies(db, orgId)).map((c) => c.name).sort()).toEqual(["EdgeVision", "EuroCompute"]);
  });

  test("the language preference is saved on the profile", async () => {
    await updateProfile(user.db, user.id, { locale: "fr" });
    expect((await getProfile(await freshSession(user), user.id))?.locale).toBe("fr");
  });

  test("the database rejects unsupported languages", async () => {
    const r = await user.db.from("profiles").update({ locale: "de" }).eq("id", user.id);
    expect(r.error?.code).toBe("23514");
  });
});
