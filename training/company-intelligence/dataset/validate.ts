/**
 * Dataset validation beyond the schema: each gold answer must itself pass the scorer cleanly (zero
 * violations, full grounding, correct labels), synthetic data must be unmistakably synthetic, gold labels must
 * be self-consistent, and there must be no duplicates. Used by build.ts, split.ts and the tests.
 */
import { scoreExample } from "../eval/scorer";
import { allStrings, canonicalJson, containsTerm, norm, sha256 } from "./io";
import { ExampleSchema, type Example } from "./schema/example";
import { SIGNALS } from "./schema/output";

/** Content identity of an example's INPUT (what a model sees). Two examples with the same input are duplicates. */
export const inputHash = (e: Example) => sha256(canonicalJson({ representedCompany: e.representedCompany, target: e.target, evidence: e.evidence.map((x) => ({ ...x, text: norm(x.text) })) }));
export const exampleHash = (e: Example) => sha256(canonicalJson(e));
/** Split group: one company never appears in two splits. */
export const groupKey = (e: Example) => e.target.domain.toLowerCase();

export function validateExample(e: Example): string[] {
  const errs: string[] = [];
  const p = (m: string) => errs.push(`${e.id}: ${m}`);
  if (e.expected.company.domain !== e.target.domain) p("expected.company.domain differs from target.domain");
  if (e.synthetic && (!e.target.name.includes("(synthetic)") || !e.representedCompany.name.includes("(synthetic)"))) p("synthetic companies must be named '… (synthetic)'");

  const inputText = [...e.evidence.map((x) => x.text), ...allStrings(e.representedCompany), e.target.name];
  for (const t of e.scoring.forbiddenTerms) if (inputText.some((s) => containsTerm(s, t))) p(`forbidden term "${t}" appears in the input, so it cannot be a fabrication`);
  for (const k of SIGNALS) if (e.scoring.mustRemainUnknown.includes(k) && e.scoring.expectedSignals[k] !== "unknown") p(`mustRemainUnknown ${k} but expectedSignals.${k} is not unknown`);
  for (const k of SIGNALS) if (e.expected.deployment[k].status !== e.scoring.expectedSignals[k]) p(`expected.deployment.${k} differs from scoring.expectedSignals`);
  if (e.expected.maturity.stage !== e.scoring.expectedMaturity) p("expected.maturity differs from scoring.expectedMaturity");
  if (e.expected.confidence.level !== e.scoring.expectedConfidence) p("expected.confidence differs from scoring.expectedConfidence");
  if (!e.scoring.acceptableFit.includes(e.expected.fit.class)) p("expected.fit.class not in acceptableFit");
  if (e.expected.opportunity && !e.scoring.acceptableRelationships.includes(e.expected.opportunity.relationship)) p("expected.opportunity.relationship not in acceptableRelationships");
  if (!e.scoring.acceptableNextActions.includes(e.expected.nextAction.kind)) p("expected.nextAction.kind not in acceptableNextActions");

  // The gold answer must score as a perfect, violation-free answer.
  const s = scoreExample(e, JSON.stringify(e.expected));
  if (!s.valid) p(`gold output invalid: ${s.parseErrors.join("; ")}`);
  for (const v of s.violations) p(`gold violation ${v.kind} at ${v.path}: ${v.detail}`);
  for (const [d, v] of Object.entries(s.dims)) if (v < (d === "decision_maker_reasoning" ? 0.7 : 0.999)) p(`gold scores ${v.toFixed(3)} on ${d}`);
  return errs;
}

export function validateDataset(raw: readonly unknown[]): { examples: Example[]; errors: string[] } {
  const errors: string[] = [];
  const examples: Example[] = [];
  raw.forEach((r, i) => {
    const x = ExampleSchema.safeParse(r);
    if (!x.success) errors.push(`row ${i + 1}: ${x.error.issues.slice(0, 5).map((m) => `${m.path.join(".")}: ${m.message}`).join("; ")}`);
    else examples.push(x.data);
  });
  const seen = new Map<string, string>();
  for (const e of examples) {
    errors.push(...validateExample(e));
    for (const [kind, key] of [["id", e.id], ["input", inputHash(e)], ...e.evidence.map((x) => ["evidence", sha256(norm(x.text))])] as [string, string][]) {
      const k = `${kind}:${key}`;
      if (seen.has(k) && seen.get(k) !== e.id) errors.push(`${e.id}: duplicate ${kind} (also in ${seen.get(k)})`);
      else if (seen.has(k) && kind === "id") errors.push(`${e.id}: duplicate id`);
      seen.set(k, e.id);
    }
  }
  return { examples, errors };
}
