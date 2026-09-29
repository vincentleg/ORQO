/**
 * Critic / Qualification module. Tries to reject every draft. An opportunity
 * survives only if evidence, bilateral value, specificity, timing and
 * counterparty requirements hold up.
 */
import type {
  CheckResult,
  Company,
  ConfidenceAssessment,
  CriticCheck,
  CriticReport,
  CriticVerdict,
  WatchCondition,
  World,
} from "@/lib/domain/types";
import { tagLabel, type Tag } from "@/lib/domain/taxonomy";
import { isUrgent, lowerFirst, offersAny, recentSignals, uniq } from "./context";
import type { OpportunityDraft } from "./patterns";

const YEAR_MS = 365 * 86_400_000;
/** A failure on any of these means the idea is not grounded at all. */
const FATAL = new Set(["evidence", "marketing", "specificity"]);

interface ConstraintGap {
  owner: Company;
  counterparty: Company;
  label: string;
  tags: Tag[];
}

function constraintGaps(draft: OpportunityDraft, world: World): ConstraintGap[] {
  const gaps: ConstraintGap[] = [];
  const participants = draft.companyIds.map((id) => world.companies[id]);
  for (const owner of participants) {
    for (const c of owner.constraints) {
      const bound = participants.filter((p) => p.id !== owner.id && c.appliesTo.includes(draft.roles[p.id]));
      if (bound.length === 0) continue;
      const others = participants.filter((p) => p.id !== owner.id);
      const satisfiedByGroup = draft.kind === "multi" && others.some((p) => offersAny(p, c.requiresTags));
      for (const p of bound) {
        if (!offersAny(p, c.requiresTags) && !satisfiedByGroup) {
          gaps.push({ owner, counterparty: p, label: c.label, tags: c.requiresTags });
        }
      }
    }
  }
  return gaps;
}

export interface Critique {
  report: CriticReport;
  confidence: ConfidenceAssessment;
  watchConditions: WatchCondition[];
}

export function critique(draft: OpportunityDraft, world: World): Critique {
  const companies = draft.companyIds.map((id) => world.companies[id]);
  const name = (id: string) => world.companies[id]?.name ?? id;
  const checks: CriticCheck[] = [];
  const watch: WatchCondition[] = [];
  const add = (id: string, question: string, result: CheckResult, note: string) => checks.push({ id, question, result, note });

  // 1. Evidence on every side.
  const factsBy = (id: string) => draft.evidence.filter((e) => e.companyId === id && e.epistemic === "fact" && !e.marketingLanguage);
  const noFacts = companies.filter((c) => factsBy(c.id).length === 0);
  const marketingOnly = noFacts.filter((c) => draft.evidence.filter((e) => e.companyId === c.id).every((e) => e.marketingLanguage));
  if (noFacts.length === 0) add("evidence", "Is there actual evidence on every side?", "pass", `Sourced facts for ${companies.map((c) => c.name).join(", ")}.`);
  else if (marketingOnly.length > 0)
    add("evidence", "Is there actual evidence on every side?", "fail", `Only marketing copy supports ${marketingOnly.map((c) => c.name).join(", ")}.`);
  else add("evidence", "Is there actual evidence on every side?", "warn", `${noFacts.map((c) => c.name).join(", ")} is supported only by inference, not a sourced fact.`);

  // 2. Marketing language.
  const hollow = draft.drivingNeeds.filter((d) => d.need.evidence.every((e) => e.marketingLanguage));
  add(
    "marketing",
    "Is this more than repeated marketing language?",
    hollow.length > 0 ? "fail" : "pass",
    hollow.length > 0
      ? `"${hollow[0].need.evidence[0]?.excerpt}" is positioning copy, not a stated need.`
      : "Driving needs come from conversations, deal notes or policies, not positioning copy.",
  );

  // 3. Specificity.
  const vague = draft.drivingNeeds.filter((d) => d.need.tags.length === 0 || d.need.evidence.every((e) => e.marketingLanguage));
  add(
    "specificity",
    "Is the opportunity specific?",
    vague.length > 0 ? "fail" : "pass",
    vague.length > 0 ? "The need behind it is too general to act on." : `Names a concrete structure: ${draft.types.join(", ")}.`,
  );

  // 4. Bilateral value.
  const withNeed = new Set(draft.drivingNeeds.map((d) => d.companyId));
  const lacking = companies.filter((c) => !withNeed.has(c.id));
  if (draft.kind === "customer") {
    const buyerNeed = draft.drivingNeeds[0]?.need;
    add(
      "bilateral",
      "Does each side get concrete value?",
      buyerNeed && isUrgent(buyerNeed) ? "pass" : "warn",
      buyerNeed && isUrgent(buyerNeed)
        ? "Buyer has an active need; seller gains a customer."
        : "Seller's value depends on the buyer funding an exploratory need.",
    );
  } else {
    add(
      "bilateral",
      "Does each side get concrete value?",
      lacking.length === 0 ? "pass" : "fail",
      lacking.length === 0
        ? "Every participant has a stated need the others satisfy."
        : `No stated need of ${lacking.map((c) => c.name).join(", ")} is met — one-sided.`,
    );
  }

  // 5. Structure.
  const structured = draft.structure.length > 40 && draft.contributions.every((c) => c.items.length > 0);
  add("structure", "Is there a clear business structure?", structured ? "pass" : "fail", structured ? "Roles and commercial mechanics are defined." : "Contributions are undefined.");

  // 6. Timing.
  const now = Date.parse(world.now);
  const signalled = new Set(recentSignals(world, draft.companyIds).map((s) => s.companyId));
  const idle = companies.filter((c) => {
    const needs = draft.drivingNeeds.filter((d) => d.companyId === c.id);
    return needs.length > 0 && !needs.some((d) => isUrgent(d.need)) && !signalled.has(c.id);
  });
  const stale = draft.drivingNeeds.filter((d) => now - Date.parse(d.need.observedAt) > YEAR_MS);
  if (idle.length === 0 && stale.length === 0) {
    add("timing", "Is timing relevant?", "pass", signalled.size > 0 ? "Corroborated by a recent public signal." : "Needs on each side are active now.");
  } else {
    const notes = [
      ...idle.map((c) => `${c.name}'s need is still exploratory`),
      ...stale.map((d) => `${name(d.companyId)}'s need was last confirmed over a year ago`),
    ];
    add("timing", "Is timing relevant?", "warn", `${uniq(notes).join("; ")}.`);
    for (const c of idle) {
      const needs = draft.drivingNeeds.filter((d) => d.companyId === c.id);
      watch.push({
        id: `w-need-${c.id}-${draft.patternId}`,
        companyId: c.id,
        kind: "need-escalation",
        description: `${c.name} makes ${lowerFirst(needs[0].need.label)} a priority`,
        tags: uniq(needs.flatMap((d) => d.need.tags)),
      });
    }
  }

  // 7. Counterparty requirements.
  const gaps = constraintGaps(draft, world);
  add(
    "constraints",
    "Does each side meet the other's stated requirements?",
    gaps.length === 0 ? "pass" : "fail",
    gaps.length === 0 ? "No stated requirement is violated." : gaps.map((g) => `${g.owner.name}: “${g.label}.” ${g.counterparty.name} does not meet this yet.`).join(" "),
  );
  for (const g of gaps) {
    watch.push({
      id: `w-cap-${g.counterparty.id}-${g.tags.join("-")}`,
      companyId: g.counterparty.id,
      kind: "capability",
      description: `${g.counterparty.name} establishes ${g.tags.map((t) => tagLabel(t)).join(" / ")}`,
      tags: g.tags,
    });
  }

  // 8. Assumptions vs facts.
  const facts = draft.evidence.filter((e) => e.epistemic === "fact" && !e.marketingLanguage).length;
  const inferences = draft.evidence.filter((e) => e.epistemic === "inference").length;
  const assumptions = draft.assumptions.length;
  add(
    "assumptions",
    "Are critical assumptions supported?",
    assumptions > facts ? "warn" : "pass",
    assumptions > facts ? `${assumptions} assumptions rest on ${facts} sourced facts.` : `${assumptions} open assumptions, each flagged for the first meeting.`,
  );

  // 9. Next step.
  add("next-step", "Is there a meaningful next step?", draft.nextStep ? "pass" : "fail", draft.nextStep || "None.");

  const fails = checks.filter((c) => c.result === "fail");
  const warns = checks.filter((c) => c.result === "warn");
  let verdict: CriticVerdict;
  if (fails.some((c) => FATAL.has(c.id)) || fails.length >= 2) verdict = "reject";
  else if (fails.length === 1 || warns.length >= 2) verdict = "weak";
  else verdict = "pass";

  const summary =
    verdict === "pass"
      ? warns.length === 0
        ? "Survived every check."
        : `Survived with one caution: ${warns[0].note}`
      : verdict === "weak"
        ? `Not strong enough yet. ${[...fails, ...warns].map((c) => c.note).join(" ")}`
        : `Rejected. ${fails.map((c) => c.note).join(" ")}`;

  const timingCorroborated = draft.drivingNeeds.some((d) => d.need.intensity === "critical");
  const level: ConfidenceAssessment["level"] =
    verdict !== "pass" ? "limited" : warns.length === 0 && facts >= 5 && timingCorroborated ? "strong" : "moderate";
  const rationale =
    level === "strong"
      ? "Grounded in sourced facts on every side, and at least one participant has a critical, dated need."
      : level === "moderate"
        ? "Grounded in sourced facts on every side; no participant has a critical need yet."
        : "Evidence or timing is insufficient to recommend action.";

  return {
    report: { verdict, checks, summary },
    confidence: { level, rationale, facts, inferences, assumptions },
    watchConditions: verdict === "pass" ? [] : watch,
  };
}
