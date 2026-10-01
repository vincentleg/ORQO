/**
 * Phase 5 human-review pass: target-side mechanism wording, semantic
 * de-duplication of unknowns, outcome-driven mission Next Best Action.
 * Fictional companies; each test encodes a general rule.
 */
import { describe, expect, test } from "bun:test";
import { en } from "@/lib/i18n/messages/en";
import { fr } from "@/lib/i18n/messages/fr";
import { analyzeRelevance } from "@/lib/intelligence/relevance";
import { MANY_SERVICES_OWN, NAMED, SERVICES_OWN, solo, STRONG } from "./fixtures";
import { buildDiscoveryPlan } from "./plan";
import { criticizeCandidate, qualifyCandidate, targetOfferOf } from "./qualify";
import { blockerOf, dedupeUnknowns } from "./unknowns";

const customers = (o = SERVICES_OWN) => buildDiscoveryPlan(o, { intent: "customers", text: null, geography: null, market: null });

describe("target side of the mechanism", () => {
  test("a stored named product is reused, as a FACT with its source", () => {
    const q = qualifyCandidate(SERVICES_OWN, customers(), NAMED, [], "en");
    expect(q.mechanism?.targetOffer).toMatchObject({ kind: "named_products", epistemic: "fact" });
    expect(q.mechanism?.targetOffer?.text).toContain("VX-200 Edge Appliance");
    expect(q.mechanism?.targetOffer?.url).toStartWith("https://named.example");
  });

  test("a workspace with many services never crowds out what the target sells", () => {
    const q = qualifyCandidate(MANY_SERVICES_OWN, customers(MANY_SERVICES_OWN), STRONG, [], "en");
    expect(q.mechanism?.rule).toBe("build_for");
    expect(q.mechanism?.ownServices.length).toBeGreaterThanOrEqual(8);
    expect(q.mechanism?.drivers.length).toBeGreaterThan(0);
    expect(q.mechanism?.drivers.some((d) => q.mechanism?.ownServices.includes(d))).toBe(false);
    expect(q.mechanism?.targetOffer).not.toBeNull();
  });

  test("without supported target evidence the offer is UNKNOWN (explicit wording, never an empty dash)", () => {
    const best = analyzeRelevance(SERVICES_OWN, STRONG).opportunities[0];
    expect(targetOfferOf({ ...best, targetClaimIds: [], drivers: [] }, { ...STRONG, claims: STRONG.claims.filter((c) => c.field !== "product") }, [])).toBeNull();
    for (const catalog of [en, fr]) {
      expect(catalog.discover.mechanismLine.unknown).toContain("{target}");
      expect(catalog.discover.mechanismLine.unknown).not.toContain("—");
    }
  });

  test("outsourcing stays an assumption: conditional wording, never stated as fact", () => {
    expect(en.discover.mechanismIf.build_for).toMatch(/^If /);
    expect(fr.discover.mechanismIf.build_for).toMatch(/^Si /);
  });
});

describe("unknowns are de-duplicated semantically", () => {
  test("equivalent manufacturing/integration questions collapse into one, first in priority order", () => {
    const items = dedupeUnknowns(["production_model", "manufacturing_partners", "outsourced_services", "deployment_geography", "volumes_stage"], ["geography", "need", "product"], { offerKnown: true });
    expect(items).toEqual([
      { kind: "group", group: "operating_model", keys: ["production_model", "manufacturing_partners", "outsourced_services"] },
      { kind: "validation", key: "deployment_geography" },
      { kind: "validation", key: "volumes_stage" },
      { kind: "field", field: "need" },
    ]);
    expect(blockerOf(items)).toBe("operating_model");
  });

  test("genuinely different unknowns remain; an unanswered offer stays unknown", () => {
    expect(dedupeUnknowns(["fit_requirements", "sells_to_peers"], ["product"], { offerKnown: false })).toEqual([
      { kind: "validation", key: "fit_requirements" },
      { kind: "validation", key: "sells_to_peers" },
      { kind: "field", field: "product" },
    ]);
  });

  test("open-question count follows the de-duplicated list", () => {
    const plan = customers();
    const q = qualifyCandidate(SERVICES_OWN, plan, STRONG, [], "en");
    const d = criticizeCandidate(plan, q);
    const raw = q.mechanism!.validation.length + q.unknownFields.length;
    expect(d.dimensions?.openQuestions).toBe(dedupeUnknowns(q.mechanism!.validation, q.unknownFields, { offerKnown: true, max: 20 }).length);
    expect(d.dimensions!.openQuestions).toBeLessThan(raw);
  });
});

describe("conservative behavior is preserved", () => {
  test("a thin candidate stays weak, Why now stays unknown", () => {
    const own = { ...SERVICES_OWN, partnershipGoals: [] };
    const plan = customers(own);
    const q = qualifyCandidate(own, plan, solo("solo.example", "Solo Systems"), [], "en");
    expect(q.verdict).toBe("weak");
    expect(q.whyNow).toEqual([]);
    expect(criticizeCandidate(plan, q).priority).toBe("weak");
  });
});
