/**
 * Mission view fixtures for Phase 17C tests (never imported by application code). `goldenView` runs a golden
 * mission through the real Phase 17B executor and orchestrator (in memory) and returns the public view the
 * API would serve, so the experience is tested against real findings, not hand-written payloads.
 */
import { executeMissionSlice } from "@/lib/server/missions/executor";
import { FixtureChildRunner, fixtureWorld, MemoryMissionStore } from "@/lib/server/missions/testing";
import { planMission } from "./contracts";
import { GOLDEN_WORLD } from "./golden";
import type { MissionStepView, MissionView } from "./view";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export function viewOf(store: MemoryMissionStore, plan: NonNullable<ReturnType<typeof planMission>>): MissionView {
  const steps: MissionStepView[] = [...store.stepRows]
    .sort((a, b) => a.seq - b.seq)
    .map((s) => {
      const target = (s.spec as { input?: { target?: { query?: string; companyId?: string } } }).input?.target;
      return {
        seq: s.seq,
        key: s.key,
        kind: s.kind,
        required: s.required,
        status: s.status,
        attempt: s.attempt,
        maxAttempts: s.maxAttempts,
        recoveries: s.recoveries,
        leaseExpiresAt: null,
        childRunId: s.childRunId,
        error: s.errorCode,
        result: s.result,
        subject: s.kind === "child_run" && target ? (target.query ? { query: target.query } : { companyId: target.companyId as string }) : null,
        startedAt: s.attempt > 0 ? "2026-10-05T10:00:00Z" : null,
        finishedAt: null,
      };
    });
  const n = (st: string) => steps.filter((s) => s.status === st).length;
  return {
    mission: { id: store.missionId, template: plan.template, templateVersion: plan.templateVersion, objective: plan.objective, input: plan.input, status: store.status, failureReason: store.failureReason, createdAt: "2026-10-05T10:00:00Z", startedAt: "2026-10-05T10:00:00Z", finishedAt: ["completed", "failed", "cancelled"].includes(store.status) ? "2026-10-05T10:05:00Z" : null },
    progress: { total: steps.length, pending: n("pending"), leased: n("leased"), completed: n("completed"), failed: n("failed"), skipped: n("skipped"), cancelled: n("cancelled") },
    steps,
    findings: store.rows.map((f) => ({ id: f.id, key: f.key, kind: f.kind, subjectDomain: f.subjectDomain, stepKey: f.stepKey, agentRunId: f.agentRunId, payload: f.payload, createdAt: f.createdAt })),
    authority: { maxCostUsd: 0, paidProviders: false, webSearch: false, deepResearch: false },
    spend: { committedUsd: 0, settledUsd: 0, calls: 0 },
  };
}

/** Runs a mission (in memory) for `slices` execute calls (default: until terminal) and returns its view. */
export async function goldenView(template: string, input: Record<string, unknown>, opts: { slices?: number; prepare?: (store: MemoryMissionStore, children: FixtureChildRunner) => void } = {}): Promise<{ view: MissionView; store: MemoryMissionStore }> {
  const plan = planMission(template, input);
  if (!plan) throw new Error("bad plan");
  const store = new MemoryMissionStore(crypto.randomUUID(), plan.contract);
  const children = new FixtureChildRunner(store, fixtureWorld(GOLDEN_WORLD.own, GOLDEN_WORLD.stored), USER);
  opts.prepare?.(store, children);
  for (let i = 0; i < (opts.slices ?? 20); i++) {
    const r = await executeMissionSlice({ store, children, contract: plan.contract }, store.missionId);
    if (["completed", "failed", "cancelled"].includes(r.state)) break;
  }
  return { view: viewOf(store, plan), store };
}
