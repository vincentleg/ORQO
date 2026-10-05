/**
 * ORQO mission engine — shared vocabulary (Phase 17B).
 *
 * A mission is a deterministic, versioned plan of steps that ORQO executes for the user. A step either
 * delegates to ONE ordinary agent run (a child run: the Phase 4 run system under a Phase 17A authority), or
 * is an internal step (fan-out, compile). Pure and framework-free: no model ever decides a plan, a step, a
 * transition, a retry or a finding.
 */

export const MISSION_TEMPLATES = ["research_company", "prospect_known_candidates", "prospect_and_research"] as const;
export type MissionTemplateId = (typeof MISSION_TEMPLATES)[number];

export const MISSION_STATUSES = ["planned", "running", "completed", "failed", "cancelled"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const MISSION_STEP_STATUSES = ["pending", "leased", "completed", "failed", "skipped", "cancelled"] as const;
export type MissionStepStatus = (typeof MISSION_STEP_STATUSES)[number];

/** child_run: one agent run · fanout: plans child steps from earlier findings · compile: the mission summary. */
export const STEP_KINDS = ["child_run", "fanout", "compile"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const FINDING_KINDS = ["company_analysis", "prospect", "prospecting_summary", "profile_gap", "mission_summary"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** Step failure codes that the engine itself produces (child runs report their RunFailure code). */
export const STEP_FAILURES = ["invalid_step", "attempts_exhausted", "quota_exhausted", "plan_required", "role", "approval_required", "not_free", "internal"] as const;
export type StepFailure = (typeof STEP_FAILURES)[number];

/** Operator safety limits (not commercial quotas). */
export const MISSION_LIMITS = {
  /** Missions per organization in a rolling window (create_mission). */
  maxPerWindow: 20,
  windowHours: 24,
  /** Planned or running missions per organization at once. */
  maxActive: 3,
  /** Steps per mission, fan-out children included (also enforced by the database). */
  maxSteps: 24,
  /** Children a fan-out step may plan. */
  maxFanout: 3,
  /**
   * A lease outlives any request that holds it (route maxDuration 150 s, agent run budget ≤ 130 s), so an
   * expired lease always means its executor stopped. Recovery reclaims it.
   */
  leaseSeconds: 200,
  /** Child runs executed per execute call: a child run can take up to ~130 s, one fits in one request. */
  childRunsPerSlice: 1,
} as const;
