/**
 * Exports train / validation into the shapes common training stacks consume. The holdout is NEVER exported.
 *
 *   --format chat               {"messages":[system,user,assistant]}                 SFT, LoRA/QLoRA (chat template)
 *   --format prompt-completion  {"prompt":[system,user],"completion":[assistant]}    SFT (TRL prompt-completion style)
 *   --format rl                 {"prompt":[system,user],"example_id":…}              GRPO/RL (reward via rewards/server.ts)
 *   --format text               {"prompt":"…","completion":"…"}                       plain-text trainers
 *
 *   bun training/company-intelligence/dataset/export.ts --split train --format chat [--out <dir>]
 *
 * Writes <out>/<split>.<format>.jsonl and <out>/export-manifest.json: the example ids and input hashes that
 * were exported, the prompt version and the split manifest hash. The integration gate reads this manifest
 * to prove the trained model never saw a holdout example.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { assertSafety, paths, REPO_ROOT } from "../configs/config";
import { buildMessages, promptVersion, systemPrompt, targetCompletion, userMessage } from "../prompts/prompt";
import { parseArgs, sha256, writeJson, writeJsonl } from "./io";
import type { Example } from "./schema/example";
import { holdoutFingerprints, loadSplit, manifestFile, type SplitName } from "./split";
import { inputHash } from "./validate";

export const EXPORT_FORMATS = ["chat", "prompt-completion", "rl", "text"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXPORTABLE: readonly SplitName[] = ["train", "validation"];

export interface ExportManifest {
  version: "ci-export/v1";
  promptVersion: string;
  splitManifestSha256: string;
  files: { split: SplitName; format: ExportFormat; file: string; sha256: string; ids: string[]; inputHashes: string[] }[];
}

export function exportRow(e: Example, format: ExportFormat): unknown {
  const [system, user] = buildMessages(e);
  const assistant = { role: "assistant", content: targetCompletion(e) };
  switch (format) {
    case "chat":
      return { messages: [system, user, assistant], example_id: e.id };
    case "prompt-completion":
      return { prompt: [system, user], completion: [assistant], example_id: e.id };
    case "rl":
      return { prompt: [system, user], example_id: e.id };
    case "text":
      return { prompt: `${systemPrompt()}\n\n${userMessage(e)}`, completion: targetCompletion(e), example_id: e.id };
  }
}

export function exportSplit(split: string, format: string, outDir: string) {
  if (split === "holdout") throw new Error("The holdout split is never exported for training.");
  if (!(EXPORTABLE as readonly string[]).includes(split)) throw new Error(`--split must be one of ${EXPORTABLE.join(", ")}`);
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new Error(`--format must be one of ${EXPORT_FORMATS.join(", ")}`);
  const { examples, manifest } = loadSplit(split as SplitName);
  const holdout = holdoutFingerprints(manifest);
  for (const e of examples) if (holdout.ids.has(e.id) || holdout.inputs.has(inputHash(e))) throw new Error(`refusing to export ${e.id}: it matches a holdout example`);
  const rows = examples.map((e) => exportRow(e, format as ExportFormat));
  const file = join(outDir, `${split}.${format}.jsonl`);
  writeJsonl(file, rows);
  const text = readFileSync(file, "utf8");
  const manifestPath = join(outDir, "export-manifest.json");
  let em: ExportManifest;
  try {
    em = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    em = { version: "ci-export/v1", promptVersion: promptVersion(), splitManifestSha256: "", files: [] };
  }
  em.promptVersion = promptVersion();
  em.splitManifestSha256 = sha256(readFileSync(manifestFile(), "utf8"));
  em.files = [...em.files.filter((f) => !(f.split === split && f.format === format)), { split: split as SplitName, format: format as ExportFormat, file: file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length + 1) : file, sha256: sha256(text), ids: examples.map((e) => e.id), inputHashes: examples.map(inputHash) }];
  writeJson(manifestPath, em);
  return { file, manifestPath, count: rows.length };
}

if (import.meta.main) {
  assertSafety();
  const a = parseArgs(process.argv.slice(2));
  const out = typeof a.out === "string" ? (isAbsolute(a.out) ? a.out : join(REPO_ROOT, a.out)) : join(paths.results, "exports");
  try {
    const r = exportSplit(String(a.split ?? "train"), String(a.format ?? "chat"), out);
    console.log(`✓ ${r.count} rows → ${r.file}\n  manifest → ${r.manifestPath}`);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }
}
