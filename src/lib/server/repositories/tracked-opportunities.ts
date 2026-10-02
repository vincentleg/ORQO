/**
 * Tracked opportunities (Phase 16A): "this is worth pursuing", remembered.
 *
 * The browser is never trusted. It names a remembered company and a scenario key, nothing else.
 * Tracking then:
 * - verifies the company belongs to the organization (and is not its own company);
 * - recomputes that company's dossier from stored evidence;
 * - requires the dossier verdict "opportunity" and a CREDIBLE scenario with that key;
 * - only then stores a snapshot the server built.
 * Weak, rejected, insufficient and "no credible opportunity" results cannot be tracked.
 *
 * Every query runs as the signed-in user (RLS is the backstop) and filters on the organization.
 * Not a CRM: four statuses, no amounts, no owners, no stages, no forecast.
 */
import { z } from "zod";
import { AppError, fromDbError, parseInput } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";
import { trackableScenario, type Dossier } from "@/lib/understanding/dossier";
import type { RelationshipAssessment } from "@/lib/understanding/relationship";
import type { Scenario } from "@/lib/understanding/scenarios";
import { getCompanyDossier } from "./understanding";

export const TRACKED_STATUSES = ["investigating", "validated", "paused", "closed"] as const;
export type TrackedStatus = (typeof TRACKED_STATUSES)[number];

const SCENARIO_KEY = /^[a-z_]{2,60}:(own|target)$/;
const TEXT_MAX = 300;
const clip = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s);

/** What ORQO knew when the opportunity was tracked. Built by the server from its own dossier. */
export interface TrackedSnapshot {
  v: 1;
  ownName: string;
  targetName: string;
  asOf: string | null;
  scenario: Scenario;
  relationship: Pick<RelationshipAssessment, "status" | "roles"> & { links: { role: string; state: string; source: string; statement: string | null }[] };
}

export interface TrackedOpportunity {
  id: string;
  targetCompanyId: string;
  targetName: string;
  scenarioKey: string;
  mechanism: string;
  status: TrackedStatus;
  snapshot: TrackedSnapshot;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const TrackInput = z.strictObject({
  targetCompanyId: z.uuid(),
  scenarioKey: z.string().regex(SCENARIO_KEY),
});

export const StatusInput = z.strictObject({ status: z.enum(TRACKED_STATUSES) });

/** The snapshot keeps the scenario as computed, with long texts clipped (evidence is quoted, not copied). */
export function snapshotOf(d: Dossier, s: Scenario): TrackedSnapshot {
  const support = (c: Scenario["contributions"]["provider"]) => ({ ...c, support: c.support.slice(0, 6).map((x) => ({ ...x, value: clip(x.value) })) });
  return {
    v: 1,
    ownName: d.ownName,
    targetName: d.targetName,
    asOf: d.asOf,
    scenario: { ...s, contributions: { provider: support(s.contributions.provider), partner: support(s.contributions.partner) }, whyNow: s.whyNow.map((w) => ({ ...w, statement: clip(w.statement) })) },
    relationship: { status: d.relationship.status, roles: d.relationship.roles, links: d.relationship.links.map((l) => ({ role: l.role, state: l.state, source: l.source, statement: l.statement ? clip(l.statement) : null })) },
  };
}

const Row = z.object({
  id: z.uuid(),
  target_company_id: z.uuid(),
  scenario_key: z.string(),
  mechanism: z.string(),
  status: z.enum(TRACKED_STATUSES),
  snapshot: z.record(z.string(), z.unknown()),
  status_changed_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  companies: z.object({ name: z.string() }).nullable(),
});
const COLUMNS = "id, target_company_id, scenario_key, mechanism, status, snapshot, status_changed_at, created_at, updated_at, companies(name)";

function toTracked(r: z.infer<typeof Row>): TrackedOpportunity {
  const snapshot = r.snapshot as unknown as TrackedSnapshot;
  return {
    id: r.id,
    targetCompanyId: r.target_company_id,
    targetName: r.companies?.name ?? snapshot.targetName,
    scenarioKey: r.scenario_key,
    mechanism: r.mechanism,
    status: r.status,
    snapshot,
    statusChangedAt: new Date(r.status_changed_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/**
 * Tracks a credible opportunity. Idempotent: tracking the same scenario of the same company again returns the
 * existing record (created: false).
 */
export async function trackOpportunity(db: Db, organizationId: string, raw: unknown): Promise<{ id: string; created: boolean }> {
  const input = parseInput(TrackInput, raw);
  const resolved = await getCompanyDossier(db, organizationId, input.targetCompanyId);
  if (!resolved) throw new AppError("not_found", "Company not found.");
  const { dossier, intel } = resolved;
  const scenario = dossier ? trackableScenario(dossier, input.scenarioKey) : null;
  if (!dossier || !scenario) throw new AppError("conflict", "Only a credible opportunity can be tracked.");

  const existing = await db.from("tracked_opportunities").select("id").eq("organization_id", organizationId).eq("target_company_id", resolved.company.id).eq("scenario_key", scenario.key).maybeSingle();
  if (existing.error) throw fromDbError(existing.error);
  if (existing.data) return { id: z.uuid().parse(existing.data.id), created: false };

  const { data, error } = await db
    .from("tracked_opportunities")
    .insert({ organization_id: organizationId, target_company_id: resolved.company.id, intelligence_id: intel?.id ?? null, scenario_key: scenario.key, mechanism: scenario.mechanism, snapshot: snapshotOf(dossier, scenario) })
    .select("id")
    .single();
  if (error) {
    // A concurrent request tracked it first: same outcome.
    if (error.code === "23505") {
      const again = await db.from("tracked_opportunities").select("id").eq("organization_id", organizationId).eq("target_company_id", resolved.company.id).eq("scenario_key", scenario.key).single();
      if (again.error) throw fromDbError(again.error);
      return { id: z.uuid().parse(again.data.id), created: false };
    }
    throw fromDbError(error);
  }
  return { id: z.uuid().parse(data.id), created: true };
}

export async function listTrackedOpportunities(db: Db, organizationId: string, filter: { companyId?: string } = {}): Promise<TrackedOpportunity[]> {
  let q = db.from("tracked_opportunities").select(COLUMNS).eq("organization_id", organizationId);
  if (filter.companyId) {
    if (!z.uuid().safeParse(filter.companyId).success) return [];
    q = q.eq("target_company_id", filter.companyId);
  }
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(100);
  if (error) throw fromDbError(error);
  return z.array(Row).parse(data ?? []).map(toTracked);
}

export async function getTrackedOpportunity(db: Db, organizationId: string, id: string): Promise<TrackedOpportunity | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await db.from("tracked_opportunities").select(COLUMNS).eq("organization_id", organizationId).eq("id", id).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? toTracked(Row.parse(data)) : null;
}

/** Changes the status only (the database grants nothing else). Not found when the id is not this organization's. */
export async function setTrackedStatus(db: Db, organizationId: string, id: string, raw: unknown): Promise<TrackedOpportunity> {
  const { status } = parseInput(StatusInput, raw);
  if (!z.uuid().safeParse(id).success) throw new AppError("not_found", "Opportunity not found.");
  const { data, error } = await db.from("tracked_opportunities").update({ status }).eq("organization_id", organizationId).eq("id", id).select(COLUMNS).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new AppError("not_found", "Opportunity not found.");
  return toTracked(Row.parse(data));
}
