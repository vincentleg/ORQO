/**
 * The mission experience, derived (Phase 17C). Pure and deterministic: turns the public mission view (real
 * steps and findings) into what the founder sees — a phase, progress, a title, work cards and the ORQO
 * Briefing (what ORQO did, what it found, what matters, what to do next).
 *
 * Nothing here is invented: every line is backed by a step or a finding. When a finding is absent, its part
 * of the briefing is absent (or an explicit "nothing found" line), never filled with prose.
 * Labels are produced as typed codes; the components translate them (EN/FR catalogs).
 */
import { PRIORITIES } from "@/lib/discovery/types";
import type { MissionStepView, MissionView, StepSubject } from "./view";

// ---------------------------------------------------------------------------
// Phase and progress

export type MissionPhase = "preparing" | "reviewing_candidates" | "planning_research" | "researching" | "compiling" | "completed" | "completed_with_gaps" | "needs_attention" | "cancelled";

const DONE = new Set(["completed", "failed", "skipped", "cancelled"]);

const bySeq = (a: MissionStepView, b: MissionStepView) => a.seq - b.seq;

/** The step ORQO is on: the leased one, else the next pending one. */
export function currentStep(v: MissionView): MissionStepView | null {
  const steps = [...v.steps].sort(bySeq);
  return steps.find((s) => s.status === "leased") ?? steps.find((s) => s.status === "pending") ?? null;
}

/** Optional steps that failed, in a mission that otherwise completed. */
export const failedOptionalSteps = (v: MissionView) => v.steps.filter((s) => s.status === "failed" && !s.required);

export function missionPhase(v: MissionView): MissionPhase {
  const st = v.mission.status;
  if (st === "cancelled") return "cancelled";
  if (st === "failed") return "needs_attention";
  if (st === "completed") return failedOptionalSteps(v).length ? "completed_with_gaps" : "completed";
  const cur = currentStep(v);
  if (!cur || (st === "planned" && !v.steps.some((s) => s.status !== "pending"))) return "preparing";
  if (cur.kind === "compile") return "compiling";
  if (cur.kind === "fanout") return "planning_research";
  return isProspecting(cur) ? "reviewing_candidates" : "researching";
}

/** A child step that prospects (no single research subject). */
const isProspecting = (s: MissionStepView) => s.kind === "child_run" && s.subject === null;

export const isActive = (v: MissionView) => v.mission.status === "planned" || v.mission.status === "running";

/** Share of steps that are done, 0–100. Fan-out may add steps, so the total can grow while a mission runs. */
export function progressPercent(v: MissionView): number {
  if (v.mission.status === "completed") return 100;
  const total = v.steps.length;
  if (!total) return 0;
  return Math.round((v.steps.filter((s) => DONE.has(s.status)).length / total) * 100);
}

/** The human label of one step: a typed code and its subject. */
export type StepLabel = { kind: "prospect" } | { kind: "plan_research" } | { kind: "research"; subject: StepSubject | null } | { kind: "compile" };

export function stepLabel(s: MissionStepView): StepLabel {
  if (s.kind === "compile") return { kind: "compile" };
  if (s.kind === "fanout") return { kind: "plan_research" };
  return isProspecting(s) ? { kind: "prospect" } : { kind: "research", subject: s.subject };
}

/** The steps the founder sees: every step except those cancelled before they ever started. */
export const visibleSteps = (v: MissionView) => [...v.steps].sort(bySeq).filter((s) => !(s.status === "cancelled" && !s.startedAt) && s.status !== "skipped");

// ---------------------------------------------------------------------------
// Title (from the founder's own validated input)

export type MissionTitle =
  | { kind: "research"; target: StepSubject | null }
  | { kind: "prospect"; intent: string; market: string | null; geography: string | null; objective: string | null }
  | { kind: "prospect_and_research"; intent: string; market: string | null; geography: string | null; objective: string | null; top: number };

export function missionTitle(v: { mission: Pick<MissionView["mission"], "template" | "input"> }): MissionTitle {
  const i = v.mission.input;
  const str = (x: unknown) => (typeof x === "string" && x ? x : null);
  if (v.mission.template === "research_company") {
    const t = i.target as StepSubject | undefined;
    return { kind: "research", target: t && ("query" in t || "companyId" in t) ? t : null };
  }
  const base = { intent: str(i.intent) ?? "profile", market: str(i.market), geography: str(i.geography), objective: str(i.objective) };
  return v.mission.template === "prospect_and_research" ? { kind: "prospect_and_research", ...base, top: typeof i.researchTop === "number" ? i.researchTop : 2 } : { kind: "prospect", ...base };
}

// ---------------------------------------------------------------------------
// Work cards

const PRIORITY_RANK: Record<string, number> = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));
const str = (x: unknown) => (typeof x === "string" ? x : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const arr = (x: unknown) => (Array.isArray(x) ? x : []);

export interface ProspectCard {
  key: string;
  name: string;
  domain: string;
  priority: string;
  relationship: string | null;
  confidence: string | null;
  evidenceCount: number;
  unknowns: number;
  nextQuestion: string | null;
  networkCompanyId: string | null;
  rank: number;
}

export interface AnalysisCard {
  key: string;
  name: string;
  domain: string;
  analysisStatus: string;
  top: { relationship: string; confidence: string; verdict: string } | null;
  opportunities: number;
  hypotheses: number;
  unknowns: number;
  evidence: { sources: number; facts: number; inferences: number };
  nextAction: string | null;
  researchedAt: string | null;
}

export function prospectCards(v: MissionView): ProspectCard[] {
  return v.findings
    .filter((f) => f.kind === "prospect")
    .map((f) => {
      const p = f.payload;
      return {
        key: f.key,
        name: str(p.name) ?? f.subjectDomain ?? "",
        domain: str(p.domain) ?? f.subjectDomain ?? "",
        priority: str(p.priority) ?? "weak",
        relationship: str(p.relationship),
        confidence: str(p.confidence),
        evidenceCount: num(p.evidenceCount),
        unknowns: arr(p.unknowns).length,
        nextQuestion: str(p.nextQuestion),
        networkCompanyId: str(p.networkCompanyId),
        rank: num(p.rank),
      };
    })
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.rank - b.rank);
}

export function analysisCards(v: MissionView): AnalysisCard[] {
  return v.findings
    .filter((f) => f.kind === "company_analysis")
    .map((f) => {
      const p = f.payload;
      const first = (arr(p.opportunities)[0] ?? arr(p.hypotheses)[0]) as Record<string, unknown> | undefined;
      const ev = (p.evidence ?? {}) as Record<string, unknown>;
      return {
        key: f.key,
        name: str(p.name) ?? f.subjectDomain ?? "",
        domain: str(p.domain) ?? f.subjectDomain ?? "",
        analysisStatus: str(p.analysisStatus) ?? "none",
        top: first && str(first.relationship) ? { relationship: str(first.relationship)!, confidence: str(first.confidence) ?? "limited", verdict: str(first.verdict) ?? "weak" } : null,
        opportunities: arr(p.opportunities).length,
        hypotheses: arr(p.hypotheses).length,
        unknowns: arr(p.unknowns).length,
        evidence: { sources: num(ev.sources), facts: num(ev.facts), inferences: num(ev.inferences) },
        nextAction: str(p.nextAction),
        researchedAt: str(p.researchedAt),
      };
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

export interface ProspectingCard {
  status: string;
  partialReason: string | null;
  considered: number;
  qualified: number;
  weak: number;
  rejected: number;
  presented: number;
  nextAction: string | null;
}

export function prospectingCard(v: MissionView): ProspectingCard | null {
  const f = v.findings.find((x) => x.kind === "prospecting_summary");
  if (!f) return null;
  const funnel = (f.payload.funnel ?? {}) as Record<string, unknown>;
  return { status: str(f.payload.status) ?? "completed", partialReason: str(f.payload.partialReason), considered: num(funnel.considered), qualified: num(funnel.qualified), weak: num(funnel.weak), rejected: num(funnel.rejected), presented: num(f.payload.presented), nextAction: str(f.payload.nextAction) };
}

export const profileGaps = (v: MissionView): string[] => arr(v.findings.find((f) => f.kind === "profile_gap")?.payload.fields).filter((x): x is string => typeof x === "string");

// ---------------------------------------------------------------------------
// The ORQO Briefing

export type DidLine = { kind: "reviewed"; considered: number; presented: number } | { kind: "researched"; count: number; names: string[] } | { kind: "incomplete"; count: number } | { kind: "stopped" };

export type MatterLine =
  | { kind: "high_priority"; count: number; names: string[] }
  | { kind: "worth_investigating"; count: number }
  | { kind: "opportunity"; company: string; relationship: string; confidence: string }
  | { kind: "hypotheses_only"; company: string }
  | { kind: "no_opportunity"; company: string }
  | { kind: "no_prospects" }
  | { kind: "partial"; reason: string | null }
  | { kind: "profile_gap"; count: number };

export type NextAction =
  | { kind: "complete_profile"; fields: string[]; href: string }
  | { kind: "validate"; company: string; relationship: string; href: string }
  | { kind: "ask"; company: string; question: string; href: string }
  | { kind: "investigate"; company: string; href: string }
  | { kind: "broaden"; href: string }
  | { kind: "verify_more"; href: string }
  | { kind: "retry"; href: string };

export interface MissionBriefing {
  /** The mission_summary finding exists (the mission compiled its results). */
  compiled: boolean;
  did: DidLine[];
  matters: MatterLine[];
  next: NextAction[];
  prospects: ProspectCard[];
  analyses: AnalysisCard[];
  prospecting: ProspectingCard | null;
  gaps: string[];
  failedSteps: { key: string; error: string | null; label: StepLabel }[];
}

export const companyHref = (domain: string, networkCompanyId: string | null) => (networkCompanyId ? `/workspace/companies/${networkCompanyId}` : `/workspace/companies?q=${encodeURIComponent(domain)}`);

/** A new mission with the same input (the same template, a fresh idempotency key). */
export function retryHref(v: MissionView): string {
  const i = v.mission.input;
  const q = new URLSearchParams({ template: v.mission.template });
  const t = i.target as StepSubject | undefined;
  if (t && "query" in t) q.set("target", t.query);
  if (t && "companyId" in t) q.set("company", t.companyId);
  for (const k of ["intent", "objective", "market", "geography"]) if (typeof i[k] === "string") q.set(k, i[k] as string);
  return `/workspace/missions?${q.toString()}#delegate`;
}

const MAX_NEXT = 5;

export function buildBriefing(v: MissionView): MissionBriefing {
  const prospects = prospectCards(v);
  const analyses = analysisCards(v);
  const prospecting = prospectingCard(v);
  const gaps = profileGaps(v);
  const failedSteps = v.steps
    .filter((s) => s.status === "failed")
    .sort(bySeq)
    .map((s) => ({ key: s.key, error: s.error, label: stepLabel(s) }));

  const did: DidLine[] = [];
  if (prospecting) did.push({ kind: "reviewed", considered: prospecting.considered, presented: prospecting.presented });
  if (analyses.length) did.push({ kind: "researched", count: analyses.length, names: analyses.map((a) => a.name) });
  if (failedSteps.length) did.push({ kind: "incomplete", count: failedSteps.length });
  if (v.mission.status === "cancelled") did.push({ kind: "stopped" });

  const matters: MatterLine[] = [];
  const high = prospects.filter((p) => p.priority === "high");
  const worth = prospects.filter((p) => p.priority === "worth_investigating");
  if (high.length) matters.push({ kind: "high_priority", count: high.length, names: high.slice(0, 3).map((p) => p.name) });
  if (worth.length) matters.push({ kind: "worth_investigating", count: worth.length });
  if (prospecting && prospects.length === 0) matters.push({ kind: "no_prospects" });
  if (prospecting && prospecting.status === "partial") matters.push({ kind: "partial", reason: prospecting.partialReason });
  for (const a of analyses) {
    if (a.analysisStatus === "opportunities" && a.top) matters.push({ kind: "opportunity", company: a.name, relationship: a.top.relationship, confidence: a.top.confidence });
    else if (a.analysisStatus === "hypotheses_only") matters.push({ kind: "hypotheses_only", company: a.name });
    else if (a.analysisStatus === "none") matters.push({ kind: "no_opportunity", company: a.name });
  }
  if (gaps.length) matters.push({ kind: "profile_gap", count: gaps.length });

  const next: NextAction[] = [];
  if (gaps.length || analyses.some((a) => a.analysisStatus === "own_profile_missing")) next.push({ kind: "complete_profile", fields: gaps, href: "/workspace/company" });
  for (const a of analyses) if (a.nextAction === "validate" && a.top) next.push({ kind: "validate", company: a.name, relationship: a.top.relationship, href: companyHref(a.domain, null) });
  const researched = new Set(analyses.map((a) => a.domain));
  for (const p of prospects.filter((x) => x.priority !== "weak")) {
    if (researched.has(p.domain)) continue;
    next.push(p.nextQuestion ? { kind: "ask", company: p.name, question: p.nextQuestion, href: companyHref(p.domain, p.networkCompanyId) } : { kind: "investigate", company: p.name, href: companyHref(p.domain, p.networkCompanyId) });
  }
  if (prospecting && (prospects.length === 0 || prospecting.nextAction === "broaden")) next.push({ kind: "broaden", href: retryHref(v) });
  else if (prospecting?.nextAction === "verify_more") next.push({ kind: "verify_more", href: "/workspace/companies" });
  if (v.mission.status === "failed") next.push({ kind: "retry", href: retryHref(v) });

  return { compiled: v.findings.some((f) => f.kind === "mission_summary"), did, matters, next: next.slice(0, MAX_NEXT), prospects, analyses, prospecting, gaps, failedSteps };
}

/** Safe, user-facing failure codes; anything else is shown as a generic "could not complete". */
export const KNOWN_FAILURES = [
  "own_profile_missing",
  "target_invalid",
  "target_not_found",
  "research_refused",
  "research_failed",
  "research_not_permitted",
  "plan_required",
  "role",
  "quota_exhausted",
  "interrupted",
  "attempts_exhausted",
  "invalid_step",
  "tool_denied",
  "budget_exhausted",
  "cancelled",
] as const;
export type KnownFailure = (typeof KNOWN_FAILURES)[number];
export const failureCode = (code: string | null): KnownFailure | "generic" => ((KNOWN_FAILURES as readonly string[]).includes(code ?? "") ? (code as KnownFailure) : "generic");
