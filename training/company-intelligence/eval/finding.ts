/**
 * Company Intelligence v1 → ORQO mission finding (Phase 17B `MissionFinding`).
 *
 * Not wired into the product: this shows (and the tests prove) that the trained capability's output becomes a
 * `company_analysis` finding with the same payload vocabulary the mission engine already records — fit maps
 * onto discovery PRIORITIES, opportunities onto the {relationship, verdict, confidence} summary, unknowns onto
 * UNDERSTANDING_FIELDS, evidence onto {sources, facts, inferences} — with the full analysis carried alongside.
 * Integration remains gated by eval/gate.ts and an explicit review.
 */
import type { Priority } from "@/lib/discovery/types";
import { UNDERSTANDING_FIELDS, type UnderstandingField } from "@/lib/intelligence/types";
import type { MissionFinding } from "@/lib/missions/findings";
import { claimsOf, type CompanyIntelligence, type FitClass } from "../dataset/schema/output";

export const FIT_TO_PRIORITY: Record<FitClass, Priority | null> = { excellent: "high", moderate: "worth_investigating", poor: "weak", insufficient_evidence: null };

const KEY_SAFE = (s: string) => s.toLowerCase().replace(/[^a-z0-9_:.-]/g, "_").slice(0, 200);

export function toMissionFinding(o: CompanyIntelligence, source: { model: string; promptVersion: string }): MissionFinding {
  const claims = claimsOf(o);
  const opp = o.opportunity ? [{ relationship: o.opportunity.relationship, rule: null, verdict: o.fit.class === "excellent" ? "pass" : "weak", confidence: o.confidence.level, validation: [] }] : [];
  const isUnderstanding = (f: string): f is UnderstandingField => (UNDERSTANDING_FIELDS as readonly string[]).includes(f);
  return {
    key: KEY_SAFE(`analysis:${o.company.domain}`),
    kind: "company_analysis",
    subjectDomain: o.company.domain,
    payload: {
      name: o.company.name,
      domain: o.company.domain,
      source: { kind: "company_intelligence_v1", ...source },
      analysisStatus: o.opportunity ? (o.fit.class === "excellent" ? "opportunities" : "hypotheses_only") : "none",
      opportunities: o.fit.class === "excellent" ? opp : [],
      hypotheses: o.fit.class === "excellent" ? [] : opp,
      priority: FIT_TO_PRIORITY[o.fit.class],
      unknowns: [...new Set(o.unknowns.map((u) => u.field).filter(isUnderstanding))],
      evidence: { sources: new Set(claims.flatMap((c) => c.evidence)).size, facts: claims.filter((c) => c.basis === "fact").length, inferences: claims.filter((c) => c.basis === "inference").length },
      nextAction: o.nextAction.kind,
      intelligence: o,
    },
  };
}
