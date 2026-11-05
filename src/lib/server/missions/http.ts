import "server-only";
import { agentRefusal } from "@/lib/server/agents/http";
import { json, recordDenial } from "@/lib/server/http";
import { MissionRefusedError } from "./repository";

/** Safe JSON refusal for mission routes: stable reason codes (agent gate, quotas), never internals. */
export function missionRefusal(e: unknown, route: string): Response {
  if (e instanceof MissionRefusedError) {
    recordDenial(e, route);
    return json({ error: { code: e.code, reason: e.reason, message: e.message } }, e.status);
  }
  return agentRefusal(e, route);
}
