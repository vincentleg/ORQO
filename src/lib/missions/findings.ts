/**
 * Mission findings (Phase 17B): structured, attributable results that later ORQO surfaces consume.
 *
 * Pure and deterministic: findings are derived from contract-validated agent results (never from model text
 * or web content directly), keyed so that recording them twice is a no-op (unique (mission, key) in the
 * database), and bounded. The mission_findings row adds the attribution: mission, step and agent run.
 */
import { z } from "zod";
import type { CompanyAnalysisResult, DiscoveryResult, AgentResult } from "@/lib/agents/contracts";
import { PRIORITIES } from "@/lib/discovery/types";
import { MISSION_LIMITS, type FindingKind } from "./types";
import { researchChildSpec, type FanoutSpec, type PlannedStep } from "./contracts";

export interface MissionFinding {
  key: string;
  kind: FindingKind;
  subjectDomain: string | null;
  payload: Record<string, unknown>;
}

/** A finding as stored (with its attribution), as the executor and the API read it back. */
export interface StoredFinding extends MissionFinding {
  id: string;
  stepId: string;
  stepKey: string;
  agentRunId: string | null;
  createdAt: string;
}

const DOMAIN = /^[a-z0-9.-]{3,253}$/;
const domainOrNull = (d: string) => (DOMAIN.test(d) ? d : null);
const KEY_SAFE = (s: string) => s.toLowerCase().replace(/[^a-z0-9_:.-]/g, "_").slice(0, 200);

function gapFinding(fields: readonly string[]): MissionFinding[] {
  return fields.length ? [{ key: "gap:own_profile", kind: "profile_gap", subjectDomain: null, payload: { fields: [...fields] } }] : [];
}

function analysisFindings(r: CompanyAnalysisResult): MissionFinding[] {
  const summarize = (o: CompanyAnalysisResult["opportunities"][number]) => ({ relationship: o.relationship, rule: o.rule, verdict: o.verdict, confidence: o.confidence, validation: o.validation });
  return [
    {
      key: KEY_SAFE(`analysis:${r.target.domain}`),
      kind: "company_analysis",
      subjectDomain: domainOrNull(r.target.domain),
      payload: {
        name: r.target.name,
        domain: r.target.domain,
        intelligenceId: r.intelligenceId,
        researchRunId: r.researchRunId,
        researchedAt: r.researchedAt,
        researchMode: r.researchMode,
        reusedResearch: r.reusedResearch,
        analysisStatus: r.analysisStatus,
        opportunities: r.opportunities.map(summarize),
        hypotheses: r.hypotheses.map(summarize),
        rejectedCount: r.rejectedCount,
        unknowns: r.unknowns,
        evidence: r.evidence,
        nextAction: r.nextAction ? r.nextAction.kind : null,
      },
    },
    ...gapFinding(r.ownGaps),
  ];
}

function discoveryFindings(stepKey: string, r: DiscoveryResult): MissionFinding[] {
  const prospects: MissionFinding[] = r.companies.map((c, i) => ({
    key: KEY_SAFE(`prospect:${c.domain}`),
    kind: "prospect",
    subjectDomain: domainOrNull(c.domain),
    payload: {
      rank: i + 1,
      name: c.name,
      domain: c.domain,
      website: c.website,
      priority: c.priority,
      relationship: c.mechanism.relationship,
      rule: c.mechanism.rule,
      confidence: c.mechanism.confidence,
      aligned: c.mechanism.aligned,
      networkCompanyId: c.network?.companyId ?? null,
      intelligenceId: c.research.intelligenceId,
      researchedAt: c.research.researchedAt,
      evidenceCount: c.evidence.length,
      unknowns: c.unknowns,
      nextQuestion: c.nextQuestion,
    },
  }));
  const summary: MissionFinding = {
    key: KEY_SAFE(`prospecting:${stepKey}`),
    kind: "prospecting_summary",
    subjectDomain: null,
    payload: { status: r.status, partialReason: r.partialReason, source: { id: r.source.id, live: r.source.live }, objective: r.objective, funnel: r.funnel, presented: r.companies.length, rejected: r.rejected.length, unverified: r.unverified.length, nextAction: r.nextAction ? r.nextAction.kind : null },
  };
  return [...prospects, summary, ...gapFinding(r.ownGaps)];
}

/** Findings of one completed child run. */
export function findingsFromResult(stepKey: string, result: AgentResult): MissionFinding[] {
  return result.kind === "company_analysis" ? analysisFindings(result) : discoveryFindings(stepKey, result);
}

const PRIORITY_RANK: Record<string, number> = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));

const ProspectPayload = z.object({ rank: z.number().int(), domain: z.string().regex(DOMAIN), name: z.string(), priority: z.enum(PRIORITIES) });

/** Prospects of one step, best first (priority, then the discovery rank). Weak candidates are not researched. */
export function rankedProspects(findings: readonly StoredFinding[], fromStep: string) {
  return findings
    .filter((f) => f.kind === "prospect" && f.stepKey === fromStep)
    .flatMap((f) => {
      const p = ProspectPayload.safeParse(f.payload);
      return p.success ? [p.data] : [];
    })
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.rank - b.rank);
}

/** Fan-out: the child Research Basic steps for the top prospects, inside the fan-out's seq gap. */
export function planFanout(step: { seq: number; key: string }, spec: FanoutSpec, findings: readonly StoredFinding[]): PlannedStep[] {
  const max = Math.min(spec.max, MISSION_LIMITS.maxFanout);
  return rankedProspects(findings, spec.from)
    .filter((p) => p.priority !== "weak")
    .slice(0, max)
    .map((p, i) => ({ seq: step.seq + i + 1, key: `${step.key}_${i + 1}`.slice(0, 40), kind: "child_run", required: false, maxAttempts: 2, spec: researchChildSpec({ query: p.domain }) }));
}

export interface StepState {
  key: string;
  kind: string;
  status: string;
  errorCode: string | null;
}

/** The mission summary finding, compiled from the other steps and findings. */
export function compileSummary(steps: readonly StepState[], findings: readonly StoredFinding[]): MissionFinding {
  const others = steps.filter((s) => s.kind !== "compile");
  const count = (st: string) => others.filter((s) => s.status === st).length;
  const byKind: Record<string, number> = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const prospects = findings
    .filter((f) => f.kind === "prospect")
    .map((f) => ProspectPayload.safeParse(f.payload))
    .flatMap((p) => (p.success ? [p.data] : []))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.rank - b.rank)
    .slice(0, 5)
    .map((p) => ({ domain: p.domain, name: p.name, priority: p.priority }));
  const analyses = findings
    .filter((f) => f.kind === "company_analysis")
    .map((f) => ({ domain: f.subjectDomain, name: typeof f.payload.name === "string" ? f.payload.name : null, analysisStatus: typeof f.payload.analysisStatus === "string" ? f.payload.analysisStatus : null, opportunities: Array.isArray(f.payload.opportunities) ? f.payload.opportunities.length : 0 }))
    .sort((a, b) => String(a.domain).localeCompare(String(b.domain)))
    .slice(0, 8);
  const gaps = findings.find((f) => f.kind === "profile_gap")?.payload.fields ?? [];
  return {
    key: "summary",
    kind: "mission_summary",
    subjectDomain: null,
    payload: {
      steps: { total: others.length, completed: count("completed"), failed: count("failed"), skipped: count("skipped") },
      failedSteps: others.filter((s) => s.status === "failed").map((s) => ({ key: s.key, error: s.errorCode })),
      findings: Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b))),
      prospects,
      analyses,
      gaps,
    },
  };
}
