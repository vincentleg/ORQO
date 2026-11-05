/**
 * Judge hook for the subjective dimensions (company understanding, opportunity reasoning, decision-maker
 * reasoning). The harness never calls a model to judge: the event's evaluator (human panel, provided judge
 * model, …) consumes judge requests and returns verdicts as a file.
 *
 *   1. eval/run.ts --emit-judge-requests   → <run>/judge-requests.jsonl   (one line per example × dimension)
 *   2. the event's judge writes             → verdicts.jsonl  {"exampleId","dimension","score":0..1,"rationale"}
 *   3. eval/run.ts --judge file:verdicts.jsonl --judge-weight 0.5
 *      final = (1 − w) · deterministic + w · judge     (deterministic only when no verdict exists)
 *
 * Factual grounding, fit, calibration and schema stay fully deterministic: a judge can never raise them.
 */
import { isAbsolute, join } from "node:path";
import { REPO_ROOT, SUBJECTIVE_DIMENSIONS } from "../configs/config";
import { readJsonl } from "../dataset/io";
import type { Example } from "../dataset/schema/example";
import { userMessage } from "../prompts/prompt";

export type SubjectiveDimension = (typeof SUBJECTIVE_DIMENSIONS)[number];

export const RUBRICS: Record<SubjectiveDimension, string> = {
  company_understanding:
    "Score 0–1. Does the analysis capture what the company ACTUALLY does (its concrete offer, not its slogan), its products, business model, markets and deployment characteristics, using only the evidence? Penalise surface reading of buzzwords, missed key facts, and any content not supported by the evidence.",
  opportunity_reasoning:
    "Score 0–1. Is the commercial thesis concrete and credible for THIS represented company: a real mechanism (what each side brings, why it makes commercial sense, why now) grounded in the evidence? Is 'no opportunity' chosen when nothing credible exists? Penalise generic synergies, ignored contradicting evidence and an unsuitable next action.",
  decision_maker_reasoning:
    "Score 0–1. Are the suggested decision-maker ROLES the ones that would own this decision at this company, each with a specific reason tied to the opportunity? Any person name or contact detail scores 0.",
};

export interface JudgeRequest {
  exampleId: string;
  runLabel: string;
  dimension: SubjectiveDimension;
  rubric: string;
  input: string;
  completion: string;
  reference: unknown;
  deterministicScore: number;
}

export interface JudgeVerdict {
  score: number;
  rationale: string;
}

export interface Judge {
  readonly id: string;
  verdict(exampleId: string, dimension: SubjectiveDimension, runLabel: string): JudgeVerdict | null;
}

export const noJudge: Judge = { id: "none", verdict: () => null };

export class FileJudge implements Judge {
  readonly id: string;
  private readonly map = new Map<string, JudgeVerdict>();
  constructor(path: string) {
    this.id = `file:${path}`;
    for (const r of readJsonl(isAbsolute(path) ? path : join(REPO_ROOT, path))) {
      const v = r as { exampleId: string; dimension: string; score: number; rationale?: string; runLabel?: string };
      if (!(SUBJECTIVE_DIMENSIONS as readonly string[]).includes(v.dimension) || typeof v.score !== "number" || v.score < 0 || v.score > 1) throw new Error(`${path}: invalid verdict ${JSON.stringify(v).slice(0, 120)}`);
      this.map.set(`${v.runLabel ?? "*"}|${v.exampleId}|${v.dimension}`, { score: v.score, rationale: v.rationale ?? "" });
    }
  }
  verdict(exampleId: string, dimension: SubjectiveDimension, runLabel: string): JudgeVerdict | null {
    return this.map.get(`${runLabel}|${exampleId}|${dimension}`) ?? this.map.get(`*|${exampleId}|${dimension}`) ?? null;
  }
}

export function judgeFromSpec(spec: string | undefined): Judge {
  if (!spec || spec === "none") return noJudge;
  if (spec.startsWith("file:")) return new FileJudge(spec.slice(5));
  throw new Error(`unknown judge spec "${spec}" (none | file:<verdicts.jsonl>)`);
}

export function judgeRequests(e: Example, runLabel: string, completion: string, deterministic: Record<string, number>): JudgeRequest[] {
  return SUBJECTIVE_DIMENSIONS.map((dimension) => ({ exampleId: e.id, runLabel, dimension, rubric: RUBRICS[dimension], input: userMessage(e), completion, reference: e.expected, deterministicScore: deterministic[dimension] }));
}
