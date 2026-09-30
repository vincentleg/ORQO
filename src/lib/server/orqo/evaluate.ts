/**
 * Server-authoritative relationship evaluation for the production app. The
 * caller supplies only intent (organization + relationship ids). State is loaded
 * from Postgres as the signed-in user (RLS applies), run through the unchanged
 * ORQO engine, and the results are persisted.
 */
import { z } from "zod";
import { commitEvaluation, evaluateRelationship } from "@/lib/engine/pipeline";
import { AppError, fromDbError } from "@/lib/server/errors";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { Db } from "@/lib/server/supabase/types";
import { AnalysisRunRow, CapabilityRow, CompanyRow, ContactRow, NeedRow, OpportunityRow, RelationshipRow, SourceRow } from "./schemas";
import { analysisRunRowFor, buildEvaluationWorld, opportunityRowFor, participantRowsFor, type RelationshipSnapshot } from "./world";

const OPPORTUNITY_COLUMNS =
  "id, engine_key, source_relationship_id, pattern_id, kind, title, types, summary, why_exists, why_now, structure, evidence, assumptions, unknowns, questions, risks, next_step, missing_capabilities, driving_need_ids, confidence, critic, stage, stage_history, trigger, engine, delta, discovered_at, opportunity_participants(company_id, role, contributions, position)";

async function rows<T extends z.ZodType>(schema: T, query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<z.infer<T>[]> {
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return z.array(schema).parse(data);
}

export async function loadRelationshipSnapshot(db: Db, organizationId: string, relationshipId: string): Promise<RelationshipSnapshot> {
  if (!z.uuid().safeParse(relationshipId).success) throw new AppError("not_found", "Relationship not found.");
  const [relationship] = await rows(
    RelationshipRow,
    db
      .from("relationships")
      .select("id, organization_id, contact_a_id, contact_b_id, encounter_event, encounter_location, encountered_at, encounter_note, status, agents_connected_at, visibility")
      .eq("organization_id", organizationId)
      .eq("id", relationshipId),
  );
  if (!relationship) throw new AppError("not_found", "Relationship not found.");

  const contacts = await rows(
    ContactRow,
    db.from("contacts").select("id, company_id, name, role, location, bio").eq("organization_id", organizationId).in("id", [relationship.contact_a_id, relationship.contact_b_id]),
  );
  const companyIds = [...new Set(contacts.flatMap((c) => (c.company_id ? [c.company_id] : [])))];
  const empty = companyIds.length === 0;

  const [companies, capabilities, needs, runs, pairs] = await Promise.all([
    empty ? [] : rows(CompanyRow, db.from("companies").select("id, organization_id, name, website, tagline, summary, headquarters, size, markets, geographies, objectives, constraints, is_own_company, created_at").eq("organization_id", organizationId).in("id", companyIds)),
    empty ? [] : rows(CapabilityRow, db.from("company_capabilities").select("id, company_id, label, detail, tags, evidence, visibility, observed_at").eq("organization_id", organizationId).in("company_id", companyIds).order("created_at")),
    empty ? [] : rows(NeedRow, db.from("company_needs").select("id, company_id, label, detail, tags, intensity, evidence, visibility, disclosure, observed_at").eq("organization_id", organizationId).in("company_id", companyIds).order("created_at")),
    rows(AnalysisRunRow, db.from("analysis_runs").select("id, engine, trigger, outcome, summary, rejected_hypotheses, watch_conditions, opportunity_ids, ran_at").eq("organization_id", organizationId).eq("relationship_id", relationshipId).order("ran_at")),
    empty ? [] : rows(z.object({ opportunity_id: z.uuid(), company_id: z.uuid() }), db.from("opportunity_participants").select("opportunity_id, company_id").eq("organization_id", organizationId).in("company_id", companyIds)),
  ]);

  // Existing opportunities between exactly these companies keep their lifecycle stage on re-evaluation.
  const byOpportunity = new Map<string, Set<string>>();
  for (const p of pairs) byOpportunity.set(p.opportunity_id, (byOpportunity.get(p.opportunity_id) ?? new Set()).add(p.company_id));
  const sharedIds = [...byOpportunity].filter(([, cs]) => companyIds.every((id) => cs.has(id))).map(([id]) => id);
  const opportunities = sharedIds.length === 0 ? [] : await rows(OpportunityRow, db.from("opportunities").select(OPPORTUNITY_COLUMNS).eq("organization_id", organizationId).in("id", sharedIds));

  const sourceIds = [...new Set([...capabilities, ...needs].flatMap((x) => x.evidence.map((e) => e.sourceId)))].filter((id) => z.uuid().safeParse(id).success);
  const sources = sourceIds.length === 0 ? [] : await rows(SourceRow, db.from("sources").select("id, kind, label, url, retrieved_at, simulated").eq("organization_id", organizationId).in("id", sourceIds));

  return { relationship, contacts, companies, capabilities, needs, sources, opportunities, runs };
}

export interface EvaluationOutcome {
  analysisRunId: string;
  outcome: "opportunity" | "no-strong-opportunity";
  summary: string;
  opportunities: { id: string; title: string; confidence: string; created: boolean }[];
  heldBack: { title: string; verdict: string }[];
}

export async function evaluateRelationshipForOrganization(
  db: Db,
  input: { userId: string; organizationId: string; relationshipId: string; now?: Date },
): Promise<EvaluationOutcome> {
  await requireMembership(db, input.userId, input.organizationId, "member");
  const snapshot = await loadRelationshipSnapshot(db, input.organizationId, input.relationshipId);
  const world = buildEvaluationWorld(snapshot, (input.now ?? new Date()).toISOString());

  const result = evaluateRelationship(world, input.relationshipId);
  const commit = commitEvaluation(world, result, { kind: "connection" }, "deterministic");

  const engineKeys = [...commit.created, ...commit.updated];
  const uuidByKey = new Map<string, string>();
  const uuidOf = (key: string): string => {
    const id = uuidByKey.get(key);
    if (!id) throw new AppError("internal", "Opportunity was not persisted.");
    return id;
  };
  if (engineKeys.length > 0) {
    const payload = engineKeys.map((k) => opportunityRowFor(input.organizationId, commit.world.opportunities[k]));
    const { data, error } = await db.from("opportunities").upsert(payload, { onConflict: "organization_id,engine_key" }).select("id, engine_key");
    if (error) throw fromDbError(error);
    for (const r of z.array(z.object({ id: z.uuid(), engine_key: z.string() })).parse(data)) uuidByKey.set(r.engine_key, r.id);

    const participants = engineKeys.flatMap((k) => participantRowsFor(input.organizationId, uuidOf(k), commit.world.opportunities[k]));
    const parts = await db.from("opportunity_participants").upsert(participants, { onConflict: "opportunity_id,company_id" });
    if (parts.error) throw fromDbError(parts.error);
  }

  const rel = commit.world.relationships[input.relationshipId];
  const relUpdate = await db
    .from("relationships")
    .update({ status: rel.status, agents_connected_at: rel.agentsConnectedAt ?? world.now })
    .eq("organization_id", input.organizationId)
    .eq("id", input.relationshipId);
  if (relUpdate.error) throw fromDbError(relUpdate.error);

  const opportunityUuids = commit.evaluation.opportunityIds.map(uuidOf);
  const run = await db
    .from("analysis_runs")
    .insert(analysisRunRowFor(input.organizationId, input.relationshipId, commit.evaluation, result.stages, opportunityUuids))
    .select("id")
    .single();
  if (run.error) throw fromDbError(run.error);

  return {
    analysisRunId: z.object({ id: z.uuid() }).parse(run.data).id,
    outcome: commit.evaluation.outcome,
    summary: commit.evaluation.summary,
    opportunities: commit.evaluation.opportunityIds.map((k) => ({
      id: uuidOf(k),
      title: commit.world.opportunities[k].title,
      confidence: commit.world.opportunities[k].confidence.level,
      created: commit.created.includes(k),
    })),
    heldBack: commit.evaluation.rejectedHypotheses.map((h) => ({ title: h.title, verdict: h.verdict })),
  };
}
