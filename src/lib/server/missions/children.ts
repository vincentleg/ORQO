import "server-only";
/**
 * Mission child runs (Phase 17B) over the EXISTING execution architecture: a child run is an ordinary agent
 * run — create_agent_mission (idempotency, one concurrent run, quota) → Authority Contract frozen by
 * set_agent_run_authority → the Phase 4 orchestrator (executeRun) with the registered tools.
 *
 * Free capabilities only:
 *   - the child input is restricted (Research Basic; Prospecting over workspace knowledge);
 *   - the authority is built with a $0 envelope and network ≤ official_sites, then checked (isFreeAuthority);
 *   - the discovery gateway has no web source, so no paid search is reachable even in principle.
 * The child is re-authorized against CURRENT entitlement and role every time it starts or resumes.
 */
import { AgentResultSchema, type MissionInput } from "@/lib/agents/contracts";
import { isTerminal } from "@/lib/agents/state";
import type { MissionType } from "@/lib/agents/types";
import { buildAuthority, sameAuthority, type AuthorityContract } from "@/lib/governance/authority";
import type { Locale } from "@/lib/i18n/config";
import { FREE_ENVELOPE, freeChildInput, isFreeAuthority, MISSION_AUTONOMY, type ChildRunSpec } from "@/lib/missions/contracts";
import { childAction, isRetryable } from "@/lib/missions/recovery";
import { AGENT_QUOTA, AGENT_RUN_STALE_AFTER_SECONDS } from "@/lib/server/agents/config";
import { AgentDeniedError, authorizeMission, type AuthorizedMission } from "@/lib/server/agents/gate";
import { executeRun } from "@/lib/server/agents/orchestrator";
import { AgentRunRefusedError, dbRunStore, getRun } from "@/lib/server/agents/repository";
import { TOOL_IMPLEMENTATIONS, type DiscoveryGateway, type ResearchGateway } from "@/lib/server/agents/tools";
import { resolveEntitlement } from "@/lib/server/entitlements";
import { getRunAuthority, recordTripwire, setRunAuthority } from "@/lib/server/governance/ledger";
import type { Db } from "@/lib/server/supabase/types";
import type { ChildOutcome, ChildRunner } from "./executor";
import { attachChildRun, LeaseLostError } from "./repository";

/** Mission children never get a web candidate source (paid search is out of 17B by construction). */
const NO_WEB_DISCOVERY: DiscoveryGateway = { webSource: () => null, webEntitled: async () => false };

const ZERO = { toolCalls: 0, modelCalls: 0, externalRequests: 0, costUsd: 0 };

export interface ChildRunnerContext {
  db: Db;
  organizationId: string;
  userId: string;
  locale: Locale;
  /** The governed Phase 3 research entry point (Basic only is reachable). null: no web access at all (tests). */
  research: ResearchGateway | null;
}

function childObjective(missionType: MissionType, input: Record<string, unknown>): string {
  const t = input.target as { query?: string; companyId?: string } | undefined;
  if (t) return `mission · ${missionType} · ${t.query ?? `company:${t.companyId}`}`;
  return ["mission", missionType, input.intent, input.objective, input.market, input.geography].filter((x) => typeof x === "string" && x).join(" · ");
}

export function dbChildRunner(ctx: ChildRunnerContext): ChildRunner {
  const { db, organizationId: org, userId } = ctx;
  const store = dbRunStore(db, org);

  /** The authority the server itself builds for this child: registry ∩ entitlement ∩ the free envelope. */
  const expectedAuthority = async (auth: AuthorizedMission, ids: { missionId: string; runId: string }): Promise<AuthorityContract> =>
    buildAuthority({ principal: { organizationId: org, userId }, entitlement: await resolveEntitlement(org), agent: auth.agent, capability: auth.capability, autonomy: auth.autonomy, envelope: { ...FREE_ENVELOPE }, ids });

  async function closeRun(runId: string, code: "interrupted" | "tool_denied"): Promise<void> {
    const r = await getRun(db, org, runId);
    if (r && !isTerminal(r.status)) await store.failRun(r.id, r.mission_id, { code, counters: ZERO, durationMs: 0 });
  }

  return {
    async run(step, spec: ChildRunSpec, previous, lease): Promise<ChildOutcome> {
      const action = childAction(previous, userId);
      if (action.kind === "adopt") {
        const r = await getRun(db, org, action.runId);
        const result = AgentResultSchema.safeParse(r?.result);
        // A completed run is never executed again: its stored, contract-checked result is the step's result.
        if (r?.status === "completed" && result.success) return { status: "completed", runId: r.id, result: result.data, adopted: true };
        return { status: "failed", runId: action.runId, code: "internal", retry: true };
      }
      if (action.kind === "adopt_failure") return { status: "failed", runId: action.runId, code: action.code, retry: isRetryable(action.code) };
      // The previous attempt's executor is gone (its lease expired): close its run before starting another.
      if (action.kind === "interrupt") await closeRun(action.runId, "interrupted");

      const input = freeChildInput(spec.missionType, spec.input);
      if (!input) return { status: "failed", runId: null, code: "not_free", retry: false };
      let auth: AuthorizedMission;
      try {
        auth = await authorizeMission(db, userId, org, { agentId: null, missionType: spec.missionType, autonomy: MISSION_AUTONOMY });
      } catch (e) {
        if (e instanceof AgentDeniedError) return { status: "failed", runId: null, code: e.reason === "plan_required" || e.reason === "role" ? e.reason : "tool_denied", retry: false };
        throw e;
      }

      let runId: string;
      let agentMissionId: string;
      if (action.kind === "resume") {
        const r = await getRun(db, org, action.runId);
        if (!r || r.status !== "queued") return { status: "failed", runId: action.runId, code: "interrupted", retry: true };
        runId = r.id;
        agentMissionId = r.mission_id;
      } else {
        try {
          const created = await attachChildRun(db, org, step.id, lease, {
            agentId: auth.agent.id,
            missionType: spec.missionType,
            capability: auth.capability,
            objective: childObjective(spec.missionType, input as Record<string, unknown>),
            input: input as Record<string, unknown>,
            autonomy: auth.autonomy,
            limits: auth.agent.limits as unknown as Record<string, unknown>,
            maxRuns: AGENT_QUOTA.maxRunsPerOrg,
            windowHours: AGENT_QUOTA.windowHours,
            staleAfterSeconds: AGENT_RUN_STALE_AFTER_SECONDS,
          });
          runId = created.runId;
          agentMissionId = created.missionId;
          if (created.reused) {
            // Same step and attempt asked twice: the existing run is the attempt's run.
            const r = await getRun(db, org, runId);
            if (r?.status === "completed") {
              const result = AgentResultSchema.safeParse(r.result);
              if (result.success) return { status: "completed", runId, result: result.data, adopted: true };
            }
            if (!r || r.status !== "queued") return { status: "failed", runId, code: r?.error_code ?? "internal", retry: isRetryable(r?.error_code ?? "internal") };
          }
        } catch (e) {
          if (e instanceof AgentRunRefusedError) return e.reason === "busy" ? { status: "busy" } : { status: "failed", runId: null, code: "quota_exhausted", retry: false };
          if (e instanceof LeaseLostError) return { status: "lease_lost" };
          throw e;
        }
      }

      // Authority: exactly what the server builds for this child, free, frozen before the run starts.
      const expected = await expectedAuthority(auth, { missionId: agentMissionId, runId });
      if (!isFreeAuthority(expected)) {
        await recordTripwire(db, org, "privilege_expansion", runId, "mission_child");
        await closeRun(runId, "tool_denied");
        return { status: "failed", runId, code: "not_free", retry: false };
      }
      const stored = await getRunAuthority(db, org, runId);
      if (stored && !sameAuthority(stored, expected)) {
        await recordTripwire(db, org, "authority_modification", runId, "mission_child");
        await closeRun(runId, "tool_denied");
        return { status: "failed", runId, code: "not_free", retry: false };
      }
      if (!stored) await setRunAuthority(db, org, runId, expected);

      const outcome = await executeRun(
        {
          store,
          tools: TOOL_IMPLEMENTATIONS,
          env: { db, organizationId: org, userId, locale: ctx.locale, research: ctx.research, discovery: NO_WEB_DISCOVERY, authority: expected },
          onTripwire: (t, d) => recordTripwire(db, org, t, runId, d),
        },
        { runId, missionId: agentMissionId, agent: auth.agent, capability: auth.capability, autonomy: auth.autonomy, missionType: spec.missionType, input: input as MissionInput<"analyze_company"> | MissionInput<"discover_companies">, approvedTools: [], resumed: false, authority: expected },
      );
      if (outcome.status === "completed") return { status: "completed", runId, result: outcome.result, adopted: false };
      if (outcome.status === "failed") return { status: "failed", runId, code: outcome.code, retry: isRetryable(outcome.code) };
      // A free authority holds no approval-gated tool; should a run still wait, it is closed, never left open.
      await closeRun(runId, "tool_denied");
      return { status: "failed", runId, code: "approval_required", retry: false };
    },
  };
}
