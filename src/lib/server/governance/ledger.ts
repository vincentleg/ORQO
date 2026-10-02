/**
 * Governance persistence (Phase 17A): the authority snapshot of a run, the provider spend ledger and
 * tripwire audit events. Every call runs as the signed-in user; the database functions check membership,
 * the run's authority and the caps, under an organization lock. Nothing here can widen authority or spend.
 */
import "server-only";
import { z } from "zod";
import { AuthoritySchema, parseAuthority, type AuthorityContract, type Provider } from "@/lib/governance/authority";
import { BUDGET_WINDOW_DAYS } from "@/lib/governance/entitlement";
import type { Tripwire } from "@/lib/governance/tripwire";
import { fromDbError } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";

/** Freezes the authority of a queued run (once). A parent run makes it a delegated child (17B). */
export async function setRunAuthority(db: Db, organizationId: string, runId: string, authority: AuthorityContract, parentRunId: string | null = null): Promise<void> {
  const checked = AuthoritySchema.parse(authority);
  const { error } = await db.rpc("set_agent_run_authority", { p_organization_id: organizationId, p_run_id: runId, p_authority: checked, p_parent_run_id: parentRunId });
  if (error) throw fromDbError(error);
}

/** The frozen authority of a run, or null (absent or malformed is treated as no authority at all). */
export async function getRunAuthority(db: Db, organizationId: string, runId: string): Promise<AuthorityContract | null> {
  const { data, error } = await db.from("agent_runs").select("authority").eq("organization_id", organizationId).eq("id", runId).maybeSingle();
  if (error) throw fromDbError(error);
  return parseAuthority(data?.authority ?? null);
}

export type ReservationRefusal = "ceiling" | "run_cost" | "run_calls" | "outside_authority" | "invalid" | "duplicate";

export class ReservationRefused extends Error {
  constructor(readonly refusal: ReservationRefusal) {
    super(`Spend reservation refused: ${refusal}.`);
  }
}

export interface ReservationRequest {
  organizationId: string;
  agentRunId: string | null;
  researchRunId: string | null;
  provider: Provider;
  task: string;
  model: string | null;
  amountUsd: number;
  ceilingUsd: number;
  idempotencyKey: string;
}

/**
 * Reserves a call's worst case before it is sent. Throws ReservationRefused when a cap would be exceeded, and
 * ("duplicate") when this exact call was already reserved: the caller must not send it a second time.
 */
export async function reserveSpend(db: Db, r: ReservationRequest): Promise<string> {
  const { data, error } = await db.rpc("reserve_provider_spend", {
    p_organization_id: r.organizationId,
    p_agent_run_id: r.agentRunId,
    p_research_run_id: r.researchRunId,
    p_provider: r.provider,
    p_task: r.task,
    p_model: r.model,
    p_amount_usd: r.amountUsd,
    p_ceiling_usd: r.ceilingUsd,
    p_window_days: BUDGET_WINDOW_DAYS,
    p_idempotency_key: r.idempotencyKey,
  });
  if (error) {
    if (error.code === "54001") throw new ReservationRefused("ceiling");
    if (error.code === "54002") throw new ReservationRefused("run_cost");
    if (error.code === "54003") throw new ReservationRefused("run_calls");
    if (error.code === "42501") throw new ReservationRefused("outside_authority");
    if (error.code === "22023") throw new ReservationRefused("invalid");
    throw fromDbError(error);
  }
  const res = z.strictObject({ id: z.uuid(), reused: z.boolean() }).parse(data);
  if (res.reused) throw new ReservationRefused("duplicate");
  return res.id;
}

/** Settles once: reported cost, or the full reservation when unknown; "not_sent" releases it. */
export async function settleSpend(db: Db, organizationId: string, reservationId: string, outcome: "succeeded" | "failed" | "not_sent", costUsd: number | null): Promise<void> {
  const { error } = await db.rpc("settle_provider_spend", { p_organization_id: organizationId, p_reservation_id: reservationId, p_outcome: outcome, p_cost_usd: costUsd !== null && Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : null });
  if (error) throw fromDbError(error);
}

/** Audits a tripwire (governance.tripwire.<kind>). Never throws: the denial itself is what protects. */
export async function recordTripwire(db: Db, organizationId: string, tripwire: Tripwire, agentRunId: string | null, detail: string | null): Promise<void> {
  const safe = detail ? detail.toLowerCase().replace(/[^a-z0-9_:.,-]/g, "_").slice(0, 120) : null;
  const { error } = await db.rpc("record_governance_event", { p_organization_id: organizationId, p_tripwire: tripwire, p_agent_run_id: agentRunId, p_detail: safe });
  if (error) console.error("[orqo] tripwire audit failed", tripwire, error.code);
}

const SpendRow = z.object({
  id: z.uuid(),
  provider: z.string(),
  task: z.string(),
  model: z.string().nullable(),
  reserved_usd: z.coerce.number(),
  settled_usd: z.coerce.number().nullable(),
  cost_known: z.boolean().nullable(),
  outcome: z.string().nullable(),
  status: z.enum(["reserved", "settled", "released"]),
  agent_run_id: z.uuid().nullable(),
  research_run_id: z.uuid().nullable(),
  created_at: z.string(),
});
export type SpendRow = z.infer<typeof SpendRow>;

export interface SpendSummary {
  windowDays: number;
  reservedUsd: number;
  settledUsd: number;
  /** Settled plus still-reserved: what counts against the ceiling. */
  committedUsd: number;
  calls: number;
  unknownCostCalls: number;
  recent: SpendRow[];
}

/** The organization's spend over the rolling window (RLS: members of the organization only). */
export async function spendSummary(db: Db, organizationId: string): Promise<SpendSummary> {
  const since = new Date(Date.now() - BUDGET_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("provider_spend")
    .select("id, provider, task, model, reserved_usd, settled_usd, cost_known, outcome, status, agent_run_id, research_run_id, created_at")
    .eq("organization_id", organizationId)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw fromDbError(error);
  const rows = z.array(SpendRow).parse(data ?? []);
  const reserved = rows.filter((r) => r.status === "reserved").reduce((n, r) => n + r.reserved_usd, 0);
  const settled = rows.filter((r) => r.status !== "reserved").reduce((n, r) => n + (r.settled_usd ?? 0), 0);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { windowDays: BUDGET_WINDOW_DAYS, reservedUsd: round(reserved), settledUsd: round(settled), committedUsd: round(reserved + settled), calls: rows.length, unknownCostCalls: rows.filter((r) => r.status === "settled" && r.cost_known === false).length, recent: rows.slice(0, 20) };
}
