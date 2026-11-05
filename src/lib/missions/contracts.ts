/**
 * Mission contracts and templates (Phase 17B).
 *
 * A template turns a validated business input into a deterministic plan of record (the contract): the same
 * template, version and input always give the same steps. The contract is frozen in the database
 * (missions.contract, immutable) and re-derived by the executor before it runs anything, so a plan written
 * by any other path is refused.
 *
 * Phase 17B is FREE capabilities only: Research Basic (official website, stored analyses) and Prospecting
 * over stored/known candidates. No web search, no Deep Research, no paid provider: the child inputs are
 * restricted here, the child authority is built with a $0 envelope, and both are checked again at execution.
 */
import { z } from "zod";
import { MISSION_INPUTS, TargetRefSchema, type MissionInput } from "@/lib/agents/contracts";
import type { MissionType } from "@/lib/agents/types";
import type { AuthorityContract } from "@/lib/governance/authority";
import { TOOLS } from "@/lib/agents/tools";
import { DISCOVERY_INTENTS, DISCOVERY_LIMITS } from "@/lib/discovery/types";
import { MISSION_LIMITS, MISSION_TEMPLATES, type MissionTemplateId, type StepKind } from "./types";

/** Child runs of a mission run at Recommend autonomy: they may fetch official websites and propose a next action. */
export const MISSION_AUTONOMY = 1 as const;

/** The only envelope a 17B child run gets. */
export const FREE_ENVELOPE = { maxCostUsd: 0, maxProviderCalls: 0, maxChildRuns: 0, network: "official_sites" } as const;

// ---------------------------------------------------------------------------
// Template inputs (strict: no plan, budget, tool, source, depth or organization can be passed)
// ---------------------------------------------------------------------------

const PlainText = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f<>{}]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min).max(max));

const ProspectFields = {
  intent: z.enum(DISCOVERY_INTENTS).default("profile"),
  objective: PlainText(3, 200).optional(),
  geography: PlainText(2, 60).optional(),
  market: PlainText(2, 60).optional(),
  maxResults: z.number().int().min(1).max(DISCOVERY_LIMITS.maxResults).default(DISCOVERY_LIMITS.maxResults),
};

export const TEMPLATE_INPUTS = {
  research_company: z.strictObject({ target: TargetRefSchema }),
  prospect_known_candidates: z.strictObject(ProspectFields),
  prospect_and_research: z.strictObject({ ...ProspectFields, researchTop: z.number().int().min(1).max(MISSION_LIMITS.maxFanout).default(2) }),
} as const satisfies Record<MissionTemplateId, z.ZodType>;

export type TemplateInput<T extends MissionTemplateId> = z.infer<(typeof TEMPLATE_INPUTS)[T]>;

export const TEMPLATE_VERSIONS: Record<MissionTemplateId, number> = { research_company: 1, prospect_known_candidates: 1, prospect_and_research: 1 };

// ---------------------------------------------------------------------------
// Step specs
// ---------------------------------------------------------------------------

const StepKey = z.string().regex(/^[a-z0-9_]{1,40}$/);

export const ChildRunSpec = z.strictObject({ kind: z.literal("child_run"), missionType: z.enum(["analyze_company", "discover_companies"]), input: z.record(z.string(), z.unknown()) });
export const FanoutSpec = z.strictObject({ kind: z.literal("fanout"), from: StepKey, missionType: z.literal("analyze_company"), max: z.number().int().min(1).max(MISSION_LIMITS.maxFanout) });
export const CompileSpec = z.strictObject({ kind: z.literal("compile") });
export const StepSpecSchema = z.discriminatedUnion("kind", [ChildRunSpec, FanoutSpec, CompileSpec]);
export type ChildRunSpec = z.infer<typeof ChildRunSpec>;
export type FanoutSpec = z.infer<typeof FanoutSpec>;
export type StepSpec = z.infer<typeof StepSpecSchema>;

export interface PlannedStep {
  seq: number;
  key: string;
  kind: StepKind;
  required: boolean;
  maxAttempts: number;
  spec: StepSpec;
}

export const PlannedStepSchema = z.strictObject({ seq: z.number().int().min(1).max(1000), key: StepKey, kind: z.enum(["child_run", "fanout", "compile"]), required: z.boolean(), maxAttempts: z.number().int().min(1).max(3), spec: StepSpecSchema });

export interface MissionContract {
  version: 1;
  template: MissionTemplateId;
  templateVersion: number;
  autonomy: typeof MISSION_AUTONOMY;
  envelope: { maxCostUsd: 0; network: "official_sites"; paidProviders: false; webSearch: false; deepResearch: false };
  limits: { maxSteps: number; maxChildRuns: number };
  steps: PlannedStep[];
}

/**
 * The free-only restriction of a child input: Research Basic and Prospecting over workspace knowledge.
 * Returns the parsed input (defaults applied), or null for anything else (deep, web search, unknown fields).
 */
export function freeChildInput(missionType: MissionType, raw: unknown): MissionInput<"analyze_company"> | MissionInput<"discover_companies"> | null {
  if (missionType === "analyze_company") {
    const r = MISSION_INPUTS.analyze_company.safeParse(raw);
    return r.success && r.data.depth === "basic" && !r.data.refresh ? r.data : null;
  }
  if (missionType === "discover_companies") {
    const r = MISSION_INPUTS.discover_companies.safeParse(raw);
    return r.success && r.data.source === "workspace_knowledge" && !r.data.reevaluate ? r.data : null;
  }
  return null;
}

/** A research child for one company domain (used by the research template and by fan-out). */
export function researchChildSpec(target: z.infer<typeof TargetRefSchema>): ChildRunSpec {
  return { kind: "child_run", missionType: "analyze_company", input: { target, depth: "basic", refresh: false } };
}

function prospectChildSpec(input: TemplateInput<"prospect_known_candidates">): ChildRunSpec {
  const raw = { intent: input.intent, ...(input.objective ? { objective: input.objective } : {}), ...(input.geography ? { geography: input.geography } : {}), ...(input.market ? { market: input.market } : {}), source: "workspace_knowledge", maxResults: input.maxResults, reevaluate: false };
  return { kind: "child_run", missionType: "discover_companies", input: freeChildInput("discover_companies", raw) as Record<string, unknown> };
}

const COMPILE: PlannedStep = { seq: 0, key: "compile", kind: "compile", required: true, maxAttempts: 2, spec: { kind: "compile" } };
const at = (seq: number, s: PlannedStep): PlannedStep => ({ ...s, seq });

/** Templates leave seq gaps of 10: a fan-out at seq s plans its children at s+1 … s+max. */
function stepsOf<T extends MissionTemplateId>(template: T, input: TemplateInput<T>): PlannedStep[] {
  switch (template) {
    case "research_company": {
      const i = input as TemplateInput<"research_company">;
      return [{ seq: 10, key: "research", kind: "child_run", required: true, maxAttempts: 2, spec: researchChildSpec(i.target) }, at(20, COMPILE)];
    }
    case "prospect_known_candidates": {
      const i = input as TemplateInput<"prospect_known_candidates">;
      return [{ seq: 10, key: "prospect", kind: "child_run", required: true, maxAttempts: 2, spec: prospectChildSpec(i) }, at(20, COMPILE)];
    }
    case "prospect_and_research": {
      const i = input as TemplateInput<"prospect_and_research">;
      return [
        { seq: 10, key: "prospect", kind: "child_run", required: true, maxAttempts: 2, spec: prospectChildSpec(i) },
        { seq: 20, key: "research_top", kind: "fanout", required: true, maxAttempts: 2, spec: { kind: "fanout", from: "prospect", missionType: "analyze_company", max: i.researchTop } },
        at(30, COMPILE),
      ];
    }
  }
  return [];
}

function objectiveOf(template: MissionTemplateId, input: TemplateInput<MissionTemplateId>): string {
  // Built by the server from validated fields only.
  if ("target" in input) return `${template} · ${"query" in input.target ? input.target.query : `company:${input.target.companyId}`}`;
  return [template, input.intent, input.objective, input.market, input.geography].filter(Boolean).join(" · ");
}

export interface MissionPlan {
  template: MissionTemplateId;
  templateVersion: number;
  objective: string;
  input: Record<string, unknown>;
  contract: MissionContract;
  /** Agent mission types the plan may delegate to (authorized before the mission is created). */
  missionTypes: MissionType[];
}

/** Deterministic: the same template and raw input always produce the same plan. null: invalid input. */
export function planMission(template: string, raw: unknown): MissionPlan | null {
  if (!(MISSION_TEMPLATES as readonly string[]).includes(template)) return null;
  const t = template as MissionTemplateId;
  const parsed = TEMPLATE_INPUTS[t].safeParse(raw);
  if (!parsed.success) return null;
  const input = parsed.data as TemplateInput<MissionTemplateId>;
  const steps = stepsOf(t, input);
  const fanout = steps.reduce((n, s) => n + (s.spec.kind === "fanout" ? s.spec.max : 0), 0);
  const missionTypes = [...new Set(steps.flatMap((s) => (s.spec.kind === "child_run" || s.spec.kind === "fanout" ? [s.spec.missionType] : [])))];
  return {
    template: t,
    templateVersion: TEMPLATE_VERSIONS[t],
    objective: objectiveOf(t, input).slice(0, 300),
    input: input as Record<string, unknown>,
    contract: {
      version: 1,
      template: t,
      templateVersion: TEMPLATE_VERSIONS[t],
      autonomy: MISSION_AUTONOMY,
      envelope: { maxCostUsd: 0, network: "official_sites", paidProviders: false, webSearch: false, deepResearch: false },
      limits: { maxSteps: MISSION_LIMITS.maxSteps, maxChildRuns: steps.filter((s) => s.kind === "child_run").length + fanout },
      steps,
    },
    missionTypes,
  };
}

/** Key-order-independent JSON equality (stored jsonb vs a rebuild). */
export function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canon(x)])) : v);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** The stored contract is exactly what the server builds for the stored template, version and input. */
export function contractMatches(stored: { template: string; templateVersion: number; input: unknown; contract: unknown }): MissionPlan | null {
  const plan = planMission(stored.template, stored.input);
  if (!plan || plan.templateVersion !== stored.templateVersion || !sameJson(plan.input, stored.input) || !sameJson(plan.contract, stored.contract)) return null;
  return plan;
}

export interface StoredStep {
  seq: number;
  key: string;
  kind: string;
  required: boolean;
  maxAttempts: number;
  spec: unknown;
}

/**
 * Re-validates a step read from the database against the contract before it runs. A contract step must be
 * identical; any other step must be a fan-out child (optional Research Basic, inside its fan-out's seq gap).
 * Returns the parsed spec, or null (the step is refused, never executed).
 */
export function verifyStep(contract: MissionContract, step: StoredStep): StepSpec | null {
  const planned = contract.steps.find((s) => s.key === step.key);
  if (planned) {
    const same = planned.seq === step.seq && planned.kind === step.kind && planned.required === step.required && planned.maxAttempts === step.maxAttempts && sameJson(planned.spec, step.spec);
    return same ? planned.spec : null;
  }
  const spec = ChildRunSpec.safeParse(step.spec);
  if (!spec.success || step.kind !== "child_run" || step.required || spec.data.missionType !== "analyze_company") return null;
  const parent = contract.steps.find((s) => s.spec.kind === "fanout" && step.seq > s.seq && step.seq <= s.seq + s.spec.max);
  if (!parent || !freeChildInput("analyze_company", spec.data.input)) return null;
  return spec.data;
}

/** A child authority is free: no money, no provider, no public search, no variable-cost tool. */
export function isFreeAuthority(a: AuthorityContract): boolean {
  return a.limits.maxCostUsd === 0 && a.limits.maxProviderCalls === 0 && a.limits.maxChildRuns === 0 && a.providers.openrouter === null && !a.providers.brave && a.network !== "public_search" && a.tools.every((t) => !TOOLS[t].variableCost);
}
