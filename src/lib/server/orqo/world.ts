/**
 * Adapter between persisted rows and the ORQO engine. Builds the minimal
 * `World` the engine needs to evaluate one relationship, and turns engine
 * output back into rows. Pure: no I/O, so it is tested without Supabase.
 */
import type { z } from "zod";
import type { Company, Evaluation, Opportunity, Person, Relationship, Source, World } from "@/lib/domain/types";
import { ORQO_INFERENCE_SOURCE } from "@/lib/engine/context";
import type { StageReport } from "@/lib/engine/pipeline";
import { AppError } from "@/lib/server/errors";
import type { AnalysisRunRow, CapabilityRow, CompanyRow, ContactRow, NeedRow, OpportunityRow, RelationshipRow, SourceRow } from "./schemas";

/** Neutral accent for production companies; the demo seeds its own colours. */
const DEFAULT_ACCENT = "#94A3B8";

export interface RelationshipSnapshot {
  relationship: z.infer<typeof RelationshipRow>;
  contacts: z.infer<typeof ContactRow>[];
  companies: CompanyRow[];
  capabilities: z.infer<typeof CapabilityRow>[];
  needs: z.infer<typeof NeedRow>[];
  sources: z.infer<typeof SourceRow>[];
  opportunities: OpportunityRow[];
  runs: z.infer<typeof AnalysisRunRow>[];
}

function toCompany(row: CompanyRow, s: RelationshipSnapshot): Company {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    summary: row.summary,
    headquarters: row.headquarters,
    size: row.size,
    markets: row.markets,
    geographies: row.geographies,
    offers: s.capabilities
      .filter((c) => c.company_id === row.id)
      .map((c) => ({ id: c.id, companyId: row.id, label: c.label, detail: c.detail, tags: c.tags, evidence: c.evidence, visibility: c.visibility, observedAt: c.observed_at })),
    needs: s.needs
      .filter((n) => n.company_id === row.id)
      .map((n) => ({
        id: n.id,
        companyId: row.id,
        label: n.label,
        detail: n.detail,
        tags: n.tags,
        intensity: n.intensity,
        evidence: n.evidence,
        visibility: n.visibility,
        disclosure: n.disclosure ?? undefined,
        observedAt: n.observed_at,
      })),
    objectives: row.objectives,
    constraints: row.constraints,
    accent: DEFAULT_ACCENT,
  };
}

function toOpportunity(row: OpportunityRow): Opportunity {
  const participants = [...row.opportunity_participants].sort((x, y) => x.position - y.position);
  return {
    id: row.engine_key,
    relationshipIds: row.source_relationship_id ? [row.source_relationship_id] : [],
    companyIds: participants.map((p) => p.company_id),
    patternId: row.pattern_id,
    kind: row.kind,
    roles: Object.fromEntries(participants.map((p) => [p.company_id, p.role])),
    drivingNeedIds: row.driving_need_ids,
    title: row.title,
    types: row.types,
    summary: row.summary,
    whyExists: row.why_exists,
    whyNow: row.why_now,
    contributions: participants.map((p) => ({ companyId: p.company_id, role: p.role, items: p.contributions })),
    structure: row.structure,
    evidence: row.evidence,
    assumptions: row.assumptions,
    unknowns: row.unknowns,
    questions: row.questions,
    risks: row.risks,
    nextStep: row.next_step,
    missingCapabilities: row.missing_capabilities,
    confidence: row.confidence,
    critic: row.critic,
    stage: row.stage,
    stageHistory: row.stage_history,
    discoveredAt: row.discovered_at,
    trigger: row.trigger,
    engine: row.engine,
    delta: row.delta ?? undefined,
  };
}

/** Builds the engine World for one relationship. `now` is real time in production (the demo keeps its own clock). */
export function buildEvaluationWorld(s: RelationshipSnapshot, now: string): World {
  const rel = s.relationship;
  const contact = (id: string) => s.contacts.find((c) => c.id === id);
  const a = contact(rel.contact_a_id);
  const b = contact(rel.contact_b_id);
  if (!a || !b) throw new AppError("not_found", "Relationship contacts not found.");
  if (!a.company_id || !b.company_id) throw new AppError("invalid_input", "Both contacts must belong to a company before the relationship can be evaluated.");
  if (a.company_id === b.company_id) throw new AppError("invalid_input", "The two contacts must belong to different companies.");
  const companyIds: [string, string] = [a.company_id, b.company_id];
  const companies = companyIds.map((id) => {
    const row = s.companies.find((c) => c.id === id);
    if (!row) throw new AppError("not_found", "Relationship companies not found.");
    return toCompany(row, s);
  });

  const people: Person[] = [a, b].map((c) => ({ id: c.id, name: c.name, role: c.role, companyId: c.company_id ?? "", location: c.location, bio: c.bio }));
  const sources: Source[] = [
    ...s.sources.map((x) => ({ id: x.id, kind: x.kind, label: x.label, url: x.url ?? undefined, retrievedAt: x.retrieved_at, simulated: x.simulated })),
    { id: ORQO_INFERENCE_SOURCE, kind: "agent-inferred", label: "ORQO agent inference", retrievedAt: now, simulated: false },
  ];
  const opportunities = s.opportunities.map(toOpportunity);
  const engineKeyOf = new Map(s.opportunities.map((o) => [o.id, o.engine_key]));
  const evaluations: Evaluation[] = s.runs.map((r) => ({
    id: r.id,
    at: r.ran_at,
    trigger: r.trigger,
    outcome: r.outcome,
    opportunityIds: r.opportunity_ids.flatMap((id) => engineKeyOf.get(id) ?? []),
    rejectedHypotheses: r.rejected_hypotheses,
    watchConditions: r.watch_conditions,
    summary: r.summary,
    engine: r.engine,
  }));
  const relationship: Relationship = {
    id: rel.id,
    personIds: [a.id, b.id],
    companyIds,
    encounter: { event: rel.encounter_event, location: rel.encounter_location, date: rel.encountered_at ?? now, note: rel.encounter_note },
    status: rel.status,
    agentsConnectedAt: rel.agents_connected_at ?? undefined,
    evaluations,
    visibility: rel.visibility,
  };

  return {
    now,
    viewerId: a.id,
    people: Object.fromEntries(people.map((p) => [p.id, p])),
    companies: Object.fromEntries(companies.map((c) => [c.id, c])),
    sources: Object.fromEntries(sources.map((x) => [x.id, x])),
    relationships: { [rel.id]: relationship },
    opportunities: Object.fromEntries(opportunities.map((o) => [o.id, o])),
    consents: [],
    briefs: {},
    signals: {},
    outcomes: [],
    activity: [],
    proposals: {},
  };
}

/** Row payload for upserting an engine opportunity (keyed by organization_id + engine_key). */
export function opportunityRowFor(organizationId: string, o: Opportunity) {
  return {
    organization_id: organizationId,
    engine_key: o.id,
    source_relationship_id: o.relationshipIds[0] ?? null,
    pattern_id: o.patternId,
    kind: o.kind,
    title: o.title,
    types: o.types,
    summary: o.summary,
    why_exists: o.whyExists,
    why_now: o.whyNow,
    structure: o.structure,
    evidence: o.evidence,
    assumptions: o.assumptions,
    unknowns: o.unknowns,
    questions: o.questions,
    risks: o.risks,
    next_step: o.nextStep,
    missing_capabilities: o.missingCapabilities,
    driving_need_ids: o.drivingNeedIds,
    confidence: o.confidence,
    critic: o.critic,
    stage: o.stage,
    stage_history: o.stageHistory,
    trigger: o.trigger,
    engine: o.engine,
    delta: o.delta ?? null,
    discovered_at: o.discoveredAt,
  };
}

export function participantRowsFor(organizationId: string, opportunityUuid: string, o: Opportunity) {
  return o.contributions.map((c, position) => ({
    organization_id: organizationId,
    opportunity_id: opportunityUuid,
    company_id: c.companyId,
    role: o.roles[c.companyId] ?? c.role,
    contributions: c.items,
    position,
  }));
}

export function analysisRunRowFor(
  organizationId: string,
  relationshipId: string,
  evaluation: Evaluation,
  stages: StageReport[],
  opportunityUuids: string[],
) {
  return {
    organization_id: organizationId,
    relationship_id: relationshipId,
    kind: "relationship_evaluation" as const,
    engine: evaluation.engine,
    trigger: evaluation.trigger,
    outcome: evaluation.outcome,
    summary: evaluation.summary,
    rejected_hypotheses: evaluation.rejectedHypotheses,
    watch_conditions: evaluation.watchConditions,
    stages,
    opportunity_ids: opportunityUuids,
    ran_at: evaluation.at,
  };
}
