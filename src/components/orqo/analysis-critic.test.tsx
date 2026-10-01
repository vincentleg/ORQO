/**
 * Phase 11 final human-review correction: the Search candidate card shows the
 * demand condition ("Someone needs it") and the Phase 11 support state instead
 * of the internal confidence level. Static render, fictional data only; no
 * database, no provider, no network.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { extractTargetProfile } from "@/lib/intelligence/extract";
import { parseHtml } from "@/lib/intelligence/html";
import { analyzeRelevance, demandEstablished } from "@/lib/intelligence/relevance";
import type { Claim, OwnCompanyContext, TargetProfile } from "@/lib/intelligence/types";
import { assess, fromSearch } from "@/lib/opportunity/intelligence";
import { RelevanceSection } from "./analysis";

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

// Fictional hardware vendor: real products, a dated plan, a "become a partner" link — but no stated need for an integrator.
const VENDOR = target({
  "/": `<p>Target Systems designs rugged edge servers and GPU appliances for defense and industrial customers.</p><p>Our servers are deployed by customers across North America.</p><a href="/partners">Become a Partner</a>`,
  "/products": `<p>The T-100 rugged server packs four accelerators in a short-depth chassis for harsh environments.</p><p>In 2026 Target Systems announced an expansion into the European market with a new office in Munich.</p>`,
});

// Fictional services company: integrates, configures, tests and deploys other companies' hardware; does not manufacture.
const INTEGRATOR: OwnCompanyContext = {
  name: "Integrator Co (fictional)",
  website: null,
  summary: "",
  offerings: ["Hardware integration, system configuration, testing and deployment support"],
  customerSegments: ["Technology companies selling servers"],
  markets: [],
  geographies: ["Europe"],
  soughtCapabilities: [],
  partnershipGoals: ["customer", "technology_partner", "oem", "strategic"],
};

const build = (profile: TargetProfile) => {
  const a = analyzeRelevance(INTEGRATOR, profile);
  return { a, c: [...a.opportunities, ...a.hypotheses, ...a.observations].find((x) => x.rule === "build_for")! };
};

/** The same vendor, plus one explicit, sourced statement that it needs an integration partner. */
function withStatedNeed(p: TargetProfile): TargetProfile {
  const need: Claim = { id: "n1", field: "need", statement: "Target Systems is looking for an external integration partner in Europe", excerpt: "We are seeking an external integration partner for our European deployments.", sourceKey: "s1", epistemic: "fact", concepts: ["assembly_integration"], selfDescribed: true, method: "model_extraction" };
  return { ...p, claims: [...p.claims, need] };
}

const render = (profile: TargetProfile, locale: "en" | "fr" = "en") => {
  const a = analyzeRelevance(INTEGRATOR, profile);
  return renderToStaticMarkup(<RelevanceSection analysis={a} profile={profile} own={INTEGRATOR.name} ownContext={INTEGRATOR} locale={locale} canEditProfile={false} />);
};

describe("demand is not product evidence", () => {
  test("what the target sells (products, an openness link, a dated plan) does not establish demand", () => {
    const { c } = build(VENDOR);
    expect(c.checks.find((k) => k.id === "target_evidence")!.result).toBe("pass");
    expect(VENDOR.claims.some((x) => x.field === "need")).toBe(true); // the openness link exists, as an inference
    expect(c.whyNowClaimIds.length).toBeGreaterThan(0); // timing exists
    expect(c.demand).toBe(false);
    expect(demandEstablished(c, VENDOR)).toBe(false);
  });

  test("an explicit, sourced target need about the mechanism establishes demand", () => {
    const p = withStatedNeed(VENDOR);
    const { c } = build(p);
    expect(c.demand).toBe(true);
    // A need about something else does not.
    const other: TargetProfile = { ...p, claims: p.claims.map((x) => (x.id === "n1" ? { ...x, concepts: ["distribution"] } : x)) };
    expect(build(other).c.demand).toBe(false);
  });

  test("demand does not change the Search verdict or the internal confidence", () => {
    const before = build(VENDOR).c;
    const after = build(withStatedNeed(VENDOR)).c;
    expect(after.verdict).toBe(before.verdict);
    expect(after.checks.map((k) => k.id)).not.toContain("demand");
  });

  test("timing and relationship never satisfy demand; support stays cautious and nothing is qualified", () => {
    const { a, c } = build(VENDOR);
    const draft = fromSearch({ candidate: c, profile: VENDOR, own: INTEGRATOR, ownCompany: { id: null, name: INTEGRATOR.name }, target: { id: "00000000-0000-4000-8000-0000000000a1", name: "Target Systems" }, insights: a.insights, locale: "en" });
    const rich = assess(draft, {
      relationships: [{ companyId: "00000000-0000-4000-8000-0000000000a1", companyName: "Target Systems", stage: "conversation", contacts: 2, primaryContactName: "Alex Example", interactions: 4, lastInteractionOn: "2026-09-20", openFollowUps: 1, events: [{ eventId: "e1", eventName: "Fictional Expo", status: "met", upcoming: true }] }],
      signals: [{ id: "s1", companyId: "00000000-0000-4000-8000-0000000000a1", companyName: "Target Systems", headline: "Target Systems opens a fictional plant", kind: "manufacturing", publishedOn: "2026-09-01", epistemic: "fact" }],
    });
    expect(rich.dimensions.timing).toBe("evidence");
    expect(rich.dimensions.access).toBe("direct");
    expect(rich.critic.find((k) => k.id === "demand")).toMatchObject({ result: "warn", code: "unestablished" });
    expect(rich.support).not.toBe("supported");
    expect(rich.label).not.toBe("tracked_opportunity");
    expect(rich.workflowStage).toBeNull();
    expect(rich.nextAction.kind).toBe("ask_contact");
    expect(rich.unknowns[0].code).toBe("outsourced_services");
  });
});

describe("Search candidate card", () => {
  test("EN: the critic shows the unmet demand, and the badge is the support state, not a confidence", () => {
    const html = render(VENDOR);
    expect(html).toContain('data-check="demand" data-result="warn"');
    expect(html).toContain("Someone needs it");
    expect(html).toContain("Not established. No evidence yet shows that Target Systems needs or uses what Integrator Co (fictional) would provide.");
    expect(html).toContain("Evidence of what Target Systems does");
    expect(html).toContain("not that it needs this");
    expect(html).not.toContain("Confidence:");
    expect(html).toContain('data-support="partially_supported"');
    expect(html).toContain("Partly supported");
    expect(html).not.toMatch(/>Supported<|Qualified/);
  });

  test("EN: with a stated need the demand row passes", () => {
    expect(render(withStatedNeed(VENDOR))).toContain('data-check="demand" data-result="pass"');
  });

  test("FR: translated, no mixing", () => {
    const html = render(VENDOR, "fr");
    expect(html).toContain("Un besoin existe");
    expect(html).toContain("Non établi.");
    expect(html).toContain("Partiellement étayée");
    expect(html).not.toContain("Someone needs it");
    expect(html).not.toContain("Confiance");
  });
});
