import { requireAuth } from "@/lib/server/auth/context";
import { requireAgentReader } from "@/lib/server/agents/gate";
import { assertSameOriginJson, json, readJson } from "@/lib/server/http";
import { missionRefusal } from "@/lib/server/missions/http";
import { listMissions } from "@/lib/server/missions/repository";
import { createMission, MissionCreateRequest } from "@/lib/server/missions/service";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/organizations/[organizationId]/missions">;

/**
 * POST /api/v1/organizations/:org/missions — plan a mission from a template (Phase 17B). Nothing executes
 * here: the plan is created (idempotent per user and key) and executed through …/missions/:id/execute.
 * Refusals: same-origin JSON, authentication, membership, role, agent entitlement for every agent the plan
 * delegates to, input contract, then the atomic idempotency + active-mission + quota guard.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOriginJson(request);
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const body = await readJson(request, MissionCreateRequest, 8192);
    const created = await createMission(db, user.id, organizationId, body);
    return json({ mission: { id: created.missionId, status: created.status, reused: created.reused } }, created.reused ? 200 : 201);
  } catch (e) {
    return missionRefusal(e, "POST mission");
  }
}

/** GET /api/v1/organizations/:org/missions — recent missions of the workspace (viewer+). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { db, user } = await requireAuth(request);
    const { organizationId } = await ctx.params;
    const m = await requireAgentReader(db, user.id, organizationId);
    const missions = await listMissions(db, m.organizationId, 20);
    return json({ missions: missions.map((x) => ({ id: x.id, template: x.template, objective: x.objective, status: x.status, failureReason: x.failure_reason, createdAt: x.created_at, finishedAt: x.finished_at })) });
  } catch (e) {
    return missionRefusal(e, "GET missions");
  }
}
