import "server-only";
import { json, recordDenial, toErrorResponse } from "@/lib/server/http";
import { AgentDeniedError } from "./gate";
import { AgentRunRefusedError } from "./repository";

/** Safe JSON refusal for agent routes: a stable reason code, never internals. */
export function agentRefusal(e: unknown, route: string): Response {
  if (e instanceof AgentDeniedError || e instanceof AgentRunRefusedError) recordDenial(e, route);
  if (e instanceof AgentDeniedError) return json({ error: { code: e.code, reason: e.reason, requiredPlan: e.requiredPlan, message: e.message } }, e.status);
  if (e instanceof AgentRunRefusedError) return json({ error: { code: e.code, reason: e.reason, message: e.message } }, e.status);
  return toErrorResponse(e, route);
}

/** Public, safe view of a run outcome (no counters beyond budget accounting, no internals). */
export function outcomeBody(o: { status: string; code?: string; approvalId?: string; durationMs: number }) {
  return { status: o.status, ...(o.code ? { error: o.code } : {}), ...(o.approvalId ? { approvalId: o.approvalId } : {}), durationMs: Math.round(o.durationMs) };
}
