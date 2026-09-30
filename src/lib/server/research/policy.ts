import "server-only";
/**
 * Server-side authorization for research — the gate every variable-cost path
 * crosses BEFORE any provider is called:
 *
 *   authenticated user → organization membership (member+) → feature
 *   entitlement (authoritative plan, or operator preview list) → provider
 *   configured → atomic quota + concurrency guard (start_research_run) → run
 *   with hard limits (RunBudget) → usage recorded.
 *
 * Phase 3 policy (no billing exists):
 * - basic ("Company analysis", every plan): official website only; no paid
 *   search or model provider is reachable from this mode. Quota-limited.
 * - deep ("Deep research", Pro+): Brave + OpenRouter. Every workspace is Free
 *   until billing ships, so deep research is refused for all workspaces
 *   except those an operator lists in ORQO_RESEARCH_PREVIEW_ORGS.
 * The browser's view of the plan is never trusted.
 */
import { FEATURES, planAtLeast, type Plan } from "@/lib/entitlements/plans";
import { AppError } from "@/lib/server/errors";
import { getEntitledPlan } from "@/lib/server/entitlements";
import { requireMembership } from "@/lib/server/repositories/tenancy";
import type { Db } from "@/lib/server/supabase/types";
import { roleAtLeast, type OrgRole } from "@/lib/server/tenancy/roles";
import { deepResearchPreviewOrgs, RESEARCH_QUOTAS } from "./config";
import { configuredProviders } from "./providers";
import { countRecentRuns } from "./repository";
import type { ResearchMode } from "./types";

export type DenialReason = "role" | "plan_required" | "providers_unconfigured" | "quota_exhausted";

export class ResearchDeniedError extends AppError {
  constructor(
    readonly reason: DenialReason,
    readonly requiredPlan: Plan | null = null,
  ) {
    super(reason === "quota_exhausted" ? "rate_limited" : reason === "providers_unconfigured" ? "unavailable" : "forbidden", DENIAL_MESSAGES[reason]);
  }
}

const DENIAL_MESSAGES: Record<DenialReason, string> = {
  role: "Your role does not allow running research.",
  plan_required: "This research mode is not included in your plan.",
  providers_unconfigured: "This research mode is not available on this deployment.",
  quota_exhausted: "Research limit reached for now.",
};

async function isEntitled(organizationId: string, mode: ResearchMode): Promise<{ ok: boolean; requiredPlan: Plan }> {
  const feature = mode === "deep" ? FEATURES["search.deepResearch"] : FEATURES["search.companyAnalysis"];
  const plan = await getEntitledPlan(organizationId);
  const preview = mode === "deep" && deepResearchPreviewOrgs().has(organizationId.toLowerCase());
  return { ok: planAtLeast(plan, feature.minPlan) || preview, requiredPlan: feature.minPlan };
}

function providersReady(mode: ResearchMode): boolean {
  // Basic research uses direct official-site retrieval only.
  return mode === "basic" || configuredProviders().model !== null;
}

/** Authorizes a research run. Throws ResearchDeniedError; the quota itself is enforced atomically when the run starts. */
export async function authorizeResearch(db: Db, userId: string, organizationId: string, mode: ResearchMode): Promise<{ organizationId: string }> {
  const membership = await requireMembership(db, userId, organizationId, "viewer");
  if (!roleAtLeast(membership.role, "member")) throw new ResearchDeniedError("role");
  const entitled = await isEntitled(membership.organizationId, mode);
  if (!entitled.ok) throw new ResearchDeniedError("plan_required", entitled.requiredPlan);
  if (!providersReady(mode)) throw new ResearchDeniedError("providers_unconfigured");
  return { organizationId: membership.organizationId };
}

export type ModeAvailability =
  | { mode: ResearchMode; state: "available"; remaining: number; limit: number }
  | { mode: ResearchMode; state: "denied"; reason: DenialReason; requiredPlan: Plan | null; limit: number };

/** What the UI may offer. Presentation only — authorizeResearch + the RPC decide. */
export async function researchAvailability(db: Db, organizationId: string, role: OrgRole): Promise<Record<ResearchMode, ModeAvailability>> {
  const one = async (mode: ResearchMode): Promise<ModeAvailability> => {
    const limit = RESEARCH_QUOTAS[mode].maxRunsPerOrg;
    const entitled = await isEntitled(organizationId, mode);
    if (!entitled.ok) return { mode, state: "denied", reason: "plan_required", requiredPlan: entitled.requiredPlan, limit };
    if (!providersReady(mode)) return { mode, state: "denied", reason: "providers_unconfigured", requiredPlan: null, limit };
    if (!roleAtLeast(role, "member")) return { mode, state: "denied", reason: "role", requiredPlan: null, limit };
    const used = await countRecentRuns(db, organizationId, mode);
    if (used >= limit) return { mode, state: "denied", reason: "quota_exhausted", requiredPlan: null, limit };
    return { mode, state: "available", remaining: limit - used, limit };
  };
  const [basic, deep] = await Promise.all([one("basic"), one("deep")]);
  return { basic, deep };
}
