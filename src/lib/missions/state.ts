/**
 * Mission and step state machines (Phase 17B). The same tables are enforced by database triggers
 * (enforce_mission_status, enforce_mission_step), so no caller can move a mission or a step backwards.
 *
 *   mission: planned → running → completed | failed | cancelled
 *            planned → cancelled | failed
 *   step:    pending → leased → completed | failed | skipped | cancelled
 *                             → pending   (lease released, retryable failure, or expired lease recovered)
 *            pending → skipped | cancelled | failed (attempts exhausted)
 */
import type { MissionStatus, MissionStepStatus } from "./types";

export const MISSION_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  planned: ["running", "cancelled", "failed"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const STEP_TRANSITIONS: Record<MissionStepStatus, readonly MissionStepStatus[]> = {
  pending: ["leased", "skipped", "cancelled", "failed"],
  leased: ["pending", "completed", "failed", "cancelled", "skipped"],
  completed: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

export const canMissionTransition = (from: MissionStatus, to: MissionStatus) => MISSION_TRANSITIONS[from].includes(to);
export const canStepTransition = (from: MissionStepStatus, to: MissionStepStatus) => STEP_TRANSITIONS[from].includes(to);
export const isMissionTerminal = (s: MissionStatus) => MISSION_TRANSITIONS[s].length === 0;
export const isStepTerminal = (s: MissionStepStatus) => STEP_TRANSITIONS[s].length === 0;
