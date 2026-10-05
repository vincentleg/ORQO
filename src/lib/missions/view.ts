/**
 * The public view of a mission (Phase 17C): what GET …/missions/:id and POST …/execute return, and what the
 * mission experience renders. Pure types (shared by the server serializer and the client), no logic.
 * No lease owner, contract internals or raw run machinery beyond ids used for links.
 */
import type { FindingKind, MissionStatus, MissionStepStatus, MissionTemplateId, StepKind } from "./types";

/** What a child step works on, when it has a single subject (a research target). */
export type StepSubject = { query: string } | { companyId: string };

export interface MissionStepView {
  seq: number;
  key: string;
  kind: StepKind;
  required: boolean;
  status: MissionStepStatus;
  attempt: number;
  maxAttempts: number;
  recoveries: number;
  leaseExpiresAt: string | null;
  childRunId: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  subject: StepSubject | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface MissionFindingView {
  id: string;
  key: string;
  kind: FindingKind;
  subjectDomain: string | null;
  stepKey: string;
  agentRunId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MissionView {
  mission: {
    id: string;
    template: MissionTemplateId;
    templateVersion: number;
    objective: string;
    /** The validated template input the founder gave (target, intent, filters). */
    input: Record<string, unknown>;
    status: MissionStatus;
    failureReason: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
  progress: { total: number; pending: number; leased: number; completed: number; failed: number; skipped: number; cancelled: number };
  steps: MissionStepView[];
  findings: MissionFindingView[];
  /**
   * Paid authority the mission was granted (from its frozen contract) and the spend actually recorded for its
   * child runs in the provider ledger. Phase 17C missions are free: $0 authority, nothing recorded. Phase 17D
   * surfaces requested/approved authority and real spend here.
   */
  authority: { maxCostUsd: number; paidProviders: boolean; webSearch: boolean; deepResearch: boolean };
  spend: { committedUsd: number; settledUsd: number; calls: number };
}
