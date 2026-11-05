/**
 * Agent execution policy numbers (Phase 4). These are operator safety limits,
 * not commercial quotas — no pricing or plan allowance is defined here.
 */

/** Agent runs per organization in a rolling window, enforced atomically by create_agent_mission. */
export const AGENT_QUOTA = { maxRunsPerOrg: 30, windowHours: 24 };

/** A queued/running agent run older than this no longer blocks new runs (crashed process). Longest run budget is 130 s. */
export const AGENT_RUN_STALE_AFTER_SECONDS = 180;

/** Approval requests expire after this many hours. */
export const APPROVAL_TTL_HOURS = 24;
