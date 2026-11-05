/**
 * Compiles the human-reviewable seed sources (dataset/seed/*.json, represented companies resolved from
 * dataset/seed/represented/) into dataset/seed.jsonl, validates it, and regenerates the JSON Schemas.
 *
 *   bun training/company-intelligence/dataset/build.ts          # write
 *   bun training/company-intelligence/dataset/build.ts --check  # verify committed files are up to date
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assertSafety, paths } from "../configs/config";
import { parseArgs, writeText } from "./io";
import { EXAMPLE_VERSION, ExampleSchema } from "./schema/example";
import { CompanyIntelligenceSchema } from "./schema/output";
import { validateDataset } from "./validate";

export function compileSeed(): unknown[] {
  const repDir = join(paths.seedDir, "represented");
  const represented = new Map(readdirSync(repDir).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(repDir, f), "utf8"))]));
  return readdirSync(paths.seedDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const src = JSON.parse(readFileSync(join(paths.seedDir, f), "utf8"));
      const rc = typeof src.representedCompany === "string" ? represented.get(src.representedCompany) : src.representedCompany;
      if (!rc) throw new Error(`${f}: unknown represented company "${src.representedCompany}"`);
      // Fixed key order: schemaVersion first, then the source fields.
      return { schemaVersion: EXAMPLE_VERSION, ...src, representedCompany: rc };
    });
}

export const jsonSchemas = () => ({
  "company-intelligence.output.schema.json": JSON.stringify(z.toJSONSchema(CompanyIntelligenceSchema, { io: "input" }), null, 2) + "\n",
  "example.schema.json": JSON.stringify(z.toJSONSchema(ExampleSchema, { io: "input" }), null, 2) + "\n",
});

export const seedJsonlText = (rows: readonly unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

if (import.meta.main) {
  assertSafety();
  const args = parseArgs(process.argv.slice(2));
  const rows = compileSeed();
  const { examples, errors } = validateDataset(rows);
  if (errors.length) {
    console.error(`✗ ${errors.length} dataset error(s):\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  const outputs: [string, string][] = [[paths.seedJsonl, seedJsonlText(rows)], ...Object.entries(jsonSchemas()).map(([f, t]) => [join(paths.schemaDir, f), t] as [string, string])];
  if (args.check) {
    const stale = outputs.filter(([p, t]) => {
      try {
        return readFileSync(p, "utf8") !== t;
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error(`✗ out of date (run dataset/build.ts): ${stale.map(([p]) => p).join(", ")}`);
      process.exit(1);
    }
    console.log(`✓ ${examples.length} examples valid; generated files up to date`);
  } else {
    for (const [p, t] of outputs) writeText(p, t);
    console.log(`✓ ${examples.length} examples valid → ${paths.seedJsonl}`);
  }
}
