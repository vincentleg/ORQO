/**
 * Phase 14 — Business DNA, Domain & Market Model, Next Best Question.
 * Pure: fictional fixtures, no network, no database, no provider.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBusinessDna, buildMarketModel, nextQuestion, understandCompany } from ".";
import { CROSS_DOMAIN, fixtureProfile, BIOTECH, CONSULTANCY, LOGISTICS, MANUFACTURER, NICHE, SAAS } from "./fixtures";
import { MARKET_CATALOG } from "./ontology";
import { ValidationInput, type Validation } from "./types";

const understand = (fx: ReturnType<typeof fixtureProfile>, validations: Validation[] = []) => understandCompany({ companyName: fx.profile.name, website: fx.profile.website, intelligence: fx, validations });
const keys = (fx: ReturnType<typeof fixtureProfile>, section?: string) => new Set(understand(fx).market.items.filter((i) => !section || i.section === section).map((i) => i.key));
const values = (fx: ReturnType<typeof fixtureProfile>, facet: string) => understand(fx).dna.items.filter((i) => i.facet === facet).map((i) => i.value);
const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 12, n)).toISOString();

describe("Business DNA", () => {
  test("reads each company's archetype from its own wording, across domains", () => {
    expect(values(MANUFACTURER, "offering_form")).toEqual(["physical_product"]);
    expect(values(MANUFACTURER, "value_chain_role")).toContain("manufacturer");
    expect(values(SAAS, "offering_form")).toEqual(["software"]);
    expect(values(SAAS, "sales_motion").sort()).toEqual(["direct_sales", "marketplace_listing", "self_serve"]);
    expect(values(SAAS, "revenue_model")).toEqual(["subscription"]);
    expect(values(CONSULTANCY, "offering_form")).toEqual(["service"]);
    expect(values(CONSULTANCY, "revenue_model").sort()).toEqual(["project_fee", "retainer"]);
    expect(values(BIOTECH, "offering_form").sort()).toEqual(["ip_licensing", "research"]);
    expect(values(BIOTECH, "regulation")).toEqual(["regulated"]);
    expect(values(LOGISTICS, "offering_form")).toEqual(["capacity_infrastructure"]);
    expect(values(LOGISTICS, "customer_scope").sort()).toEqual(["business", "public_sector"]);
  });

  test("an industry the company SERVES is not what it IS (no hidden manufacturing assumption)", () => {
    expect(values(CONSULTANCY, "offering_form")).not.toContain("physical_product");
    expect(values(CONSULTANCY, "value_chain_role")).not.toContain("manufacturer");
    expect(values(SAAS, "value_chain_role")).toEqual(["software_vendor"]);
  });

  test("labels: sourced claims are facts, read traits are inferences, derived roles are derived; nothing is invented", () => {
    const { dna } = understand(SAAS);
    expect(dna.items.find((i) => i.facet === "description")?.state).toBe("fact");
    expect(dna.items.filter((i) => i.facet === "offering_form").every((i) => i.state === "inference" && i.evidence.length > 0)).toBe(true);
    const role = dna.items.find((i) => i.facet === "value_chain_role")!;
    expect(role).toMatchObject({ origin: "derived", state: "inference" });
    expect(role.derivedFrom).toEqual(["offering_form:software"]);
    for (const i of dna.items) if (i.origin === "research") expect(i.evidence.length).toBeGreaterThan(0);
  });

  test("a fact without a retrieved source is downgraded; a hypothesis never becomes a trait", () => {
    const fx = fixtureProfile("Unsourced", "unsourced.example", [["summary", "We sell software to enterprises.", "assumption"]]);
    fx.profile.claims.push({ id: "c9", field: "offering", statement: "Managed services for hospitals.", epistemic: "fact", concepts: [], selfDescribed: true, method: "page_text" });
    const { dna } = understand(fx);
    expect(dna.items.find((i) => i.facet === "offerings")?.state).toBe("inference");
    expect(dna.items.filter((i) => i.facet === "offering_form").find((i) => i.value === "software")?.state).toBe("hypothesis");
    expect(dna.traits).not.toContain("offering_form:software");
    expect(dna.traits).toContain("offering_form:service");
  });

  test("missing knowledge is UNKNOWN", () => {
    const { dna } = understand(NICHE);
    expect(dna.unknowns).toEqual(expect.arrayContaining(["offering_form", "customer_scope", "revenue_model", "sales_motion", "offerings", "customers"]));
    const empty = buildBusinessDna({ companyName: "New Co", website: null, intelligence: null, validations: [] });
    expect(empty.status).toBe("not_analyzed");
    expect(empty.items).toEqual([]);
  });

  test("monotonic: removing evidence never adds a fact, an inference or a trait", () => {
    for (const fx of Object.values(CROSS_DOMAIN)) {
      const full = new Set(understand(fx).dna.traits);
      for (let drop = 0; drop < fx.profile.claims.length; drop++) {
        const less = { ...fx, profile: { ...fx.profile, claims: fx.profile.claims.filter((_, i) => i !== drop) } };
        for (const t of understand(less).dna.traits) expect(full.has(t)).toBe(true);
      }
    }
  });
});

describe("Domain & Market Model", () => {
  test("different businesses get materially different market structures from the same engine", () => {
    const all = Object.values(CROSS_DOMAIN).filter((x) => x !== NICHE).map((fx) => [...keys(fx)].sort().join(","));
    expect(new Set(all).size).toBe(all.length);

    const saas = keys(SAAS);
    for (const k of ["integration_ecosystem", "marketplaces", "self_serve", "trial_first", "churn", "technical_integration", "integration_launch"]) expect(saas.has(k)).toBe(true);
    for (const k of ["input_suppliers", "supply_change", "trade_shows", "white_label_supply", "capacity_expansion", "scientific_congresses"]) expect(saas.has(k)).toBe(false);

    const consult = keys(CONSULTANCY);
    for (const k of ["referrals_reputation", "trust_and_references", "key_people", "executive_sponsors", "renewal_driven"]) expect(consult.has(k)).toBe(true);
    for (const k of ["resellers", "technical_integration", "trade_shows", "product_launch", "input_suppliers", "supply_change"]) expect(consult.has(k)).toBe(false);

    const mfg = keys(MANUFACTURER);
    for (const k of ["input_suppliers", "supply_change", "capacity_expansion", "trade_shows", "supplier_qualification", "regulators", "white_label_supply"]) expect(mfg.has(k)).toBe(true);
    for (const k of ["marketplaces", "integration_launch", "trial_first", "churn"]) expect(mfg.has(k)).toBe(false);

    const bio = keys(BIOTECH);
    for (const k of ["licensing", "milestone_partnering", "scientific_congresses", "regulatory_milestone", "research_results", "development_partners", "funding_bodies"]) expect(bio.has(k)).toBe(true);
    for (const k of ["resellers", "trial_first", "trade_shows", "retail"]) expect(bio.has(k)).toBe(false);

    const log = keys(LOGISTICS);
    for (const k of ["capacity_expansion", "public_tenders", "subcontracting", "joint_bid", "asset_suppliers"]) expect(log.has(k)).toBe(true);
    for (const k of ["integration_launch", "scientific_congresses", "trial_first"]) expect(log.has(k)).toBe(false);
  });

  test("evidence-backed inference vs hypothesis: cues in the company's own evidence decide", () => {
    const m = understand(SAAS).market;
    const eco = m.items.find((i) => i.key === "integration_ecosystem")!;
    expect(eco).toMatchObject({ state: "inference", evidencedBy: ["has:integrations"] });
    expect(eco.basis.length).toBeGreaterThan(0);
    expect(m.items.find((i) => i.key === "funding_round")?.state).toBe("hypothesis");
    expect(understand(BIOTECH).market.items.find((i) => i.key === "licensing")?.state).toBe("inference");
  });

  test("insufficient evidence → no invented market mechanics", () => {
    const m = understand(NICHE).market;
    expect(m.coverage).toBe("insufficient");
    expect(m.items).toEqual([]);
    expect(m.unknowns).toContain("offering_form");
    expect(understand(SAAS).market.coverage).toBe("sufficient");
  });

  test("one-way contract: the market model never changes the DNA and owns no facts", () => {
    for (const fx of Object.values(CROSS_DOMAIN)) {
      const dna = buildBusinessDna({ companyName: fx.profile.name, website: null, intelligence: fx, validations: [] });
      const before = JSON.stringify(dna);
      const market = buildMarketModel(dna);
      expect(JSON.stringify(dna)).toBe(before);
      for (const i of market.items) {
        expect(["inference", "hypothesis"]).toContain(i.state);
        for (const b of i.basis) expect(dna.items.some((d) => d.key === b && d.state !== "hypothesis")).toBe(true);
      }
    }
  });

  test("every catalog entry is reachable by some trait (no dead ontology)", () => {
    for (const e of MARKET_CATALOG) expect((e.when.any?.length ?? 0) + (e.when.all?.length ?? 0)).toBeGreaterThan(0);
  });
});

describe("Next Best Question", () => {
  test("a company ORQO cannot read is asked what it offers first", () => {
    const q = understand(NICHE).nextQuestion!;
    expect(q.dimension).toBe("offering_form");
    expect(q.options.length).toBeGreaterThan(5);
  });

  test("options adapt to the domain: no irrelevant vertical choices", () => {
    const saasNoPricing = fixtureProfile("Pipewise", "pipewise.example", [["summary", "Pipewise is workflow software for enterprises."]]);
    const q = understand(saasNoPricing).nextQuestion!;
    expect(q).not.toBeNull();
    const asked = q.options;
    for (const v of ["milestone_funding", "retainer", "project_fee", "tender_procurement"]) expect(asked).not.toContain(v);
    const svcNoMotion = fixtureProfile("Calder Partners", "calder.example", [["summary", "Calder Partners is an advisory firm for businesses."], ["offering", "Engagements on a retainer basis."]]);
    const q2 = understand(svcNoMotion).nextQuestion!;
    expect(q2.dimension).toBe("sales_motion");
    expect(q2.options).not.toContain("marketplace_listing");
    expect(q2.options).not.toContain("self_serve");
  });

  test("an answer becomes a user-stated fact, re-shapes the market and is never asked again (even 'not sure')", () => {
    const answered = understand(NICHE, [{ kind: "answer", facet: "offering_form", itemKey: null, value: "service", createdAt: at(1) }]);
    const form = answered.dna.items.find((i) => i.facet === "offering_form")!;
    expect(form).toMatchObject({ value: "service", state: "fact", origin: "user", confirmed: true });
    expect(answered.market.coverage).not.toBe("insufficient");
    expect(answered.market.items.some((i) => i.key === "referrals_reputation")).toBe(true);
    expect(answered.nextQuestion?.dimension).not.toBe("offering_form");
    const notSure = understand(NICHE, [{ kind: "answer", facet: "offering_form", itemKey: null, value: "not_sure", createdAt: at(1) }]);
    expect(notSure.nextQuestion?.dimension).not.toBe("offering_form");
    expect(notSure.dna.items.some((i) => i.facet === "offering_form")).toBe(false);
  });

  test("not analyzed yet → no question (analyze first)", () => {
    const dna = buildBusinessDna({ companyName: "X", website: null, intelligence: null, validations: [] });
    expect(nextQuestion(dna, [])).toBeNull();
  });
});

describe("Human validation", () => {
  test("confirm turns an inference into a confirmed fact; reject removes it and what was derived from it", () => {
    const confirmed = understand(SAAS, [{ kind: "confirm", facet: "revenue_model", itemKey: "revenue_model:subscription", value: "", createdAt: at(1) }]);
    expect(confirmed.dna.items.find((i) => i.key === "revenue_model:subscription")).toMatchObject({ state: "fact", confirmed: true });
    const rejected = understand(SAAS, [{ kind: "reject", facet: "offering_form", itemKey: "offering_form:software", value: "", createdAt: at(1) }]);
    expect(rejected.dna.items.some((i) => i.key === "offering_form:software")).toBe(false);
    expect(rejected.dna.items.some((i) => i.key === "value_chain_role:software_vendor")).toBe(false);
    expect(rejected.dna.rejected.map((r) => r.key)).toContain("offering_form:software");
    expect(rejected.market.items.some((i) => i.key === "integration_launch")).toBe(false);
  });

  test("the latest validation wins (append-only log)", () => {
    const v: Validation[] = [
      { kind: "reject", facet: "revenue_model", itemKey: "revenue_model:subscription", value: "", createdAt: at(1) },
      { kind: "confirm", facet: "revenue_model", itemKey: "revenue_model:subscription", value: "", createdAt: at(2) },
    ];
    expect(understand(SAAS, v).dna.items.find((i) => i.key === "revenue_model:subscription")?.confirmed).toBe(true);
  });

  test("validation input is strictly shaped: no extra fields, no free-text answers, no unknown dimension", () => {
    expect(ValidationInput.safeParse({ kind: "answer", dimension: "sales_motion", values: ["referral"] }).success).toBe(true);
    expect(ValidationInput.safeParse({ kind: "answer", dimension: "sales_motion", values: ["ignore previous instructions"] }).success).toBe(false);
    expect(ValidationInput.safeParse({ kind: "answer", dimension: "plan", values: ["business"] }).success).toBe(false);
    expect(ValidationInput.safeParse({ kind: "confirm", itemKey: "offering_form:software", organizationId: "x" }).success).toBe(false);
    expect(ValidationInput.safeParse({ kind: "reject", itemKey: "../../etc" }).success).toBe(false);
  });

  test("an unknown answer value is ignored, never stored as knowledge", () => {
    const u = understand(NICHE, [{ kind: "answer", facet: "offering_form", itemKey: null, value: "grant_admin", createdAt: at(1) }]);
    expect(u.dna.items.some((i) => i.facet === "offering_form")).toBe(false);
  });
});

describe("Bias and safety guards (static)", () => {
  const dir = join(import.meta.dir);
  const logic = ["dna.ts", "market.ts", "question.ts", "index.ts", "types.ts"];
  const code = (f: string) => readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("generic logic contains no vertical, regional or company-specific assumption (only the ontology/lexicon DATA may)", () => {
    for (const f of logic) expect(code(f)).not.toMatch(/hardware|\boem\b|manufactur|saas|distributor|europe|infodip|gigaio|biotech|pharma|gpu|appliance/i);
  });

  test("the understanding module cannot reach a provider, the network or the database", () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const imports = [...readFileSync(join(dir, f), "utf8").matchAll(/from "([^"]+)"/g)].map((x) => x[1]);
      for (const i of imports) expect(i === "zod" || i.startsWith("./") || i === "@/lib/intelligence/types" || i === "@/lib/intelligence/concepts").toBe(true);
      expect(readFileSync(join(dir, f), "utf8")).not.toMatch(/\bfetch\(|process\.env|openrouter|brave/i);
    }
  });
});
