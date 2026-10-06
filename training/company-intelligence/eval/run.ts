/**
 * Runs one model (through an adapter) over one split and scores it.
 *
 *   bun training/company-intelligence/eval/run.ts --adapter <spec> --label <base|trained|…> [--split holdout]
 *        [--judge none|file:<verdicts.jsonl>] [--judge-weight 0.5] [--emit-judge-requests] [--max-tokens 4096]
 *
 * Writes results/runs/<label>/{predictions.jsonl, results.json, summary.md[, judge-requests.jsonl]}.
 * Two runs (base, trained) on the same holdout are then compared by eval/gate.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSafety, DIMENSIONS, loadRewardConfig, paths, SUBJECTIVE_DIMENSIONS, type Dimension, type PenaltyKind, type RewardConfig } from "../configs/config";
import { parseArgs, sha256, writeJson, writeJsonl, writeText } from "../dataset/io";
import type { Example } from "../dataset/schema/example";
import { CONTRACT_VERSION } from "../dataset/schema/output";
import { loadSplit, manifestFile, SPLITS, type SplitName } from "../dataset/split";
import { buildMessages, promptVersion } from "../prompts/prompt";
import { rewardFromScore } from "../rewards/reward";
import { adapterFromSpec, type InferenceAdapter } from "./adapters";
import { judgeFromSpec, judgeRequests, noJudge, type Judge, type JudgeRequest } from "./judge";
import { SCORER_VERSION, scoreExample, type Violation } from "./scorer";

export const RESULT_VERSION = "ci-eval-result/v1";

export interface ExampleResult {
  id: string;
  caseTags: string[];
  valid: boolean;
  wrapped: boolean;
  parseErrors: string[];
  dims: Record<Dimension, number>;
  deterministicDims: Record<Dimension, number>;
  reward: number;
  weighted: number;
  penalty: number;
  violations: Violation[];
  hallucination: boolean;
  fabricatedContact: boolean;
  predictedFit: string | null;
  fitCorrect: boolean;
  latencyMs: number;
  error: string | null;
}

export interface Aggregate {
  n: number;
  dims: Record<Dimension, number>;
  /** Mean reward (penalty-inclusive): the headline "overall" number the gate compares. */
  overall: number;
  weightedScore: number;
  schemaValidRate: number;
  strictSchemaRate: number;
  hallucinationRate: number;
  fabricatedContactRate: number;
  fitAccuracy: number;
  violationCounts: Partial<Record<PenaltyKind, number>>;
}

export interface EvalResult {
  version: typeof RESULT_VERSION;
  label: string;
  adapter: string;
  split: SplitName;
  splitSha256: string;
  splitManifestSha256: string;
  exampleIds: string[];
  promptVersion: string;
  contractVersion: string;
  scorerVersion: string;
  rewardVersion: string;
  judge: { id: string; weight: number };
  createdAt: string;
  externalPaidSpendUsd: 0;
  aggregate: Aggregate;
  perExample: ExampleResult[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function aggregate(rows: readonly ExampleResult[]): Aggregate {
  const counts: Partial<Record<PenaltyKind, number>> = {};
  for (const r of rows) for (const v of r.violations) counts[v.kind] = (counts[v.kind] ?? 0) + 1;
  return {
    n: rows.length,
    dims: Object.fromEntries(DIMENSIONS.map((d) => [d, r4(mean(rows.map((r) => r.dims[d])))])) as Record<Dimension, number>,
    overall: r4(mean(rows.map((r) => r.reward))),
    weightedScore: r4(mean(rows.map((r) => r.weighted))),
    schemaValidRate: r4(mean(rows.map((r) => Number(r.valid)))),
    strictSchemaRate: r4(mean(rows.map((r) => Number(r.valid && !r.wrapped)))),
    hallucinationRate: r4(mean(rows.map((r) => Number(r.hallucination)))),
    fabricatedContactRate: r4(mean(rows.map((r) => Number(r.fabricatedContact)))),
    fitAccuracy: r4(mean(rows.map((r) => Number(r.fitCorrect)))),
    violationCounts: counts,
  };
}

export interface EvaluateOptions {
  label: string;
  split: SplitName;
  examples: readonly Example[];
  splitSha256: string;
  splitManifestSha256: string;
  judge?: Judge;
  judgeWeight?: number;
  maxOutputTokens?: number;
  rewardConfig?: RewardConfig;
}

export async function evaluate(adapter: InferenceAdapter, o: EvaluateOptions): Promise<{ result: EvalResult; predictions: { exampleId: string; completion: string }[]; judgeRequests: JudgeRequest[] }> {
  const judge = o.judge ?? noJudge;
  const w = judge === noJudge ? 0 : (o.judgeWeight ?? 0.5);
  const cfg = o.rewardConfig ?? loadRewardConfig();
  const rows: ExampleResult[] = [];
  const predictions: { exampleId: string; completion: string }[] = [];
  const requests: JudgeRequest[] = [];
  for (const e of o.examples) {
    let completion = "";
    let latencyMs = 0;
    let error: string | null = null;
    try {
      const r = await adapter.generate({ example: e, messages: buildMessages(e), maxOutputTokens: o.maxOutputTokens ?? 4096 });
      completion = r.completion;
      latencyMs = r.latencyMs;
    } catch (err) {
      error = (err as Error).message.slice(0, 300);
    }
    predictions.push({ exampleId: e.id, completion });
    const score = scoreExample(e, completion);
    const deterministicDims = { ...score.dims };
    if (score.valid) {
      requests.push(...judgeRequests(e, o.label, completion, deterministicDims));
      for (const d of SUBJECTIVE_DIMENSIONS) {
        const v = judge.verdict(e.id, d, o.label);
        if (v) score.dims[d] = (1 - w) * deterministicDims[d] + w * v.score;
      }
    }
    const rw = rewardFromScore(score, cfg);
    rows.push({ id: e.id, caseTags: e.caseTags, valid: score.valid, wrapped: score.wrapped, parseErrors: score.parseErrors, dims: score.dims, deterministicDims, reward: rw.reward, weighted: rw.weighted, penalty: rw.penalty, violations: score.violations, hallucination: score.hallucination, fabricatedContact: score.fabricatedContact, predictedFit: score.predictedFit, fitCorrect: score.fitCorrect, latencyMs, error });
  }
  const result: EvalResult = {
    version: RESULT_VERSION,
    label: o.label,
    adapter: adapter.id,
    split: o.split,
    splitSha256: o.splitSha256,
    splitManifestSha256: o.splitManifestSha256,
    exampleIds: o.examples.map((e) => e.id),
    promptVersion: promptVersion(),
    contractVersion: CONTRACT_VERSION,
    scorerVersion: SCORER_VERSION,
    rewardVersion: cfg.version,
    judge: { id: judge.id, weight: w },
    createdAt: new Date().toISOString(),
    externalPaidSpendUsd: 0,
    aggregate: aggregate(rows),
    perExample: rows,
  };
  return { result, predictions, judgeRequests: requests };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function summaryMarkdown(r: EvalResult): string {
  const a = r.aggregate;
  return [
    `# Eval — ${r.label}`,
    "",
    `adapter \`${r.adapter}\` · split \`${r.split}\` (${a.n} examples, sha256 ${r.splitSha256.slice(0, 12)}) · prompt \`${r.promptVersion}\` · judge \`${r.judge.id}\` · external spend $0`,
    "",
    `| metric | value |`,
    `|---|---|`,
    `| **overall (mean reward)** | **${a.overall.toFixed(3)}** |`,
    ...DIMENSIONS.map((d) => `| ${d} | ${a.dims[d].toFixed(3)} |`),
    `| schema valid | ${pct(a.schemaValidRate)} (strict ${pct(a.strictSchemaRate)}) |`,
    `| hallucination rate | ${pct(a.hallucinationRate)} |`,
    `| fabricated contact rate | ${pct(a.fabricatedContactRate)} |`,
    `| fit accuracy | ${pct(a.fitAccuracy)} |`,
    "",
    "## Per example",
    "",
    "| id | reward | valid | fit | halluc. | violations |",
    "|---|---|---|---|---|---|",
    ...r.perExample.map((x) => `| ${x.id} | ${x.reward.toFixed(3)} | ${x.valid ? (x.wrapped ? "wrapped" : "yes") : "**no**"} | ${x.predictedFit ?? "—"}${x.fitCorrect ? " ✓" : ""} | ${x.hallucination ? "**yes**" : "no"} | ${x.violations.map((v) => v.kind).join(", ") || x.parseErrors.slice(0, 1).join("") || "—"} |`),
    "",
  ].join("\n");
}

if (import.meta.main) {
  assertSafety();
  const a = parseArgs(process.argv.slice(2));
  const label = String(a.label ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{0,60}$/.test(label)) throw new Error("--label is required ([a-z0-9._-])");
  const split = String(a.split ?? "holdout") as SplitName;
  if (!SPLITS.includes(split)) throw new Error(`--split must be one of ${SPLITS.join(", ")}`);
  const adapter = adapterFromSpec(String(a.adapter ?? ""));
  const { examples, sha256: splitSha256 } = loadSplit(split);
  const { result, predictions, judgeRequests: reqs } = await evaluate(adapter, {
    label,
    split,
    examples,
    splitSha256,
    splitManifestSha256: sha256(readFileSync(manifestFile(), "utf8")),
    judge: judgeFromSpec(typeof a.judge === "string" ? a.judge : undefined),
    judgeWeight: typeof a["judge-weight"] === "string" ? Number(a["judge-weight"]) : undefined,
    maxOutputTokens: typeof a["max-tokens"] === "string" ? Number(a["max-tokens"]) : undefined,
  });
  const dir = typeof a.out === "string" ? a.out : join(paths.results, "runs", label);
  writeJsonl(join(dir, "predictions.jsonl"), predictions);
  writeJson(join(dir, "results.json"), result);
  writeText(join(dir, "summary.md"), summaryMarkdown(result));
  if (a["emit-judge-requests"]) writeJsonl(join(dir, "judge-requests.jsonl"), reqs);
  console.log(summaryMarkdown(result).split("## Per example")[0]);
  console.log(`→ ${dir}/results.json`);
}
