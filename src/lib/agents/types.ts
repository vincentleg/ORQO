/**
 * ORQO agent infrastructure — shared vocabulary (Phase 4).
 *
 * Pure and framework-free: the registry, policy, state machines and budgets in
 * this folder are deterministic code. No model ever decides a permission, a
 * tool, a state transition or a budget.
 */
import { z } from "zod";

/** Stable agent ids (Phase 2 catalog keys — never localized, never renamed casually). */
export const AGENT_IDS = ["orchestrator", "partnership", "sales", "relationship", "research", "prospecting", "followUp", "signal", "event", "technical", "market", "custom"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type AgentTier = "orchestrator" | "manager" | "specialist";

/**
 * available: executable today for entitled workspaces.
 * coming_soon: designed, not built — never executable, whatever the plan.
 * disabled: switched off by the operator.
 */
export type AgentStatus = "available" | "coming_soon" | "disabled";

/** Business capabilities. An agent is granted capabilities; a capability maps to tools. */
export const CAPABILITY_IDS = [
  "company_research",
  "company_understanding",
  "evidence_synthesis",
  "business_relevance",
  "opportunity_qualification",
  "market_research",
  "relationship_context",
  "prospect_discovery",
  "followup_preparation",
  "signal_analysis",
  "event_analysis",
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** Registered tools. Only real, server-implemented operations appear here. */
export const TOOL_IDS = [
  "read_workspace_company",
  "read_network_company",
  "read_stored_research",
  "official_site_research",
  "deep_company_research",
  "evaluate_business_relevance",
  // Phase 5 — Discover & Prospecting.
  "build_discovery_plan",
  "read_existing_company_knowledge",
  "source_known_candidates",
  "search_web_candidates",
  "deduplicate_candidates",
  "qualify_candidate",
  "apply_discovery_critic",
  // Phase 6 — Network relationship memory (read-only seam for the planned Relationship and Follow-up agents).
  "read_relationship_context",
  // Phase 7 — Intelligence (read-only seam for the planned Signals Agent).
  "read_company_signals",
  // Phase 8 — Events (read-only seam for the planned Event Agent).
  "read_event_context",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/**
 * Autonomy levels (Master Spec §28).
 * 0 Observe — read and analyze permitted context; never proposes execution.
 * 1 Recommend — may analyze and recommend an action.
 * 2 Prepare — may prepare actions/results; variable-cost or high-impact actions need approval.
 * 3 Execute — may execute explicitly permitted actions within policy (no agent is granted it in Phase 4).
 */
export const AUTONOMY_LEVELS = [0, 1, 2, 3] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const AutonomySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const APPROVAL_STATES = ["not_required", "required", "approved", "rejected", "expired"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const RUN_STATUSES = ["queued", "running", "waiting_for_approval", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = ["running", "completed", "failed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Model task classes. Agents request a task; the server model policy picks provider and model. */
export const MODEL_TASKS = ["extraction", "synthesis", "business_reasoning", "critique"] as const;
export type ModelTask = (typeof MODEL_TASKS)[number];

/** Structured mission types. There is no free-form autonomous task engine. */
export const MISSION_TYPES = ["analyze_company", "explain_opportunities", "discover_companies"] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

/** Steps the orchestrator may record. Operations and results only — never model reasoning. */
export const STEP_KEYS = [
  "load_workspace_context",
  "resolve_target",
  "retrieve_existing_research",
  "run_research",
  "evaluate_relevance",
  "produce_result",
  // discover_companies
  "build_discovery_plan",
  "read_existing_knowledge",
  "find_candidates",
  "deduplicate_candidates",
  "verify_candidates",
  "qualify_candidates",
  "apply_critic",
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/** Safe, user-readable failure codes for runs (bilingual messages live in the i18n catalogs). */
export const RUN_FAILURES = [
  "own_profile_missing",
  "target_invalid",
  "target_not_found",
  "research_required",
  "research_not_permitted",
  "research_refused",
  "research_failed",
  "plan_required",
  "provider_not_configured",
  "search_not_permitted",
  "tool_denied",
  "budget_exhausted",
  "invalid_tool_output",
  "approval_rejected",
  "approval_expired",
  "cancelled",
  "internal",
] as const;
export type RunFailure = (typeof RUN_FAILURES)[number];
