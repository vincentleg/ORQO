/**
 * Qualification-quality regressions (Phase 3 review). Fictional companies;
 * each test encodes a general reasoning principle, not an expected output for
 * a real company.
 */
import { describe, expect, test } from "bun:test";
import { extractTargetProfile } from "./extract";
import { parseHtml } from "./html";
import { analyzeRelevance } from "./relevance";
import type { OwnCompanyContext, RelationshipType, TargetProfile } from "./types";

const NOW = new Date("2026-09-30T12:00:00Z");

function target(pages: Record<string, string>): TargetProfile {
  return extractTargetProfile({
    nameHint: null,
    domain: "target.example",
    website: "https://target.example",
    resolution: { method: "url", confidence: "strong" },
    pages: Object.entries(pages).map(([path, body], i) => ({
      doc: parseHtml(`<html><head><title>${i === 0 ? "Target Systems" : "Page"}</title></head><body>${body}</body></html>`, `https://target.example${path}`),
      source: { key: `s${i}`, url: `https://target.example${path}`, title: path, authority: "official" as const, pageType: i === 0 ? ("home" as const) : ("products" as const), retrievedAt: NOW.toISOString() },
    })),
    now: NOW,
  });
}

/** A hardware vendor: rugged edge servers and appliances, US-only presence stated. */
const HARDWARE_VENDOR = target({
  "/": `<p>Target Systems designs rugged edge servers and GPU appliances for defense and industrial customers.</p>
        <p>Our servers are deployed by customers across North America.</p>
        <a href="/partners">Become a Partner</a><a href="/careers">Join our team</a><p>Join our team! We are hiring engineers.</p>`,
  "/products": `<p>The T-100 rugged server packs four accelerators in a short-depth chassis for harsh environments.</p>`,
});

const own = (over: Partial<OwnCompanyContext> = {}): OwnCompanyContext => ({
  name: "Own Co",
  website: null,
  summary: "Electronics services company.",
  offerings: [],
  customerSegments: [],
  markets: [],
  geographies: [],
  soughtCapabilities: [],
  partnershipGoals: [],
  ...over,
});

/** An electronics services company: manufacturing, integration, testing, logistics, in Europe. */
const SERVICES_OWN = own({
  offerings: ["ODM manufacturing", "System integration and configuration", "Testing and burn-in", "Traceability", "Stock and logistics", "Deployment services"],
  customerSegments: ["Defense", "Industrial"],
  geographies: ["France", "Germany"],
  partnershipGoals: ["oem", "integration", "market_entry"],
});

describe("business mechanism, not category overlap", () => {
  test("shared industry and technology alone never become an accepted opportunity", () => {
    // Same industries and same rugged/edge technology, but nothing one side can do for the other.
    const peer = own({ offerings: ["Rugged edge servers"], customerSegments: ["Defense", "Industrial"], geographies: ["United States"], partnershipGoals: ["customer", "technology_partner", "integration", "strategic"] });
    const a = analyzeRelevance(peer, HARDWARE_VENDOR);
    expect(a.opportunities).toEqual([]);
    for (const h of a.hypotheses) expect(h.mechanism).toBe("contextual");
    // The overlap is surfaced as an insight to check, not as a partnership.
    expect(a.insights.map((i) => i.code)).toContain("possible_competitor");
  });

  test("a services provider and a hardware vendor yield a concrete build/integrate mechanism", () => {
    const a = analyzeRelevance(SERVICES_OWN, HARDWARE_VENDOR);
    const build = a.opportunities.find((o) => o.rule === "build_for");
    expect(build).toBeDefined();
    expect(build?.relationship).toBe("oem");
    expect(build?.mechanism).toBe("concrete");
    // The mechanism names WHICH own services apply, derived from the profile.
    expect(build?.ownServices).toEqual(expect.arrayContaining(["oem_odm", "assembly_integration", "testing_validation", "traceability", "logistics_services"]));
    // Unknowns derived from the mechanism, most decisive first.
    expect(build?.validation[0]).toBe("production_model");
    expect(build?.validation).toEqual(expect.arrayContaining(["manufacturing_partners", "outsourced_services", "deployment_geography", "volumes_stage"]));
    // No dated evidence → timing unknown, not invented.
    expect(build?.whyNowClaimIds).toEqual([]);
    expect(build?.checks.find((c) => c.id === "timing")?.result).toBe("info");
  });

  test("regional deployment is proposed only where the target shows no presence", () => {
    const a = analyzeRelevance(SERVICES_OWN, HARDWARE_VENDOR);
    const regional = a.opportunities.find((o) => o.rule === "regional_deployment");
    expect(regional?.relationship).toBe("market_entry");
    expect(regional?.drivers).toEqual(expect.arrayContaining(["france", "germany"]));
    // If the target's site already states presence in those regions, no gap → no mechanism.
    const present = target({ "/": `<p>Target Systems designs rugged edge servers for defense customers in France and Germany.</p>` });
    expect(analyzeRelevance(SERVICES_OWN, present).opportunities.some((o) => o.rule === "regional_deployment")).toBe(false);
  });
});

describe("partnership preferences", () => {
  const seeker = (goals: RelationshipType[]) => own({ offerings: ["ODM manufacturing"], soughtCapabilities: ["rugged edge servers"], geographies: ["France"], partnershipGoals: goals });

  test("a detectable but non-selected relationship is not a primary opportunity", () => {
    const a = analyzeRelevance(seeker(["oem"]), HARDWARE_VENDOR);
    expect(a.opportunities.every((o) => o.relationship === "oem")).toBe(true);
    // Supplier is detectable (they sell what we seek) but was not selected: observation only.
    expect(a.opportunities.some((o) => o.relationship === "supplier")).toBe(false);
    expect(a.observations.map((o) => o.relationship)).toContain("supplier");
    expect(a.observations.every((o) => !o.aligned && o.verdict === "pass")).toBe(true);
    // Weak, non-selected ideas are not shown at all.
    expect(a.hypotheses.every((o) => o.aligned)).toBe(true);
  });

  test("the same relationship becomes an opportunity once the workspace selects it", () => {
    const a = analyzeRelevance(seeker(["oem", "supplier"]), HARDWARE_VENDOR);
    expect(a.opportunities.map((o) => o.relationship)).toEqual(expect.arrayContaining(["oem", "supplier"]));
    expect(a.observations).toEqual([]);
  });

  test("with no goals declared, nothing is suppressed but goal fit is flagged as unset", () => {
    const a = analyzeRelevance(seeker([]), HARDWARE_VENDOR);
    expect(a.observations).toEqual([]);
    for (const o of [...a.opportunities, ...a.hypotheses]) expect(o.checks.find((c) => c.id === "goal_fit")).toMatchObject({ result: "warn", code: "unset" });
    expect(a.ownGaps).toContain("partnershipGoals");
  });
});

describe("signals and evidence discipline", () => {
  test("careers pages are not needs; a partner program is openness, not a need", () => {
    expect(HARDWARE_VENDOR.claims.some((c) => /recruit|hiring/i.test(c.statement))).toBe(false);
    const signals = HARDWARE_VENDOR.claims.filter((c) => c.field === "need");
    expect(signals.every((c) => c.epistemic === "inference")).toBe(true);
    expect(HARDWARE_VENDOR.unknowns).toContain("need");
  });

  test("one sentence yields at most two inferences; broad concepts are inferred once; no same-page duplicates", () => {
    const p = target({
      "/": `<p>Our AI cloud software platform powers rugged edge servers for defense, energy, telecom and healthcare HPC data centers.</p>
            <p>AI software for the cloud, built as a platform for every enterprise.</p>
            <p>Rugged edge servers for defense, built for the edge.</p>`,
    });
    const inferences = p.claims.filter((c) => c.epistemic === "inference");
    const perExcerpt = new Map<string, number>();
    for (const c of inferences) perExcerpt.set(c.excerpt ?? "", (perExcerpt.get(c.excerpt ?? "") ?? 0) + 1);
    expect(Math.max(...perExcerpt.values())).toBeLessThanOrEqual(2);
    for (const k of ["ai", "software", "cloud", "platform"]) expect(inferences.filter((c) => c.concepts.includes(k)).length).toBeLessThanOrEqual(1);
    for (const k of new Set(inferences.flatMap((c) => c.concepts))) expect(inferences.filter((c) => c.concepts.includes(k)).length).toBeLessThanOrEqual(1); // single page
  });

  test("utility headings and value-chain vocabulary are not inferred about the target", () => {
    const p = target({ "/": `<h2>Media Inquiries</h2><h2>Careers</h2><p>Fast deployment and easy configuration of our rugged edge servers for defense.</p>` });
    const concepts = p.claims.flatMap((c) => c.concepts);
    expect(concepts).not.toContain("media");
    expect(concepts).not.toContain("assembly_integration");
    expect(concepts).not.toContain("deployment_services");
  });

  test("information absent from the public site stays unknown (no private knowledge, no expansion invented)", () => {
    const a = analyzeRelevance(SERVICES_OWN, HARDWARE_VENDOR);
    expect(HARDWARE_VENDOR.claims.some((c) => c.concepts.some((k) => ["europe", "france", "germany"].includes(k)))).toBe(false);
    expect(HARDWARE_VENDOR.claims.some((c) => c.field === "strategy")).toBe(false);
    for (const o of a.opportunities) expect(o.whyNowClaimIds).toEqual([]);
    // European deployment is a question to validate, not a claim.
    expect(a.opportunities.flatMap((o) => o.validation)).toContain("deployment_geography");
  });
});
