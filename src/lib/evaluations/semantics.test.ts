/**
 * Phase 12 deterministic evaluation suite: ORQO's reasoning CONTRACT, as a
 * table of fictional cases run end to end through the real engines (Search
 * relevance, Phase 11 Opportunity Intelligence, Opportunity Graph, agent read
 * seam). No model, no LLM judge, no provider, no database: a fetch trap fails
 * any network access. Each case states the principle it protects; detailed
 * behavior stays covered by the per-module unit tests.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { findOpportunityCandidates } from "@/lib/graph/opportunity/candidates";
import { ORG_A, ORG_B, snapshot } from "@/lib/graph/opportunity/fixtures";
import { buildProjection } from "@/lib/graph/opportunity/projection";
import { extractTargetProfile } from "@/lib/intelligence/extract";
import { parseHtml } from "@/lib/intelligence/html";
import { analyzeRelevance, type EvaluatedCandidate } from "@/lib/intelligence/relevance";
import type { Claim, OwnCompanyContext, TargetProfile } from "@/lib/intelligence/types";
import { assess, fromGraph, fromSearch, relationshipFrom, type IntelContext, type OpportunityIntelligence } from "@/lib/opportunity/intelligence";
import { readRelationshipContext } from "@/lib/server/repositories/network-memory";
import type { Db } from "@/lib/server/supabase/types";

const NOW = new Date("2026-09-30T12:00:00Z");
const TARGET = "00000000-0000-4000-8000-0000000000e1";
const NONE: IntelContext = { relationships: [], signals: [] };

function target(pages: Record<string, string>): TargetProfile {
  return extractTargetProfile({
    nameHint: null,
    domain: "eval-target.example",
    website: "https://eval-target.example",
    resolution: { method: "url", confidence: "strong" },
    pages: Object.entries(pages).map(([path, body], i) => ({
      doc: parseHtml(`<html><head><title>${i === 0 ? "Eval Target" : "Page"}</title></head><body>${body}</body></html>`, `https://eval-target.example${path}`),
      source: { key: `s${i}`, url: `https://eval-target.example${path}`, title: path, authority: "official" as const, pageType: i === 0 ? ("home" as const) : ("products" as const), retrievedAt: NOW.toISOString() },
    })),
    now: NOW,
  });
}

/** Fictional hardware vendor: physical products, a dated plan and a "become a partner" link — no stated need. */
const VENDOR = target({
  "/": `<p>Eval Target designs rugged edge servers and GPU appliances for defense and industrial customers.</p><p>Our servers are deployed by customers across North America.</p><a href="/partners">Become a Partner</a>`,
  "/products": `<p>The E-100 rugged server packs four accelerators in a short-depth chassis for harsh environments.</p><p>In 2026 Eval Target announced an expansion into the European market with a new office in Munich.</p>`,
});

const own = (over: Partial<OwnCompanyContext>): OwnCompanyContext => ({ name: "Eval Own (fictional)", website: null, summary: "", offerings: [], customerSegments: [], markets: [], geographies: [], soughtCapabilities: [], partnershipGoals: [], ...over });
const INTEGRATOR = own({ offerings: ["Hardware integration, system configuration, testing and deployment support"], geographies: ["Europe"], partnershipGoals: ["customer", "technology_partner", "oem", "strategic"] });

const all = (o: OwnCompanyContext, p: TargetProfile) => {
  const a = analyzeRelevance(o, p);
  return { a, list: [...a.opportunities, ...a.hypotheses, ...a.observations, ...a.rejected] };
};
const brief = (o: OwnCompanyContext, p: TargetProfile, c: EvaluatedCandidate, ctx: IntelContext = NONE): OpportunityIntelligence =>
  assess(fromSearch({ candidate: c, profile: p, own: o, ownCompany: { id: null, name: o.name }, target: { id: TARGET, name: p.name }, insights: analyzeRelevance(o, p).insights, locale: "en" }), ctx);
const buildFor = (o: OwnCompanyContext, p: TargetProfile) => all(o, p).list.find((c) => c.rule === "build_for")!;
const withNeed = (p: TargetProfile): TargetProfile => ({
  ...p,
  claims: [...p.claims, { id: "need1", field: "need", statement: "Eval Target seeks an external integration partner", excerpt: "We are seeking an external integration partner for our European deployments.", sourceKey: "s1", epistemic: "fact", concepts: ["assembly_integration"], selfDescribed: true, method: "model_extraction" } satisfies Claim],
});
const RICH: IntelContext = {
  relationships: [{ companyId: TARGET, companyName: "Eval Target", stage: "conversation", contacts: 2, primaryContactName: "Alex Example", interactions: 5, lastInteractionOn: "2026-09-20", openFollowUps: 1, events: [{ eventId: "e1", eventName: "Fictional Expo", status: "met", upcoming: true }] }],
  signals: [{ id: "sig1", companyId: TARGET, companyName: "Eval Target", headline: "Eval Target opens a fictional plant", kind: "manufacturing", publishedOn: "2026-09-01", epistemic: "fact" }],
};

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("the deterministic evaluation suite must never reach the network");
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("ORQO reasoning contract (deterministic evaluation)", () => {
  test("E1 no forced opportunity: no own profile, or mere category overlap, yields no accepted opportunity", () => {
    expect(analyzeRelevance(own({}), VENDOR).status).toBe("own_profile_missing");
    const peer = own({ offerings: ["Rugged edge servers"], customerSegments: ["Defense", "Industrial"], geographies: ["United States"], partnershipGoals: ["customer", "technology_partner", "integration", "strategic"] });
    const { a } = all(peer, VENDOR);
    expect(a.opportunities.filter((c) => c.mechanism === "contextual")).toEqual([]);
    for (const c of a.hypotheses) expect(brief(peer, VENDOR, c).support).not.toBe("supported");
  });

  test("E2 FACT / INFERENCE / ASSUMPTION / UNKNOWN are kept apart and never upgraded", () => {
    const epistemics = new Set(VENDOR.claims.map((c) => c.epistemic));
    expect([...epistemics].every((e) => ["fact", "inference", "assumption", "unknown"].includes(e))).toBe(true);
    // A partner link is an inference, never a stated need.
    expect(VENDOR.claims.filter((c) => c.field === "need").every((c) => c.epistemic === "inference")).toBe(true);
    expect(VENDOR.unknowns).toContain("need");
    const b = brief(INTEGRATOR, VENDOR, buildFor(INTEGRATOR, VENDOR));
    expect(b.whyBasis).toBe("inference");
    const claims = new Map(VENDOR.claims.map((c) => [c.statement, c.epistemic]));
    for (const e of b.fitEvidence.filter((x) => x.origin === "official")) expect(e.status).toBe(claims.get((e.text as { literal: string }).literal)!);
    expect(b.assumptions.length).toBeGreaterThan(0);
  });

  test("E3 explicit demand vs product evidence: products do not establish demand; a stated need does", () => {
    expect(buildFor(INTEGRATOR, VENDOR).demand).toBe(false);
    expect(buildFor(INTEGRATOR, withNeed(VENDOR)).demand).toBe(true);
  });

  test("E4 timing cannot establish demand, and E5 relationship cannot either", () => {
    const b = brief(INTEGRATOR, VENDOR, buildFor(INTEGRATOR, VENDOR), RICH);
    expect(b.dimensions.timing).toBe("evidence");
    expect(b.dimensions.relationship).toBe("in_conversation");
    expect(b.critic.find((k) => k.id === "demand")!.result).toBe("warn");
    expect(b.support).toBe(brief(INTEGRATOR, VENDOR, buildFor(INTEGRATOR, VENDOR)).support);
    expect(b.support).not.toBe("supported");
  });

  test("E6 incompatible partnership goal: the mechanism is not presented as matching the goals", () => {
    const channelOnly = own({ ...INTEGRATOR, partnershipGoals: ["channel"] });
    const c = buildFor(channelOnly, VENDOR);
    expect(c.aligned).toBe(false);
    const { a } = all(channelOnly, VENDOR);
    expect(a.opportunities.concat(a.hypotheses).some((x) => x.rule === "build_for")).toBe(false);
    expect(brief(channelOnly, VENDOR, c).contradictions.some((x) => x.code === "outside_goals")).toBe(true);
  });

  test("E7 build/integration compatibility (Phase 11 review): aligned with OEM/ODM and customer goals", () => {
    const c = buildFor(INTEGRATOR, VENDOR);
    expect(c.relationship).toBe("integration");
    expect(c.aligned).toBe(true);
    expect(c.validation[0]).toBe("outsourced_services");
  });

  test("E8 unsupported opportunity stays unqualified: never Supported, never tracked, no workflow stage", () => {
    const b = brief(INTEGRATOR, VENDOR, buildFor(INTEGRATOR, VENDOR), RICH);
    expect(b.support).toBe("partially_supported");
    expect(b.label).not.toBe("tracked_opportunity");
    expect(b.workflowStage).toBeNull();
    expect(JSON.stringify(b)).not.toMatch(/probability|revenue|\d+\s?%/i);
  });

  test("E9 the next action resolves the most important unknown", () => {
    const b = brief(INTEGRATOR, VENDOR, buildFor(INTEGRATOR, VENDOR), RICH);
    expect(b.unknowns[0].code).toBe("outsourced_services");
    expect(b.nextAction.kind).toBe("ask_contact");
    expect("unknown" in b.nextAction && b.nextAction.unknown).toBe("outsourced_services");
  });

  test("E10 private data never enters the graph projection, a brief, or the agent read context", async () => {
    const projection = JSON.stringify(buildProjection(snapshot()));
    for (const k of ["email", "phone", "notes", "prepNotes", "description", "summary", "outcome"]) expect(projection).not.toContain(`"${k}"`);

    const r = relationshipFrom({
      company: { id: TARGET, name: "Eval Target", stage: "conversation" },
      contacts: [{ name: "Alex Example", isPrimary: true, createdAt: "2026-01-01", email: "alex@eval.example", phone: "+33 6 00 00 00 00", notes: "PRIVATE-NOTE" } as never],
      interactions: [{ occurredAt: "2026-09-20T10:00:00Z", summary: "PRIVATE-BODY" } as never],
      followUps: [],
      events: [],
      today: "2026-09-30",
    });
    expect(JSON.stringify(brief(INTEGRATOR, VENDOR, buildFor(INTEGRATOR, VENDOR), { relationships: [r], signals: [] }))).not.toMatch(/alex@|\+33|PRIVATE-/);

    const ts = "2026-09-20T10:00:00.000Z";
    const rows: Record<string, unknown[]> = {
      companies: [{ id: TARGET, name: "Eval Target", website: null, summary: "", markets: [], geographies: [], is_own_company: false, external_ref: null, network_stage: "conversation", network_origin: "manual", network_reason: "", origin_event_id: null, created_at: ts }],
      contacts: [{ id: "00000000-0000-4000-8000-0000000000c1", company_id: TARGET, name: "Alex Example", role: "CTO", email: "alex@eval.example", phone: "+33 6 00 00 00 00", profile_url: "https://social.example/alex", notes: "PRIVATE-NOTE", is_primary: true, created_at: ts }],
      interactions: [{ id: "00000000-0000-4000-8000-0000000000c2", company_id: TARGET, contact_id: null, kind: "meeting", occurred_at: ts, title: "Intro", summary: "PRIVATE-BODY", outcome: "PRIVATE-OUTCOME", next_step: "Send deck", event_id: null, created_at: ts }],
      follow_ups: [{ id: "00000000-0000-4000-8000-0000000000c3", company_id: TARGET, contact_id: null, interaction_id: null, title: "Send deck", description: "PRIVATE-DESCRIPTION", due_on: "2026-10-05", status: "open", priority: "normal", origin: "manual", assigned_to: null, closed_at: null, event_id: null, created_at: ts }],
      network_events: [],
    };
    const filters: [string, string, unknown][] = [];
    const db = {
      from(table: string) {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (c: string, v: unknown) => (filters.push([table, c, v]), chain),
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
        };
        return chain;
      },
    } as unknown as Db;
    const ctx = await readRelationshipContext(db, ORG_A, TARGET);
    expect(ctx?.provenance).toBe("private_relationship_memory");
    expect(ctx?.contacts[0]).toEqual({ id: "00000000-0000-4000-8000-0000000000c1", name: "Alex Example", role: "CTO", isPrimary: true });
    expect(JSON.stringify(ctx)).not.toMatch(/alex@|\+33|social\.example|PRIVATE-/);
    for (const t of ["companies", "contacts", "interactions", "follow_ups"]) expect(filters).toContainEqual([t, "organization_id", ORG_A]);
  });

  test("E11 no cross-tenant context: graph keys and briefs stay inside one organization", () => {
    const a = buildProjection(snapshot(ORG_A));
    const b = buildProjection(snapshot(ORG_B));
    expect(a.nodes.every((n) => n.key.startsWith(`${ORG_A}/`))).toBe(true);
    expect(b.nodes.every((n) => n.key.startsWith(`${ORG_B}/`))).toBe(true);
    const cand = findOpportunityCandidates(a).candidates[0];
    const foreign: IntelContext = { relationships: [{ ...RICH.relationships[0], companyId: "11111111-1111-4111-8111-111111111111", primaryContactName: "Foreign Person" }], signals: [{ ...RICH.signals[0], companyId: "11111111-1111-4111-8111-111111111111", headline: "FOREIGN" }] };
    expect(JSON.stringify(assess(fromGraph(cand, "en"), foreign))).not.toMatch(/FOREIGN|Foreign Person/);
  });

  test("E12 deterministic Free flows invoke no provider and are reproducible", () => {
    // The fetch trap above would throw on any provider call; running everything twice proves determinism.
    const run = () => {
      const { list } = all(INTEGRATOR, VENDOR);
      const briefs = list.map((c) => brief(INTEGRATOR, VENDOR, c, RICH));
      const graph = findOpportunityCandidates(buildProjection(snapshot()));
      return JSON.stringify({ briefs, graph });
    };
    expect(run()).toBe(run());
  });
});
