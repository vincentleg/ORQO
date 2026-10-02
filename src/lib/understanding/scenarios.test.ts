/**
 * Phase 15 — Partnership Scenario Engine, Deal Critic, Revenue Hypotheses and
 * the company dossier. Pure: fictional fixtures, no network, no database,
 * no provider.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { understandCompany } from ".";
import { companyDossier } from "./dossier";
import { BIOTECH, CONSULTANCY, ECOM_BRAND, fixtureProfile, HARDWARE_CO, HAULIER, LOGISTICS, MANUFACTURER, NICHE, PHARMA, SAAS, SAAS_PARTNER } from "./fixtures";
import { PAIR_MECHANISMS } from "./pairs";
import { generateScenarios, type Party } from "./scenarios";
import type { Validation } from "./types";

type Fx = ReturnType<typeof fixtureProfile>;
const party = (fx: Fx, validations: Validation[] = []): Party => ({ name: fx.profile.name, understanding: understandCompany({ companyName: fx.profile.name, website: fx.profile.website, intelligence: fx, validations }) });
const run = (a: Fx, b: Fx) => generateScenarios(party(a), party(b));
const mechs = (a: Fx, b: Fx) => run(a, b).scenarios.map((s) => `${s.mechanism}:${s.provider}`);

describe("Partnership scenarios adapt to the business, through the same engine", () => {
  test("manufacturing × hardware product company → contract production by the manufacturer", () => {
    const m = mechs(MANUFACTURER, HARDWARE_CO);
    expect(m).toContain("contract_production:own");
    expect(m.some((x) => x.startsWith("technical_integration") || x.startsWith("implementation_partnership") || x.startsWith("licensing"))).toBe(false);
    const s = run(MANUFACTURER, HARDWARE_CO).scenarios.find((x) => x.mechanism === "contract_production")!;
    expect(s.questions[0]).toBe("production_model");
    expect(s.whyNow.map((w) => w.signal)).toContain("product_launch");
  });

  test("SaaS × SaaS → integration, never production, fulfilment or licensing", () => {
    const m = mechs(SAAS, SAAS_PARTNER);
    expect(m).toContain("technical_integration:own");
    for (const bad of ["contract_production", "fulfilment_partnership", "licensing", "embedding", "resale_channel"]) expect(m.some((x) => x.startsWith(bad))).toBe(false);
    const s = run(SAAS, SAAS_PARTNER).scenarios.find((x) => x.mechanism === "technical_integration")!;
    expect(s.needShown).toBe(true);
    expect(s.state).toBe("inference");
  });

  test("consultancy × SaaS → implementation or referral, never product distribution", () => {
    const m = mechs(CONSULTANCY, SAAS);
    expect(m.some((x) => x === "implementation_partnership:own" || x === "referral:own")).toBe(true);
    for (const bad of ["resale_channel", "regional_route", "contract_production", "fulfilment_partnership"]) expect(m.some((x) => x.startsWith(bad))).toBe(false);
  });

  test("biotech × pharma → licensing with the regulatory constraint stated, no resale", () => {
    const r = run(BIOTECH, PHARMA);
    const lic = r.scenarios.find((x) => x.mechanism === "licensing" && x.provider === "own")!;
    expect(lic).toBeDefined();
    expect(lic.critic.map((f) => f.code)).toContain("regulatory");
    expect(lic.revenue.structure).toBe("licence_royalty");
    expect(r.scenarios.some((x) => x.mechanism === "resale_channel")).toBe(false);
  });

  test("logistics × consumer brand → fulfilment by the logistics company", () => {
    const s = run(LOGISTICS, ECOM_BRAND).scenarios.find((x) => x.mechanism === "fulfilment_partnership")!;
    expect(s.provider).toBe("own");
    expect(s.needShown).toBe(true);
  });

  test("insufficient evidence → zero scenarios, and the dossier says what to learn", () => {
    expect(run(NICHE, SAAS).scenarios).toEqual([]);
    expect(run(SAAS, NICHE).scenarios).toEqual([]);
    expect(companyDossier(party(NICHE), party(SAAS))).toMatchObject({ status: "own_missing", scenarios: [], next: { kind: "read_own_company" } });
    const d = companyDossier(party(SAAS), party(NICHE));
    expect(d.status).toBe("target_insufficient");
    expect(d.next).toMatchObject({ kind: "learn_target" });
  });

  test("same sector, nothing complementary → no business, only a 'similarity only' note", () => {
    const r = run(LOGISTICS, HAULIER);
    expect(r.scenarios).toEqual([]);
    expect(r.discarded.map((d) => d.mechanism)).toEqual(["similarity_only"]);
    expect(companyDossier(party(LOGISTICS), party(HAULIER)).next).toMatchObject({ kind: "no_business_now" });
  });
});

describe("Deal Critic", () => {
  test("rejects a scenario when the partner is known to do it already", () => {
    const confirm: Validation = { kind: "confirm", facet: "value_chain_role", itemKey: "value_chain_role:manufacturer", value: "", createdAt: "2026-10-01T00:00:00.000Z" };
    const ownMaker = fixtureProfile("Own Maker", "own-maker.example", [["summary", "We manufacture rugged servers in our own factory for industrial businesses."]]);
    const r = generateScenarios(party(ownMaker, [confirm]), party(MANUFACTURER));
    expect(r.scenarios.some((s) => s.mechanism === "contract_production" && s.provider === "target")).toBe(false);
    const d = r.discarded.find((x) => x.mechanism === "contract_production" && x.provider === "target")!;
    expect(d.findings.find((f) => f.code === "already_does")?.severity).toBe("kill");
  });

  test("findings are triggered by evidence or its absence, never added for balance", () => {
    const s = run(SAAS, SAAS_PARTNER).scenarios.find((x) => x.mechanism === "technical_integration")!;
    const codes = s.critic.map((f) => f.code);
    expect(codes).not.toContain("need_not_shown"); // the partner shows integrations
    expect(codes).not.toContain("regulatory"); // nobody is regulated
    expect(codes).not.toContain("already_does");
    const weak = run(MANUFACTURER, HARDWARE_CO).scenarios.find((x) => x.mechanism === "contract_production")!;
    expect(weak.critic.find((f) => f.code === "need_not_shown")).toBeUndefined(); // dated launch evidence on the partner side
  });

  test("an inferred 'already does it' weakens instead of killing", () => {
    const r = run(MANUFACTURER, MANUFACTURER);
    const s = r.scenarios.find((x) => x.mechanism === "contract_production");
    if (s) expect(s.critic.find((f) => f.code === "already_does")?.severity).toBe("major");
  });
});

describe("New business hypotheses and revenue hypotheses", () => {
  test("a new offering is always an ORQO-generated hypothesis", () => {
    for (const [a, b] of [[MANUFACTURER, SAAS], [SAAS, CONSULTANCY], [HARDWARE_CO, SAAS_PARTNER], [CONSULTANCY, HARDWARE_CO]] as [Fx, Fx][]) {
      for (const s of run(a, b).scenarios.filter((x) => x.novelty === "new_offering")) expect(s.state).toBe("hypothesis");
    }
    expect(PAIR_MECHANISMS.filter((m) => m.novelty === "new_offering").length).toBeGreaterThan(0);
  });

  test("revenue hypotheses name who pays, for what and how — never an amount, price, size or probability", () => {
    for (const [a, b] of [[MANUFACTURER, HARDWARE_CO], [SAAS, SAAS_PARTNER], [BIOTECH, PHARMA], [LOGISTICS, ECOM_BRAND], [CONSULTANCY, SAAS]] as [Fx, Fx][]) {
      for (const s of run(a, b).scenarios) {
        expect(s.revenue).toMatchObject({ stage: "hypothesis", outcome: null });
        expect(s.revenue.payer).toBeTruthy();
        expect(JSON.stringify({ ...s.revenue, evidence: [] })).not.toMatch(/\d|%|\$|€/);
      }
    }
  });
});

describe("Company dossier", () => {
  test("personalized: the lead scenario, why it matters, the decisive question and the next investigation", () => {
    const d = companyDossier(party(MANUFACTURER), party(HARDWARE_CO));
    expect(d.status).toBe("ready");
    expect(d.executive.lead?.mechanism).toBe("contract_production");
    expect(d.nextQuestion?.key).toBe("production_model");
    expect(d.next.kind === "ask" || d.next.kind === "verify").toBe(true);
    expect(d.whyNow.length).toBeGreaterThan(0);
    expect(d.needs[0]).toMatchObject({ mechanism: "contract_production" });
    expect(d.scenarios.length).toBeLessThanOrEqual(3);
  });

  test("every scenario's evidence traces back to Business DNA items of the right side", () => {
    const own = party(SAAS);
    const target = party(SAAS_PARTNER);
    for (const s of generateScenarios(own, target).scenarios)
      for (const c of [s.contributions.provider, s.contributions.partner]) {
        const dna = (c.side === "own" ? own : target).understanding.dna;
        for (const x of c.support) expect(dna.items.some((i) => i.key === x.key && i.state !== "hypothesis")).toBe(true);
      }
  });

  test("the user's typed profile counts as stated facts for the own side", () => {
    const own: Party = { name: "Typed Co", understanding: understandCompany({ companyName: "Typed Co", website: null, intelligence: null, validations: [], profile: { summary: "We manufacture electronic assemblies for industrial businesses.", offerings: ["Contract manufacturing"], customerSegments: ["Industrial businesses"], markets: [], geographies: ["France"] } }) };
    expect(own.understanding.dna.items.find((i) => i.facet === "offerings")).toMatchObject({ state: "fact", origin: "user" });
    expect(own.understanding.dna.traits).toContain("role:manufacturer");
    expect(generateScenarios(own, party(HARDWARE_CO)).scenarios.map((s) => s.mechanism)).toContain("contract_production");
  });
});

describe("Static guards", () => {
  test("generic opportunity logic holds no vertical or company assumption", () => {
    for (const f of ["scenarios.ts", "dossier.ts"]) {
      const code = readFileSync(join(import.meta.dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/hardware|\boem\b|manufactur|saas|distributor|europe|infodip|gigaio|biotech|pharma|gpu|appliance/i);
      expect(code).not.toMatch(/\bfetch\(|process\.env|openrouter|brave|@\/lib\/server/i);
    }
  });
});

describe("Search relevance: physical-product rules are a trait-gated specialization", () => {
  test("a hardware integrator keeps its build mechanism; a software company never gets it", async () => {
    const { analyzeRelevance } = await import("@/lib/intelligence/relevance");
    const { matchConcepts } = await import("@/lib/intelligence/concepts");
    const { OWN_HARDWARE_INTEGRATOR } = await import("@/lib/intelligence/fixtures");
    const target = { ...HARDWARE_CO.profile, claims: HARDWARE_CO.profile.claims.map((c) => ({ ...c, excerpt: c.statement, concepts: matchConcepts(c.statement) })) };
    const tTraits = new Set(party(HARDWARE_CO).understanding.dna.traits);
    const integrator = new Set(["offering_form:physical_product", "role:manufacturer", "role:integrator"]);
    const software = new Set(["offering_form:software", "customer_scope:business"]);
    const rules = (traits?: { own: Set<string>; target: Set<string> }) => { const a = analyzeRelevance(OWN_HARDWARE_INTEGRATOR, target, [], traits); return [...a.opportunities, ...a.hypotheses, ...a.observations, ...a.rejected].map((c) => c.rule); };
    expect(rules()).toContain("build_for"); // legacy behaviour without traits is unchanged
    expect(rules({ own: integrator, target: tTraits })).toContain("build_for");
    expect(rules({ own: software, target: tTraits })).not.toContain("build_for");
    expect(rules({ own: integrator, target: new Set(["offering_form:software"]) })).not.toContain("build_for");
  });
});

describe("The report never researches", () => {
  test("the report route and the dossier import no research executor, provider or writer", () => {
    const root = join(import.meta.dir, "../../..");
    for (const f of ["src/app/workspace/report/page.tsx", "src/components/orqo/dossier.tsx", "src/lib/understanding/dossier.ts"]) {
      const code = readFileSync(join(root, f), "utf8");
      expect(code).not.toMatch(/research\/(execute|service|brave|providers|fetcher)|server\/ai|openrouter|saveIntelligence|startResearchRun|\.insert\(|\.update\(|\.delete\(|fetch\(/);
    }
  });
});
