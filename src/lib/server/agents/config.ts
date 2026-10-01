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

/**
 * Operator-controlled preview access to agent execution (comma-separated
 * organization ids in ORQO_AGENT_PREVIEW_ORGS). Server-side only; not billing,
 * grants no plan, and changes nothing else: deep research still requires its
 * own entitlement (or ORQO_RESEARCH_PREVIEW_ORGS) and configured providers,
 * and every quota and hard limit still applies.
 */
export function agentPreviewOrgs(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.ORQO_AGENT_PREVIEW_ORGS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[0-9a-f-]{36}$/.test(s)),
  );
}
