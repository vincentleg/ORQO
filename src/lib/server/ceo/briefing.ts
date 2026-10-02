/**
 * The CEO Briefing on Work (Phase 16B): "based on what ORQO already knows".
 *
 * Built only from stored records: tracked opportunities, stored research, the team's validations, and the
 * dossiers recomputed from them. It never researches, fetches, schedules, monitors or calls a provider or a
 * model, and it does not pretend anything happened overnight (continuous intelligence is Phase 18).
 *
 * Precision survives the simplification:
 * - only CREDIBLE opportunities are prioritized (tracked ones still credible, or untracked credible leads);
 * - weak ideas, "no credible new opportunity" companies and merely relevant companies are never priorities;
 * - at most one question, and only one that changes an assessment.
 */
import type { Db } from "@/lib/server/supabase/types";
import { trackableScenario, type Dossier } from "@/lib/understanding/dossier";
import type { Scenario } from "@/lib/understanding/scenarios";
import type { NextQuestion } from "@/lib/understanding/types";
import type { TrackedOpportunity } from "../repositories/tracked-opportunities";
import { getOwnUnderstanding } from "../repositories/understanding";
import { assessRecentCompanies, loadWorkspaceMemory, type CompanyAssessment, type RememberedCompany, type WorkspaceMemory } from "./memory";

export const TOP_LIMIT = 3;
export const CONTINUE_LIMIT = 4;

export type BriefingItem =
  | { kind: "tracked"; opportunity: TrackedOpportunity; companyName: string }
  | { kind: "lead"; companyId: string; companyName: string; dossier: Dossier; scenario: Scenario };

export type BriefingQuestion =
  | { kind: "own_missing" }
  | { kind: "relationship"; companyId: string; companyName: string; ownName: string }
  | { kind: "own"; question: NextQuestion };

export interface ContinueItem {
  remembered: RememberedCompany;
  verdict: Dossier["verdict"] | null;
}

export interface Briefing {
  ownName: string | null;
  top: BriefingItem[];
  continue: ContinueItem[];
  question: BriefingQuestion | null;
  /** Remembered companies ORQO assessed with no credible new opportunity (memory, not prospects). */
  noOpportunity: number;
  remembered: number;
  researched: number;
}

/** Pure: the briefing from memory and the recomputed assessments. Exported for tests. */
export function composeBriefing(input: { ownName: string | null; ownQuestion: NextQuestion | null; memory: WorkspaceMemory; assessments: CompanyAssessment[] }): Briefing {
  const { memory, assessments } = input;
  const byCompany = new Map(assessments.map((a) => [a.remembered.company.id, a]));

  // Tracked and still credible on the current evidence (a changed assessment drops out of priorities, never silently promoted).
  const tracked: BriefingItem[] = memory.tracked
    .filter((o) => o.status === "investigating" || o.status === "validated")
    .filter((o) => {
      const a = byCompany.get(o.targetCompanyId);
      return a ? trackableScenario(a.dossier, o.scenarioKey) !== null : false;
    })
    .sort((a, b) => (a.status === b.status ? b.updatedAt.localeCompare(a.updatedAt) : a.status === "investigating" ? -1 : 1))
    .map((opportunity) => ({ kind: "tracked", opportunity, companyName: opportunity.targetName }));
  const trackedKeys = new Set(memory.tracked.map((o) => `${o.targetCompanyId}:${o.scenarioKey}`));
  const leads: BriefingItem[] = assessments
    .filter((a) => a.dossier.verdict === "opportunity")
    .flatMap((a) => {
      const s = a.dossier.scenarios[0] ?? a.dossier.novel[0];
      return s && s.verdict === "credible" && !trackedKeys.has(`${a.remembered.company.id}:${s.key}`) ? [{ kind: "lead" as const, companyId: a.remembered.company.id, companyName: a.remembered.company.name, dossier: a.dossier, scenario: s }] : [];
    });
  const top = [...tracked, ...leads].slice(0, TOP_LIMIT);

  // One question, the one that changes the most: confirm how the leading company works with you, else the own company's.
  let question: BriefingQuestion | null = null;
  if (!input.ownName) question = { kind: "own_missing" };
  else {
    const first = top.map((t) => byCompany.get(t.kind === "tracked" ? t.opportunity.targetCompanyId : t.companyId)).find((a) => a?.dossier.askRelationship);
    if (first) question = { kind: "relationship", companyId: first.remembered.company.id, companyName: first.remembered.company.name, ownName: input.ownName };
    else if (input.ownQuestion) question = { kind: "own", question: input.ownQuestion };
  }

  return {
    ownName: input.ownName,
    top,
    continue: memory.companies.slice(0, CONTINUE_LIMIT).map((remembered) => ({ remembered, verdict: byCompany.get(remembered.company.id)?.dossier.verdict ?? null })),
    question,
    noOpportunity: assessments.filter((a) => a.dossier.verdict === "no_credible_opportunity").length,
    remembered: memory.companies.length,
    researched: memory.companies.filter((c) => c.research).length,
  };
}

export async function loadBriefing(db: Db, organizationId: string): Promise<Briefing> {
  const [memory, own] = await Promise.all([loadWorkspaceMemory(db, organizationId), getOwnUnderstanding(db, organizationId)]);
  const assessments = own ? await assessRecentCompanies(db, organizationId, memory, own) : [];
  return composeBriefing({ ownName: own?.own.name ?? null, ownQuestion: own?.understanding.nextQuestion ?? null, memory, assessments });
}
