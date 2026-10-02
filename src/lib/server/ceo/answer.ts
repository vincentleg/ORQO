/**
 * ORQO CEO, server side (Phase 16B): turns a business request into a typed intent and answers it with
 * capabilities that already exist. It renders product objects, never free prose.
 *
 * Boundaries:
 * - read-only: it researches nothing, fetches nothing, calls no provider or model, writes nothing, and starts
 *   no agent;
 * - organization-scoped: companies are resolved only among this organization's stored records (RLS). A
 *   company id in the URL is a lookup key, checked against that memory;
 * - honest: future capabilities are named, never executed. Prospect discovery only opens Discover with the
 *   objective, where the user starts it under the existing plan gate.
 */
import type { Db } from "@/lib/server/supabase/types";
import { CEO_INTENTS, matchCompanies, parseCeoRequest, toIntent, type CeoEntity, type CeoIntent, type CeoIntentType, type FutureCapability } from "@/lib/ceo/intent";
import { trackableScenario, type Dossier } from "@/lib/understanding/dossier";
import type { Scenario } from "@/lib/understanding/scenarios";
import { findIntelligence } from "../research/repository";
import type { TrackedOpportunity } from "../repositories/tracked-opportunities";
import { getCompanyDossier, getDossier } from "../repositories/understanding";
import { loadBriefing, type Briefing } from "./briefing";
import { loadWorkspaceMemory, type WorkspaceMemory } from "./memory";

export type CompanyFocus = "analyze" | "evaluate" | "missing" | "next" | "meeting";
export interface CeoCompany {
  id: string | null;
  name: string;
  domain: string | null;
}

export type CeoAnswer =
  | { kind: "company"; intent: CeoIntent; focus: CompanyFocus; company: CeoCompany; dossier: Dossier; tracked: TrackedOpportunity[] }
  | { kind: "not_researched"; intent: CeoIntent; company: CeoCompany }
  | { kind: "own_missing"; intent: CeoIntent }
  | { kind: "priorities"; intent: CeoIntent; briefing: Briefing }
  | { kind: "next_investigation"; intent: CeoIntent; briefing: Briefing }
  | { kind: "opportunity"; intent: CeoIntent; opportunity: TrackedOpportunity; scenario: Scenario; now: "same" | "changed" | "missing" }
  | { kind: "prospects"; intent: CeoIntent; href: string }
  | { kind: "future"; capability: FutureCapability | "compare_companies"; companies: string[] }
  | { kind: "clarify"; reason: "which_company" | "what_kind"; objective: string; options: ClarifyOption[] };

export interface ClarifyOption {
  as: CeoIntentType;
  companyId?: string;
  companyName?: string;
}

const FOCUS: Partial<Record<CeoIntentType, CompanyFocus>> = {
  analyze_company: "analyze",
  evaluate_partnership: "evaluate",
  identify_missing_information: "missing",
  recommend_next_investigation: "next",
  prepare_meeting: "meeting",
};

const isIntent = (x: unknown): x is CeoIntentType => typeof x === "string" && (CEO_INTENTS as readonly string[]).includes(x);

/** The companies a request is about, resolved only inside this organization's memory. */
export function resolveEntities(text: string, memory: WorkspaceMemory, companyHint: string | null, domains: string[], phrase: string | null): CeoEntity[] {
  const remembered = memory.companies.map((c) => c.company);
  // A company id from the URL counts only if it is one of this organization's remembered companies.
  const hinted = companyHint ? remembered.find((c) => c.id === companyHint) : undefined;
  const known = hinted ? [hinted] : matchCompanies(text, remembered.map((c) => ({ id: c.id, name: c.name, website: c.website })));
  const entities: CeoEntity[] = known.map((k) => {
    const c = remembered.find((x) => x.id === k.id)!;
    return { kind: "company", resolution: "known", companyId: c.id, name: c.name, domain: memory.companies.find((x) => x.company.id === c.id)?.domain ?? null };
  });
  if (entities.length) return entities;
  const researched = matchCompanies(text, memory.unremembered.map((r) => ({ id: r.domain, name: r.name, website: `https://${r.domain}` })));
  if (researched.length) return researched.map((r) => ({ kind: "company", resolution: "researched", companyId: null, name: r.name, domain: r.id }));
  if (domains.length) return [{ kind: "company", resolution: "unresolved", companyId: null, name: domains[0], domain: domains[0] }];
  return phrase ? [{ kind: "company", resolution: "unresolved", companyId: null, name: phrase, domain: null }] : [];
}

export async function answerCeo(db: Db, organizationId: string, raw: string, opts: { as?: unknown; company?: unknown } = {}): Promise<CeoAnswer> {
  const parsed = parseCeoRequest(raw);
  const companyHint = typeof opts.company === "string" ? opts.company : null;
  const memory = await loadWorkspaceMemory(db, organizationId);
  const entities = resolveEntities(parsed.objective, memory, companyHint, parsed.domains, parsed.phrase);
  const named = entities.filter((e) => e.resolution !== "unresolved").map((e) => e.name);

  // Outreach, monitoring, autonomous execution: recognized, never performed.
  if (parsed.future) return { kind: "future", capability: parsed.future, companies: named };

  let type: CeoIntentType | "unknown" = isIntent(opts.as) ? opts.as : parsed.type;
  if (type === "unknown") {
    if (entities.length) type = "analyze_company";
    else return { kind: "clarify", reason: "what_kind", objective: parsed.objective, options: [{ as: "show_priorities" }, { as: "recommend_next_investigation" }, { as: "find_prospects" }] };
  }
  const intent = toIntent(parsed, type, organizationId, entities);

  switch (type) {
    case "compare_companies":
      return { kind: "future", capability: "compare_companies", companies: named };
    case "find_prospects":
      return { kind: "prospects", intent, href: `/workspace/discover?objective=${encodeURIComponent(parsed.objective)}` };
    case "show_priorities":
      return { kind: "priorities", intent, briefing: await loadBriefing(db, organizationId) };
    case "explain_opportunity": {
      const companyIds = new Set(entities.flatMap((e) => (e.resolution === "known" ? [e.companyId] : [])));
      const candidates = memory.tracked.filter((o) => o.status !== "closed" && (companyIds.size === 0 || companyIds.has(o.targetCompanyId)));
      if (candidates.length === 1) {
        const o = candidates[0];
        const resolved = await getCompanyDossier(db, organizationId, o.targetCompanyId);
        const live = resolved?.dossier ? trackableScenario(resolved.dossier, o.scenarioKey) : null;
        return { kind: "opportunity", intent, opportunity: o, scenario: live ?? o.snapshot.scenario, now: live ? "same" : resolved?.dossier ? "changed" : "missing" };
      }
      if (candidates.length > 1 && companyIds.size === 0)
        return { kind: "clarify", reason: "which_company", objective: parsed.objective, options: [...new Map(candidates.map((o) => [o.targetCompanyId, o])).values()].slice(0, 3).map((o) => ({ as: "explain_opportunity", companyId: o.targetCompanyId, companyName: o.targetName })) };
      // Nothing tracked to explain: judge the named company, or show what deserves attention.
      if (entities.length) return companyAnswer(db, organizationId, memory, { ...intent, type: "evaluate_partnership" }, "evaluate", entities, parsed.objective);
      return { kind: "priorities", intent, briefing: await loadBriefing(db, organizationId) };
    }
    case "recommend_next_investigation":
      if (!entities.length) return { kind: "next_investigation", intent, briefing: await loadBriefing(db, organizationId) };
      return companyAnswer(db, organizationId, memory, intent, "next", entities, parsed.objective);
    default:
      return companyAnswer(db, organizationId, memory, intent, FOCUS[type] ?? "analyze", entities, parsed.objective);
  }
}

async function companyAnswer(db: Db, organizationId: string, memory: WorkspaceMemory, intent: CeoIntent, focus: CompanyFocus, entities: CeoEntity[], objective: string): Promise<CeoAnswer> {
  const known = entities.filter((e) => e.resolution === "known");
  // One clarification when the request could be about several remembered companies, or about none.
  if (known.length > 1) return { kind: "clarify", reason: "which_company", objective, options: known.slice(0, 3).map((e) => ({ as: intent.type, companyId: e.companyId!, companyName: e.name })) };
  const e = entities[0];
  if (!e)
    return memory.companies.length
      ? { kind: "clarify", reason: "which_company", objective, options: memory.companies.slice(0, 3).map((c) => ({ as: intent.type, companyId: c.company.id, companyName: c.company.name })) }
      : { kind: "not_researched", intent, company: { id: null, name: "", domain: null } };

  if (e.resolution === "known") {
    const resolved = await getCompanyDossier(db, organizationId, e.companyId);
    if (!resolved) return { kind: "not_researched", intent, company: { id: null, name: e.name, domain: e.domain } };
    if (!resolved.intel) return { kind: "not_researched", intent, company: { id: e.companyId, name: e.name, domain: e.domain } };
    if (!resolved.dossier) return { kind: "own_missing", intent };
    return { kind: "company", intent, focus, company: { id: e.companyId, name: resolved.dossier.targetName, domain: e.domain }, dossier: resolved.dossier, tracked: memory.tracked.filter((o) => o.targetCompanyId === e.companyId) };
  }
  if (e.resolution === "researched") {
    const intel = await findIntelligence(db, organizationId, { domain: e.domain });
    const dossier = intel ? await getDossier(db, organizationId, intel) : null;
    if (intel && !dossier) return { kind: "own_missing", intent };
    if (dossier) return { kind: "company", intent, focus, company: { id: null, name: dossier.targetName, domain: e.domain }, dossier, tracked: [] };
  }
  return { kind: "not_researched", intent, company: { id: null, name: e.name, domain: e.domain } };
}
