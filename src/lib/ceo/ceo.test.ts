/**
 * Phase 16B: ORQO CEO. Pure tests only: no network, no database, no provider.
 * - business requests in English and French map to typed intents;
 * - future capabilities are recognized and never executed;
 * - companies resolve only among the organization's remembered memory;
 * - the briefing prioritizes credible opportunities only, and asks at most one question;
 * - the CEO modules can neither research, fetch, write nor call a provider.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composeBriefing } from "@/lib/server/ceo/briefing";
import type { CompanyAssessment, RememberedCompany, WorkspaceMemory } from "@/lib/server/ceo/memory";
import type { TrackedOpportunity } from "@/lib/server/repositories/tracked-opportunities";
import type { NetworkCompany } from "@/lib/server/repositories/network-memory";
import { understandCompany } from "@/lib/understanding";
import { companyDossier } from "@/lib/understanding/dossier";
import * as F from "@/lib/understanding/fixtures";
import { CEO_CAPABILITIES, CEO_INTENTS, matchCompanies, parseCeoRequest } from "./intent";
import { resolveEntities } from "@/lib/server/ceo/answer";

const ROOT = join(import.meta.dir, "../../..");

describe("Business requests → typed intents (EN + FR)", () => {
  test.each([
    ["What should I work on today?", "show_priorities"],
    ["Sur quoi dois-je travailler aujourd'hui ?", "show_priorities"],
    ["Which opportunities deserve my attention?", "show_priorities"],
    ["Quelles opportunités méritent mon attention ?", "show_priorities"],
    ["Analyze Acme.", "analyze_company"],
    ["Analyse Acme", "analyze_company"],
    ["Tell me about Acme", "analyze_company"],
    ["Is Acme actually interesting for us?", "evaluate_partnership"],
    ["What could we do with GigaIO?", "evaluate_partnership"],
    ["Que pourrions-nous faire avec GigaIO ?", "evaluate_partnership"],
    ["Est-ce qu'Acme est vraiment intéressante pour nous ?", "evaluate_partnership"],
    ["Find companies that could help us enter Germany.", "find_prospects"],
    ["Trouve des entreprises qui pourraient nous aider à entrer en Allemagne", "find_prospects"],
    ["What don't we know about this company?", "identify_missing_information"],
    ["Qu'est-ce qu'on ne sait pas sur Acme ?", "identify_missing_information"],
    ["Explain this opportunity.", "explain_opportunity"],
    ["Explique cette opportunité", "explain_opportunity"],
    ["What should I investigate next?", "recommend_next_investigation"],
    ["Quelle entreprise devrais-je étudier ensuite ?", "recommend_next_investigation"],
    ["Prepare me for my meeting with Acme.", "prepare_meeting"],
    ["Prépare-moi pour mon rendez-vous avec Acme", "prepare_meeting"],
    ["Compare Acme and Globex.", "compare_companies"],
    ["Compare Acme et Globex", "compare_companies"],
  ] as const)("%s → %s", (text, type) => {
    const p = parseCeoRequest(text);
    expect(p.type).toBe(type);
    expect(p.future).toBeNull();
  });

  test.each([
    ["Send an email to Acme", "outreach"],
    ["Écris un message à Acme sur LinkedIn", "outreach"],
    ["Monitor Acme and alert me", "monitoring"],
    ["Surveille Acme", "monitoring"],
    ["Research new prospects automatically every week", "autonomous_execution"],
  ] as const)("future capability, never executed: %s → %s", (text, future) => {
    expect(parseCeoRequest(text).future).toBe(future);
  });

  test("unclear requests are unknown, never guessed into an action; constraints come from the existing vocabulary", () => {
    expect(parseCeoRequest("hello").type).toBe("unknown");
    expect(parseCeoRequest("Find companies that could help us enter Germany.").constraints.geographies).toContain("germany");
    expect(parseCeoRequest("x".repeat(2000)).objective.length).toBe(500);
  });

  test("the contract: every intent has a capability and an honest support level", () => {
    for (const i of CEO_INTENTS) expect(CEO_CAPABILITIES[i]).toBeDefined();
    expect(CEO_CAPABILITIES.compare_companies.support).toBe("future");
    expect(CEO_CAPABILITIES.prepare_meeting.support).toBe("partial");
    expect(CEO_CAPABILITIES.find_prospects.support).toBe("partial");
    for (const i of ["analyze_company", "evaluate_partnership", "explain_opportunity", "identify_missing_information", "recommend_next_investigation", "show_priorities"] as const) expect(CEO_CAPABILITIES[i].support).toBe("executable");
  });
});

// ---------------------------------------------------------------------------

const nc = (id: string, name: string, website: string | null): NetworkCompany => ({ id, name, website, summary: "", markets: [], geographies: [], isOwnCompany: false, externalRef: null, stage: null, origin: null, originRecorded: false, reason: "", originEventId: null, addedAt: "2026-10-01T00:00:00.000Z" });
const rc = (c: NetworkCompany, over: Partial<RememberedCompany> = {}): RememberedCompany => ({ company: c, domain: c.website ? c.website.replace(/^https?:\/\/(www\.)?/, "") : null, research: c.website ? { domain: c.website.replace(/^https?:\/\/(www\.)?/, ""), name: c.name, researchedAt: "2026-10-01T10:00:00.000Z" } : null, statedRelationship: null, tracked: [], lastActivity: "2026-10-01T10:00:00.000Z", ...over });

describe("Entity resolution stays inside the organization", () => {
  const kestrel = nc("00000000-0000-4000-8000-0000000000a1", "Kestrel Compute", "https://kestrel.example");
  const storage = nc("00000000-0000-4000-8000-0000000000a2", "Kestrel Storage", "https://kestrel-storage.example");
  const memory: WorkspaceMemory = { companies: [rc(kestrel), rc(storage)], unremembered: [{ domain: "nimbusfield.example", name: "Nimbusfield Cloud", researchedAt: "2026-10-01T00:00:00.000Z" }], tracked: [] };

  test("names, domains and researched-but-unremembered companies", () => {
    expect(resolveEntities("What could we do with Kestrel Compute?", memory, null, [], null)[0]).toMatchObject({ resolution: "known", companyId: kestrel.id });
    expect(resolveEntities("Is kestrel-storage.example interesting?", memory, null, ["kestrel-storage.example"], null)[0]).toMatchObject({ resolution: "known", companyId: storage.id });
    expect(resolveEntities("Analyze Nimbusfield", memory, null, [], "nimbusfield")[0]).toMatchObject({ resolution: "researched", domain: "nimbusfield.example" });
    expect(resolveEntities("Analyze Globex", memory, null, [], "globex")[0]).toMatchObject({ resolution: "unresolved", companyId: null, name: "globex" });
  });

  test("the full name wins over a shared first word", () => {
    expect(resolveEntities("What could we do with Kestrel Compute?", memory, null, [], null).map((e) => e.companyId)).toEqual([kestrel.id]);
  });

  test("an ambiguous first name returns every candidate, so the CEO asks one question", () => {
    expect(resolveEntities("Analyze Kestrel", memory, null, [], "kestrel").map((e) => e.companyId).sort()).toEqual([kestrel.id, storage.id].sort());
  });

  test("a company id from the URL counts only if this organization remembers it", () => {
    expect(resolveEntities("Analyze it", memory, storage.id, [], null)[0]).toMatchObject({ companyId: storage.id });
    const foreign = "00000000-0000-4000-8000-0000000000ff";
    expect(resolveEntities("Analyze it", memory, foreign, [], null).some((e) => e.companyId === foreign)).toBe(false);
  });

  test("matching is on word boundaries: a short name never matches inside another word", () => {
    expect(matchCompanies("we sell to the io industry", [{ id: "1", name: "Io", website: null }])).toEqual([]);
    expect(matchCompanies("analyze acmeworks", [{ id: "1", name: "Acme", website: null }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

type Fx = ReturnType<typeof F.fixtureProfile>;
const party = (fx: Fx) => ({ name: fx.profile.name, understanding: understandCompany({ companyName: fx.profile.name, website: fx.profile.website, intelligence: fx, validations: [] }) });

describe("The CEO Briefing prioritizes credible opportunities only", () => {
  const pos = nc("00000000-0000-4000-8000-0000000000b1", "Kestrel Compute", "https://kestrel.example");
  const neg = nc("00000000-0000-4000-8000-0000000000b2", "Kestrel Storage", "https://kestrel-storage.example");
  const posDossier = companyDossier(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER_OUTSOURCING));
  const negDossier = companyDossier(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER));
  const assessments = (): CompanyAssessment[] => [
    { remembered: rc(pos), dossier: posDossier },
    { remembered: rc(neg), dossier: negDossier },
  ];
  const memory = (tracked: TrackedOpportunity[] = []): WorkspaceMemory => ({ companies: [rc(pos), rc(neg)], unremembered: [], tracked });

  test("a credible lead is prioritized; a no-opportunity company and weak ideas never are", () => {
    expect(negDossier.verdict).toBe("no_credible_opportunity");
    const b = composeBriefing({ ownName: "Arvenor Systems", ownQuestion: null, memory: memory(), assessments: assessments() });
    expect(b.top.map((x) => (x.kind === "lead" ? x.companyId : x.opportunity.targetCompanyId))).toEqual([pos.id]);
    for (const x of b.top) if (x.kind === "lead") expect(x.scenario.verdict).toBe("credible");
    expect(b.noOpportunity).toBe(1);
  });

  test("a tracked opportunity is listed while still credible, and drops out when the assessment changes", () => {
    const s = posDossier.scenarios[0];
    const tracked: TrackedOpportunity = { id: "00000000-0000-4000-8000-0000000000c1", targetCompanyId: pos.id, targetName: pos.name, scenarioKey: s.key, mechanism: s.mechanism, status: "investigating", snapshot: { v: 1, ownName: "Arvenor Systems", targetName: pos.name, asOf: null, scenario: s, relationship: { status: "unknown", roles: [], links: [] } }, statusChangedAt: "", createdAt: "", updatedAt: "2026-10-02T00:00:00.000Z" };
    const b = composeBriefing({ ownName: "Arvenor Systems", ownQuestion: null, memory: memory([tracked]), assessments: assessments() });
    expect(b.top).toHaveLength(1);
    expect(b.top[0]).toMatchObject({ kind: "tracked" });
    // The same tracked key on the negative company (assessment no longer credible) is not a priority.
    const stale = { ...tracked, id: "00000000-0000-4000-8000-0000000000c2", targetCompanyId: neg.id, targetName: neg.name };
    const b2 = composeBriefing({ ownName: "Arvenor Systems", ownQuestion: null, memory: memory([stale]), assessments: assessments() });
    expect(b2.top.some((x) => x.kind === "tracked")).toBe(false);
    // Closed or paused opportunities are memory, not priorities.
    const b3 = composeBriefing({ ownName: "Arvenor Systems", ownQuestion: null, memory: memory([{ ...tracked, status: "paused" }]), assessments: assessments() });
    expect(b3.top.every((x) => x.kind === "lead")).toBe(true);
  });

  test("one question at most: the relationship of the leading company, else the own company's, else set up your company", () => {
    const b = composeBriefing({ ownName: "Arvenor Systems", ownQuestion: null, memory: memory(), assessments: assessments() });
    expect(b.question).toMatchObject({ kind: "relationship", companyId: pos.id });
    const own = { dimension: "customer_scope" as const, options: ["business"], unlocks: 3 };
    const answered = companyDossier(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER_OUTSOURCING), { validations: [{ kind: "answer", facet: "relationship_role", itemKey: null, value: "supplier", createdAt: "2026-10-02T00:00:00.000Z" }], networkStage: null });
    const b2 = composeBriefing({ ownName: "Arvenor Systems", ownQuestion: own, memory: memory(), assessments: [{ remembered: rc(pos), dossier: answered }] });
    expect(b2.question).toEqual({ kind: "own", question: own });
    expect(composeBriefing({ ownName: null, ownQuestion: null, memory: memory(), assessments: [] }).question).toEqual({ kind: "own_missing" });
  });

  test("zero credible opportunities is a calm, valid briefing", () => {
    const b = composeBriefing({ ownName: "Arvenor Systems", ownQuestion: null, memory: memory(), assessments: [{ remembered: rc(neg), dossier: negDossier }] });
    expect(b.top).toEqual([]);
    expect(b.continue.length).toBeGreaterThan(0);
  });
});

describe("Static guards: the CEO and Work can neither research, fetch, write nor call a provider", () => {
  test.each(["src/lib/ceo/intent.ts", "src/lib/server/ceo/answer.ts", "src/lib/server/ceo/briefing.ts", "src/lib/server/ceo/memory.ts", "src/app/workspace/page.tsx", "src/components/orqo/ceo.tsx"])("%s", (f) => {
    const code = readFileSync(join(ROOT, f), "utf8");
    expect(code).not.toMatch(/research\/(execute|service|brave|providers|fetcher)|server\/ai|openrouter|saveIntelligence|startResearchRun|runAgent|startRun|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\bfetch\(|process\.env/);
  });

  test("the CEO holds no company, industry or acceptance-case assumption", () => {
    for (const f of ["src/lib/ceo/intent.ts", "src/lib/server/ceo/answer.ts", "src/lib/server/ceo/briefing.ts"]) {
      const code = readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/dell|infodip|gigaio|hardware|appliance|saas|manufactur|biotech|pharma|logistic|\bapi\b/i);
    }
  });
});
