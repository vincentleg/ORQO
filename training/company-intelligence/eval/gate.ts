/**
 * ORQO integration gate: BASE vs TRAINED on the same untouched holdout.
 *
 * A trained model qualifies for an ORQO integration REVIEW (never automatic integration) only if every
 * blocking check passes:
 *   1. holdout_untouched     both runs scored the current, manifest-verified holdout; the training export
 *                            manifest proves no holdout id or input was exported for training
 *   2. comparable            same prompt, contract, scorer, reward and judge setup
 *   3. overall_improvement   trained.overall − base.overall ≥ minOverallImprovement
 *   4. grounding             factual_grounding does not regress (beyond maxGroundingRegression)
 *   5. hallucination         hallucination rate and fabricated-contact rate do not increase
 *   6. schema_reliability    trained schema-valid rate ≥ minSchemaValidRate
 * Non-blocking: per-dimension regressions and per-example regressions are reported as warnings.
 *
 *   bun training/company-intelligence/eval/gate.ts --base <results.json> --trained <results.json> \
 *       --training-manifest <export-manifest.json>   →  results/gate/{gate.json,gate.md}; exit 0 = qualifies
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { assertSafety, DIMENSIONS, loadGateConfig, paths, REPO_ROOT, type Dimension, type GateConfig } from "../configs/config";
import { parseArgs, sha256, writeJson, writeText } from "../dataset/io";
import type { ExportManifest } from "../dataset/export";
import { holdoutFingerprints, loadManifest, manifestFile, type SplitManifest } from "../dataset/split";
import type { EvalResult } from "./run";

export interface GateCheck {
  name: string;
  pass: boolean;
  blocking: boolean;
  detail: string;
}

export interface GateResult {
  version: "ci-gate-result/v1";
  decision: "qualifies_for_integration_review" | "does_not_qualify";
  createdAt: string;
  base: { label: string; adapter: string; overall: number };
  trained: { label: string; adapter: string; overall: number };
  checks: GateCheck[];
  deltas: Record<Dimension | "overall" | "hallucinationRate" | "schemaValidRate" | "fabricatedContactRate", number>;
  exampleRegressions: { id: string; base: number; trained: number }[];
  config: GateConfig;
  externalPaidSpendUsd: 0;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function runGate(base: EvalResult, trained: EvalResult, training: ExportManifest | null, manifest: SplitManifest, manifestSha: string, cfg: GateConfig = loadGateConfig()): GateResult {
  const checks: GateCheck[] = [];
  const check = (name: string, pass: boolean, detail: string, blocking = true) => checks.push({ name, pass, blocking, detail });
  const B = base.aggregate;
  const T = trained.aggregate;

  // 1. Holdout untouched
  const holdoutSha = manifest.splits.holdout.sha256;
  const sameIds = (r: EvalResult) => r.exampleIds.length === manifest.splits.holdout.ids.length && r.exampleIds.every((id) => manifest.splits.holdout.ids.includes(id));
  const scored = [base, trained].every((r) => r.split === "holdout" && r.splitSha256 === holdoutSha && r.splitManifestSha256 === manifestSha && sameIds(r));
  const fp = holdoutFingerprints(manifest);
  let provenance = "no training export manifest supplied";
  let leaked: string[] = [];
  let provenanceOk = !cfg.requireTrainingManifest;
  if (training) {
    leaked = training.files.flatMap((f) => [...f.ids.filter((id) => fp.ids.has(id)), ...f.inputHashes.filter((h) => fp.inputs.has(h)).map((h) => `input:${h.slice(0, 12)}`)]);
    const sameSplits = training.splitManifestSha256 === manifestSha;
    const noHoldoutFiles = training.files.every((f) => (f.split as string) !== "holdout");
    provenanceOk = !leaked.length && sameSplits && noHoldoutFiles && training.files.length > 0;
    provenance = leaked.length ? `holdout leaked into training: ${leaked.join(", ")}` : !sameSplits ? "training export was made from a different split manifest" : !noHoldoutFiles ? "a holdout file was exported" : !training.files.length ? "training manifest lists no files" : `${training.files.reduce((n, f) => n + f.ids.length, 0)} exported rows, none from the holdout`;
  }
  check("holdout_untouched", scored && provenanceOk, `${scored ? `both runs scored holdout ${holdoutSha.slice(0, 12)} (${manifest.splits.holdout.ids.length} examples)` : "runs were not both scored on the current verified holdout"}; ${provenance}`);

  // 2. Comparable setup
  const keys = ["promptVersion", "contractVersion", "scorerVersion", "rewardVersion"] as const;
  const diff = keys.filter((k) => base[k] !== trained[k]);
  const judgeSame = base.judge.id === trained.judge.id && base.judge.weight === trained.judge.weight;
  check("comparable", !diff.length && judgeSame, diff.length || !judgeSame ? `differs: ${[...diff, ...(judgeSame ? [] : ["judge"])].join(", ")}` : "same prompt, contract, scorer, reward and judge");

  // 3–6. Quality
  const dOverall = T.overall - B.overall;
  check("overall_improvement", dOverall >= cfg.minOverallImprovement, `overall ${B.overall.toFixed(3)} → ${T.overall.toFixed(3)} (Δ ${dOverall >= 0 ? "+" : ""}${dOverall.toFixed(3)}, required ≥ +${cfg.minOverallImprovement})`);
  const dGround = T.dims.factual_grounding - B.dims.factual_grounding;
  check("grounding_no_regression", dGround >= -cfg.maxGroundingRegression, `factual_grounding ${B.dims.factual_grounding.toFixed(3)} → ${T.dims.factual_grounding.toFixed(3)}`);
  const dHall = T.hallucinationRate - B.hallucinationRate;
  const dContact = T.fabricatedContactRate - B.fabricatedContactRate;
  check("hallucination_no_regression", dHall <= cfg.maxHallucinationRateIncrease && dContact <= 0, `hallucination rate ${(B.hallucinationRate * 100).toFixed(1)}% → ${(T.hallucinationRate * 100).toFixed(1)}%; fabricated contacts ${(B.fabricatedContactRate * 100).toFixed(1)}% → ${(T.fabricatedContactRate * 100).toFixed(1)}%`);
  check("schema_reliability", T.schemaValidRate >= cfg.minSchemaValidRate, `trained schema-valid ${(T.schemaValidRate * 100).toFixed(1)}% (required ≥ ${(cfg.minSchemaValidRate * 100).toFixed(0)}%)`);

  // Warnings
  for (const d of DIMENSIONS) {
    const delta = T.dims[d] - B.dims[d];
    if (delta < -cfg.dimensionRegressionWarning) check(`dimension_regression:${d}`, false, `${d} ${B.dims[d].toFixed(3)} → ${T.dims[d].toFixed(3)}`, false);
  }
  const baseBy = new Map(base.perExample.map((x) => [x.id, x.reward]));
  const exampleRegressions = trained.perExample.filter((x) => (baseBy.get(x.id) ?? -1) - x.reward > 0.1).map((x) => ({ id: x.id, base: baseBy.get(x.id)!, trained: x.reward }));
  if (exampleRegressions.length) check("example_regressions", false, `${exampleRegressions.length} example(s) lost > 0.1 reward: ${exampleRegressions.map((x) => x.id).join(", ")}`, false);

  const deltas = {
    ...(Object.fromEntries(DIMENSIONS.map((d) => [d, r4(T.dims[d] - B.dims[d])])) as Record<Dimension, number>),
    overall: r4(dOverall),
    hallucinationRate: r4(dHall),
    schemaValidRate: r4(T.schemaValidRate - B.schemaValidRate),
    fabricatedContactRate: r4(dContact),
  };
  return {
    version: "ci-gate-result/v1",
    decision: checks.every((c) => c.pass || !c.blocking) ? "qualifies_for_integration_review" : "does_not_qualify",
    createdAt: new Date().toISOString(),
    base: { label: base.label, adapter: base.adapter, overall: B.overall },
    trained: { label: trained.label, adapter: trained.adapter, overall: T.overall },
    checks,
    deltas,
    exampleRegressions,
    config: cfg,
    externalPaidSpendUsd: 0,
  };
}

export function gateMarkdown(g: GateResult): string {
  return [
    `# ORQO integration gate — ${g.decision === "qualifies_for_integration_review" ? "✅ QUALIFIES for integration review" : "❌ DOES NOT QUALIFY"}`,
    "",
    `base \`${g.base.adapter}\` (${g.base.overall.toFixed(3)}) vs trained \`${g.trained.adapter}\` (${g.trained.overall.toFixed(3)}) · external spend $0`,
    "",
    "| check | result | blocking | detail |",
    "|---|---|---|---|",
    ...g.checks.map((c) => `| ${c.name} | ${c.pass ? "pass" : "**FAIL**"} | ${c.blocking ? "yes" : "warning"} | ${c.detail} |`),
    "",
    "| delta | value |",
    "|---|---|",
    ...Object.entries(g.deltas).map(([k, v]) => `| ${k} | ${v >= 0 ? "+" : ""}${v.toFixed(3)} |`),
    "",
    "Qualifying never integrates anything: it only makes the model eligible for an explicit ORQO integration review.",
    "",
  ].join("\n");
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(isAbsolute(p) ? p : join(REPO_ROOT, p), "utf8")) as T;

if (import.meta.main) {
  assertSafety();
  const a = parseArgs(process.argv.slice(2));
  if (typeof a.base !== "string" || typeof a.trained !== "string") throw new Error("--base and --trained results.json are required");
  const training = typeof a["training-manifest"] === "string" ? readJson<ExportManifest>(a["training-manifest"]) : null;
  const g = runGate(readJson<EvalResult>(a.base), readJson<EvalResult>(a.trained), training, loadManifest(), sha256(readFileSync(manifestFile(), "utf8")));
  const dir = typeof a.out === "string" ? a.out : join(paths.results, "gate");
  writeJson(join(dir, "gate.json"), g);
  writeText(join(dir, "gate.md"), gateMarkdown(g));
  console.log(gateMarkdown(g));
  process.exit(g.decision === "qualifies_for_integration_review" ? 0 : 1);
}
