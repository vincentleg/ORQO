/**
 * Deterministic train / validation / holdout split.
 *
 * - Grouped by target domain: one company never spans two splits.
 * - Ordered by sha256(salt + group): independent of file order, stable across machines.
 * - Groups allocated holdout first, then validation, then train, by ratio (holdout ≥ 1 group).
 * - Leakage guard: the same example id, input hash or evidence text may never appear in two splits.
 * - manifest.json records every id and the sha256 of each split file. The evaluator and the gate verify the
 *   holdout against it; the exporter refuses to export the holdout at all.
 *
 *   bun training/company-intelligence/dataset/split.ts [--input dataset/seed.jsonl] [--check]
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { assertSafety, loadSplitConfig, paths, REPO_ROOT, type SplitConfig } from "../configs/config";
import { norm, parseArgs, readJsonl, sha256, writeJson, writeText } from "./io";
import type { Example } from "./schema/example";
import { groupKey, inputHash, validateDataset } from "./validate";

export const SPLITS = ["train", "validation", "holdout"] as const;
export type SplitName = (typeof SPLITS)[number];

export interface SplitManifest {
  version: "ci-split/v1";
  salt: string;
  ratios: SplitConfig["ratios"];
  source: { path: string; sha256: string; examples: number };
  splits: Record<SplitName, { file: string; sha256: string; ids: string[]; groups: string[]; inputHashes: string[] }>;
}

export function assignSplits(examples: readonly Example[], cfg: SplitConfig): Record<SplitName, Example[]> {
  const groups = [...new Set(examples.map(groupKey))].sort((a, b) => sha256(cfg.salt + a).localeCompare(sha256(cfg.salt + b)) || a.localeCompare(b));
  const n = groups.length;
  const nHoldout = Math.max(1, Math.round(n * cfg.ratios.holdout));
  const nValidation = Math.min(n - nHoldout, Math.round(n * cfg.ratios.validation));
  const of = new Map<string, SplitName>();
  groups.forEach((g, i) => of.set(g, i < nHoldout ? "holdout" : i < nHoldout + nValidation ? "validation" : "train"));
  const out: Record<SplitName, Example[]> = { train: [], validation: [], holdout: [] };
  for (const e of [...examples].sort((a, b) => a.id.localeCompare(b.id))) out[of.get(groupKey(e))!].push(e);
  return out;
}

/** Throws if any id, group, input or evidence text appears in more than one split. */
export function assertNoLeakage(splits: Record<SplitName, readonly Example[]>): void {
  const owner = new Map<string, SplitName>();
  for (const name of SPLITS) {
    for (const e of splits[name]) {
      const keys = [`id:${e.id}`, `group:${groupKey(e)}`, `input:${inputHash(e)}`, ...e.evidence.map((x) => `evidence:${sha256(norm(x.text))}`)];
      for (const k of keys) {
        const prev = owner.get(k);
        if (prev && prev !== name) throw new Error(`split leakage: ${k} (${e.id}) is in both ${prev} and ${name}`);
        owner.set(k, name);
      }
    }
  }
}

export const splitFile = (name: SplitName) => join(paths.splitsDir, `${name}.jsonl`);
export const manifestFile = () => join(paths.splitsDir, "manifest.json");
const jsonlText = (rows: readonly Example[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");

export function buildSplits(sourcePath: string, cfg: SplitConfig = loadSplitConfig()) {
  const source = readFileSync(sourcePath, "utf8");
  const { examples, errors } = validateDataset(readJsonl(sourcePath));
  if (errors.length) throw new Error(`dataset invalid:\n  ${errors.join("\n  ")}`);
  const splits = assignSplits(examples, cfg);
  assertNoLeakage(splits);
  const texts = Object.fromEntries(SPLITS.map((s) => [s, jsonlText(splits[s])])) as Record<SplitName, string>;
  const manifest: SplitManifest = {
    version: "ci-split/v1",
    salt: cfg.salt,
    ratios: cfg.ratios,
    source: { path: relative(REPO_ROOT, sourcePath), sha256: sha256(source), examples: examples.length },
    splits: Object.fromEntries(
      SPLITS.map((s) => [s, { file: relative(REPO_ROOT, splitFile(s)), sha256: sha256(texts[s]), ids: splits[s].map((e) => e.id), groups: [...new Set(splits[s].map(groupKey))], inputHashes: splits[s].map(inputHash) }]),
    ) as SplitManifest["splits"],
  };
  return { splits, texts, manifest };
}

export function loadManifest(): SplitManifest {
  return JSON.parse(readFileSync(manifestFile(), "utf8"));
}

/** Loads one split and verifies it byte-for-byte against the manifest (an edited holdout is refused). */
export function loadSplit(name: SplitName): { examples: Example[]; sha256: string; manifest: SplitManifest } {
  const manifest = loadManifest();
  const text = readFileSync(splitFile(name), "utf8");
  const hash = sha256(text);
  if (hash !== manifest.splits[name].sha256) throw new Error(`${name} split does not match manifest.json (sha256 ${hash.slice(0, 12)} ≠ ${manifest.splits[name].sha256.slice(0, 12)}). Re-run dataset/split.ts or restore the file.`);
  const { examples, errors } = validateDataset(readJsonl(splitFile(name)));
  if (errors.length) throw new Error(`${name} split invalid:\n  ${errors.join("\n  ")}`);
  return { examples, sha256: hash, manifest };
}

/** What identifies a holdout example inside any other file (id or input content). */
export const holdoutFingerprints = (m: SplitManifest) => ({ ids: new Set(m.splits.holdout.ids), inputs: new Set(m.splits.holdout.inputHashes) });

if (import.meta.main) {
  assertSafety();
  const args = parseArgs(process.argv.slice(2));
  const input = typeof args.input === "string" ? join(REPO_ROOT, args.input) : paths.seedJsonl;
  const { splits, texts, manifest } = buildSplits(input);
  if (args.check) {
    const stale = SPLITS.filter((s) => {
      try {
        return readFileSync(splitFile(s), "utf8") !== texts[s];
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error(`✗ splits out of date: ${stale.join(", ")}`);
      process.exit(1);
    }
    console.log("✓ splits are deterministic and up to date");
  } else {
    for (const s of SPLITS) writeText(splitFile(s), texts[s]);
    writeJson(manifestFile(), manifest);
    console.log(SPLITS.map((s) => `${s}: ${splits[s].length} (${splits[s].map((e) => e.id).join(", ")})`).join("\n"));
  }
}
