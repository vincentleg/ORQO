/**
 * Phase 16A: opportunity precision. Existing relationship ≠ new opportunity; zero
 * opportunities is a successful result. Pure: fictional fixtures, no network,
 * no database, no provider. The same rules hold in five domains.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { understandCompany } from ".";
import { companyDossier, trackableScenario, type Dossier } from "./dossier";
import * as F from "./fixtures";
import { assessRelationship, RELATIONSHIP_FACET } from "./relationship";
import { generateScenarios, type Party } from "./scenarios";
import { NOT_SURE, type Validation } from "./types";

type Fx = ReturnType<typeof F.fixtureProfile>;
const party = (fx: Fx, validations: Validation[] = []): Party => ({ name: fx.profile.name, understanding: understandCompany({ companyName: fx.profile.name, website: fx.profile.website, intelligence: fx, validations }) });
const said = (value: string, createdAt = "2026-10-02T00:00:00.000Z"): Validation => ({ kind: "answer", facet: RELATIONSHIP_FACET, itemKey: null, value, createdAt });
const dossier = (a: Fx, b: Fx, answer?: string, networkStage: string | null = null): Dossier => companyDossier(party(a), party(b), { validations: answer ? [said(answer)] : [], networkStage });
const keys = (d: Dossier) => [...d.scenarios, ...d.novel].map((s) => s.key);
const codes = (d: Dossier, key: string) => [...d.considered, ...d.scenarios, ...d.novel].find((s) => s.key === key)?.critic.map((f) => f.code) ?? d.discarded.find((x) => `${x.mechanism}:${x.provider}` === key)?.findings.map((f) => f.code) ?? [];

/** Every pair of fixtures the suite knows: the general properties must hold on all of them. */
const ALL: Fx[] = [F.MANUFACTURER, F.SAAS, F.CONSULTANCY, F.BIOTECH, F.LOGISTICS, F.NICHE, F.HARDWARE_CO, F.SAAS_PARTNER, F.PHARMA, F.ECOM_BRAND, F.HAULIER, F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER, F.SERVER_MAKER_OUTSOURCING, F.SAAS_ON_CLOUD, F.CLOUD_PROVIDER, F.IMPLEMENTER, F.IMPLEMENTED_VENDOR, F.REAGENT_BUYER, F.REAGENT_SUPPLIER, F.DTC_BRAND, F.BRAND_LOGISTICS];
const PAIRS = ALL.flatMap((a) => ALL.filter((b) => b !== a && b.profile.domain !== a.profile.domain).map((b) => [a, b] as const));

describe("Relationship assessment", () => {
  test("reads the existing relationship from the sentence that names the other company", () => {
    expect(assessRelationship(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER)).roles).toEqual(["supplier"]); // "built on Kestrel servers"
    expect(assessRelationship(party(F.SAAS_ON_CLOUD), party(F.CLOUD_PROVIDER)).roles).toEqual(["supplier"]); // "runs on Nimbusfield"
    expect(assessRelationship(party(F.REAGENT_BUYER), party(F.REAGENT_SUPPLIER)).roles).toEqual(["supplier"]); // "use Vestry reagents"
    expect(assessRelationship(party(F.DTC_BRAND), party(F.BRAND_LOGISTICS)).roles).toEqual(["partner"]); // "our logistics partner"
    // Read from the other side: the target says it builds on the user's company, so the target is a customer.
    expect(assessRelationship(party(F.SERVER_MAKER), party(F.APPLIANCE_INTEGRATOR)).roles).toEqual(["customer"]);
    const r = assessRelationship(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER));
    expect(r.links[0]).toMatchObject({ state: "inference", source: "own_evidence" });
    expect(r.links[0].basis.length).toBe(1);
  });

  test("nothing named → unknown; the user's answer is authoritative and replaces what was read", () => {
    expect(assessRelationship(party(F.MANUFACTURER), party(F.HARDWARE_CO)).status).toBe("unknown");
    const stated = assessRelationship(party(F.DTC_BRAND), party(F.BRAND_LOGISTICS), { validations: [said("supplier")], networkStage: null });
    expect(stated.links).toEqual([expect.objectContaining({ role: "supplier", state: "fact", source: "user" })]);
    expect(assessRelationship(party(F.DTC_BRAND), party(F.BRAND_LOGISTICS), { validations: [said("none")], networkStage: null })).toMatchObject({ status: "none", links: [], answered: true });
    // The latest answer wins (append-only validations).
    const latest = assessRelationship(party(F.MANUFACTURER), party(F.HARDWARE_CO), { validations: [said("customer", "2026-10-01T00:00:00.000Z"), said("partner", "2026-10-02T00:00:00.000Z")], networkStage: null });
    expect(latest.roles).toEqual(["partner"]);
    // "Not sure" keeps what ORQO read, and still counts as answered.
    const unsure = assessRelationship(party(F.APPLIANCE_INTEGRATOR), party(F.SERVER_MAKER), { validations: [said(NOT_SURE)], networkStage: null });
    expect(unsure).toMatchObject({ status: "known", answered: true, roles: ["supplier"] });
    // A Network stage "customer or partner" is a stated relationship of unrecorded kind.
    expect(assessRelationship(party(F.MANUFACTURER), party(F.HARDWARE_CO), { validations: [], networkStage: "customer_partner" }).links[0]).toMatchObject({ role: "unspecified", state: "fact", source: "network" });
  });
});

describe("Negative results (required cases)", () => {
  test("1 · zero opportunities is a valid, complete output", () => {
    const d = dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER);
    expect(d).toMatchObject({ status: "ready", verdict: "no_credible_opportunity", scenarios: [], novel: [] });
    expect(d.negative).not.toBeNull();
    expect(d.next.kind).toBe("no_business_now");
  });

  test("2 · an existing relationship suppresses the scenario that only restates it", () => {
    const d = dossier(F.IMPLEMENTER, F.IMPLEMENTED_VENDOR);
    expect(d.verdict).toBe("no_credible_opportunity");
    expect(codes(d, "implementation_partnership:own")).toContain("restates_existing");
    expect(d.considered.map((s) => s.key)).toContain("implementation_partnership:own");
    // Stated by the user, the same idea is rejected outright.
    const stated = dossier(F.IMPLEMENTER, F.IMPLEMENTED_VENDOR, "supplier");
    expect(stated.discarded.find((x) => x.mechanism === "implementation_partnership")?.findings.find((f) => f.code === "restates_existing")?.severity).toBe("kill");
  });

  test("3 · supplier ≠ prospect", () => {
    const read = dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER);
    expect(keys(read)).not.toContain("contract_production:own");
    expect(codes(read, "contract_production:own")).toContain("reverses_relationship");
    const stated = dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER, "supplier");
    expect(stated.verdict).toBe("no_credible_opportunity");
    expect(stated.discarded.find((x) => x.mechanism === "contract_production" && x.provider === "own")?.findings.find((f) => f.code === "reverses_relationship")?.severity).toBe("kill");
  });

  test("4 · partner ≠ customer", () => {
    // Without a known relationship, fulfilment for the brand is an opportunity (the brand sells to consumers).
    expect(dossier(F.LOGISTICS, F.ECOM_BRAND).verdict).toBe("opportunity");
    const partner = dossier(F.LOGISTICS, F.ECOM_BRAND, "partner");
    expect(partner.verdict).toBe("no_credible_opportunity");
    expect(codes(partner, "fulfilment_partnership:own")).toContain("reverses_relationship");
    // "No relationship yet" stated by the user changes nothing.
    expect(dossier(F.LOGISTICS, F.ECOM_BRAND, "none").verdict).toBe("opportunity");
    // Read from the brand's own website ("our logistics partner"), the same holds.
    expect(dossier(F.BRAND_LOGISTICS, F.DTC_BRAND).verdict).toBe("no_credible_opportunity");
  });

  test("5 · ecosystem relevance ≠ commercial opportunity", () => {
    for (const [a, b] of [[F.LOGISTICS, F.HAULIER], [F.SAAS_ON_CLOUD, F.CLOUD_PROVIDER]] as const) {
      const d = dossier(a, b);
      expect(d.verdict).toBe("no_credible_opportunity");
      expect(d.negative!.reasons).toContain("similarity_only");
      const s = d.negative!.shared;
      expect(s.audiences.length + s.industries.length + s.technologies.length).toBeGreaterThan(0);
    }
  });

  test("6 · complementary capability ≠ automatic opportunity: every credible scenario shows who would pay", () => {
    for (const [a, b] of PAIRS)
      for (const s of generateScenarios(party(a), party(b)).scenarios.filter((x) => x.verdict === "credible")) {
        const payerShown = s.needShown || (s.revenue.payer !== "partner" && s.whyNow.length > 0);
        expect({ pair: `${a.profile.name}×${b.profile.name}`, key: s.key, payerShown }).toEqual({ pair: `${a.profile.name}×${b.profile.name}`, key: s.key, payerShown: true });
      }
  });

  test("7 · company-size asymmetry alone does not decide", () => {
    const small = F.fixtureProfile("Kestrel Compute", "kestrel.example", F.SERVER_MAKER.profile.claims.map((c) => [c.field, c.statement.replace("a global manufacturer", "a five-person manufacturer"), c.epistemic] as [typeof c.field, string, typeof c.epistemic]));
    for (const answer of [undefined, "supplier", "none"]) {
      const big = dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER, answer);
      const tiny = dossier(F.APPLIANCE_INTEGRATOR, small, answer);
      expect(tiny.verdict).toBe(big.verdict);
      expect(keys(tiny)).toEqual(keys(big));
      expect(tiny.considered.map((s) => s.key)).toEqual(big.considered.map((s) => s.key));
    }
    // Size has no input in the reasoning at all.
    for (const f of ["scenarios.ts", "relationship.ts", "dossier.ts"]) expect(readFileSync(join(import.meta.dir, f), "utf8")).not.toMatch(/employees|headcount|revenue_size|company_size|\.size\b.*(large|small)/i);
  });

  test("8 · evidence of a genuinely incremental opportunity overrides the negative result", () => {
    for (const answer of [undefined, "supplier"]) {
      const d = dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER_OUTSOURCING, answer);
      expect(d.verdict).toBe("opportunity");
      const s = d.scenarios.find((x) => x.key === "contract_production:own")!;
      expect(s.verdict).toBe("credible");
      expect(s.needShown).toBe(true);
      expect(s.whyNow.some((w) => w.side === "target")).toBe(true); // the target's own dated signal
      expect(s.incremental).toEqual({ existing: ["supplier"] }); // explained as new compared with today
      expect(s.creates).toBe("customer");
      expect(codes(d, "contract_production:own")).not.toContain("reverses_relationship");
    }
  });

  test("9 · no company-specific logic in generic reasoning", () => {
    for (const f of ["scenarios.ts", "dossier.ts", "relationship.ts"]) {
      const code = readFileSync(join(import.meta.dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/dell|infodip|gigaio|kestrel|arvenor|nimbusfield|ledgerline|fieldnote|arclight|vestry|calderon|lumen|northway|hardware|appliance|server|manufactur|saas|biotech|pharma|logistic/i);
      expect(code).not.toMatch(/\bfetch\(|process\.env|openrouter|brave|@\/lib\/server/i);
    }
  });

  test("10 · only a credible scenario of an 'opportunity' dossier is trackable", () => {
    const neg = dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER);
    for (const s of neg.considered) expect(trackableScenario(neg, s.key)).toBeNull();
    const pos = dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER_OUTSOURCING);
    expect(trackableScenario(pos, "contract_production:own")?.key).toBe("contract_production:own");
    for (const s of pos.considered) expect(trackableScenario(pos, s.key)).toBeNull(); // weak ideas beside an opportunity
    expect(trackableScenario(pos, "does_not_exist:own")).toBeNull();
    const insufficient = companyDossier(party(F.SAAS), party(F.NICHE));
    expect(insufficient.verdict).toBe("insufficient");
    expect(trackableScenario(insufficient, "technical_integration:own")).toBeNull();
  });

  test("12 + 13 · negative results explain why, and what would change the assessment", () => {
    const d = dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER);
    expect(d.negative!.reasons.slice(0, 2)).toEqual(["restates_existing", "reverses_relationship"]);
    expect(d.negative!.reconsiderIf.length).toBeGreaterThan(0);
    expect(d.negative!.unknowns.length).toBeGreaterThan(0);
    expect(d.negative!.consideredMechanisms).toContainEqual({ mechanism: "contract_production", provider: "own" });
    expect(d.relationship.roles).toEqual(["supplier"]);
  });

  test("14 · no filler: nothing is generated to reach a count", () => {
    for (const [a, b] of PAIRS) {
      const d = companyDossier(party(a), party(b));
      for (const s of [...d.scenarios, ...d.novel]) expect(s.verdict).toBe("credible");
      for (const s of d.considered) expect(s.verdict).toBe("weak");
      expect(d.verdict === "opportunity").toBe(d.scenarios.length + d.novel.length > 0);
      if (d.status !== "ready") expect(d.verdict).toBe("insufficient");
    }
    for (const f of ["dossier.ts", "scenarios.ts"]) expect(readFileSync(join(import.meta.dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/MIN_(SCENARIOS|OPPORTUNITIES)|minimum/i);
  });
});

describe("Cross-domain negative patterns (with a positive variant where evidence exists)", () => {
  test.each([
    ["hardware: integrator × its server supplier", F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER],
    ["SaaS × its cloud infrastructure provider", F.SAAS_ON_CLOUD, F.CLOUD_PROVIDER],
    ["consultancy × the vendor it implements", F.IMPLEMENTER, F.IMPLEMENTED_VENDOR],
    ["biotech × its reagent supplier", F.REAGENT_BUYER, F.REAGENT_SUPPLIER],
    ["consumer brand × its logistics provider", F.DTC_BRAND, F.BRAND_LOGISTICS],
  ] as const)("%s → no credible new opportunity, relationship recognized", (_, a, b) => {
    const d = dossier(a, b);
    expect(d.verdict).toBe("no_credible_opportunity");
    expect(d.relationship.status).toBe("known");
    expect(d.negative!.reasons.length).toBeGreaterThan(0);
  });

  test("without the existing relationship, the same pairs are judged on their own merits (precision, not pessimism)", () => {
    expect(dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER_OUTSOURCING, "none").verdict).toBe("opportunity");
    expect(dossier(F.MANUFACTURER, F.HARDWARE_CO).verdict).toBe("opportunity");
    expect(dossier(F.SAAS, F.SAAS_PARTNER).verdict).toBe("opportunity");
    expect(dossier(F.BIOTECH, F.PHARMA).verdict).toBe("opportunity"); // Corvant states it in-licenses programs
  });

  test("a partner that only shows no need for production: contract production is considered, not recommended", () => {
    // GigaIO-like regression, fictional: a software/product partner with no evidence it outsources production.
    const product = F.fixtureProfile("Orbital Fabric", "orbital.example", [
      ["summary", "Orbital Fabric designs composable infrastructure hardware and software for enterprises."],
      ["offering", "Orbital Fabric integrates with leading platforms through native integrations."],
    ]);
    const d = dossier(F.APPLIANCE_INTEGRATOR, product);
    expect(keys(d)).not.toContain("contract_production:own");
    const considered = d.considered.find((s) => s.key === "contract_production:own");
    if (considered) expect(considered.critic.map((f) => f.code)).toEqual(expect.arrayContaining(["need_not_shown", "no_credible_payer"]));
  });
});

describe("The relationship question", () => {
  test("asked when the answer can change the conclusion, never again once answered", () => {
    expect(dossier(F.MANUFACTURER, F.HARDWARE_CO).askRelationship).toBe(true); // a lead to confirm
    expect(dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER).askRelationship).toBe(true); // a relationship read from evidence
    for (const answer of ["supplier", "none", NOT_SURE, "partner,customer"]) {
      expect(dossier(F.MANUFACTURER, F.HARDWARE_CO, answer).askRelationship).toBe(false);
      expect(dossier(F.APPLIANCE_INTEGRATOR, F.SERVER_MAKER, answer).askRelationship).toBe(false);
    }
    expect(dossier(F.LOGISTICS, F.HAULIER).askRelationship).toBe(false); // nothing to gain
  });
});
