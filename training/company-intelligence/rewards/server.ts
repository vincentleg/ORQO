/**
 * Reward server over stdio, so any trainer (Python TRL/verl/OpenRLHF, or anything else) can use the exact
 * same reward without re-implementing it.
 *
 *   bun training/company-intelligence/rewards/server.ts [--splits train,validation]
 *   stdin : {"example_id":"…","completion":"…"}            one JSON object per line
 *   stdout: {"example_id":"…","reward":0.73,"valid":true,"penalty":0,"violations":["…"]}
 *
 * Only train/validation gold answers are loaded. A holdout id is answered with an error and reward null:
 * the holdout can never shape training.
 */
import { createInterface } from "node:readline";
import { assertSafety, loadRewardConfig } from "../configs/config";
import { parseArgs } from "../dataset/io";
import type { Example } from "../dataset/schema/example";
import { loadSplit, type SplitName } from "../dataset/split";
import { reward } from "./reward";

export function loadRewardExamples(splits: readonly string[]): Map<string, Example> {
  if (splits.includes("holdout")) throw new Error("the reward server never loads the holdout split");
  const out = new Map<string, Example>();
  for (const s of splits) for (const e of loadSplit(s as SplitName).examples) out.set(e.id, e);
  return out;
}

export function handleLine(line: string, examples: Map<string, Example>, holdoutIds: Set<string>, cfg = loadRewardConfig()): Record<string, unknown> {
  let req: { example_id?: string; exampleId?: string; completion?: unknown };
  try {
    req = JSON.parse(line);
  } catch {
    return { error: "invalid JSON request", reward: null };
  }
  const id = req.example_id ?? req.exampleId ?? "";
  if (holdoutIds.has(id)) return { example_id: id, error: "holdout example: refused", reward: null };
  const e = examples.get(id);
  if (!e) return { example_id: id, error: "unknown example_id", reward: null };
  const r = reward(e, typeof req.completion === "string" ? req.completion : "", cfg);
  return { example_id: id, reward: r.reward, valid: r.valid, weighted: r.weighted, penalty: r.penalty, violations: r.penalties.map((p) => `${p.kind}@${p.path}`) };
}

if (import.meta.main) {
  assertSafety();
  const a = parseArgs(process.argv.slice(2));
  const splits = String(a.splits ?? "train,validation").split(",");
  const examples = loadRewardExamples(splits);
  const holdoutIds = new Set(loadSplit("holdout").manifest.splits.holdout.ids);
  const cfg = loadRewardConfig();
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    process.stdout.write(JSON.stringify(handleLine(line, examples, holdoutIds, cfg)) + "\n");
  }
}
