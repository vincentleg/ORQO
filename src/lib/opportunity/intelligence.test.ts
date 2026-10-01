/**
 * Phase 11 Opportunity Intelligence: deterministic briefs over fictional
 * fixtures only (no database, no provider, no network). Each test encodes a
 * general reasoning principle, not an expected output for a real company.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { findOpportunityCandidates } from "@/lib/graph/opportunity/candidates";
import { BRIGHT, CARGO, NOVA, ORG_A, ORG_B, snapshot } from "@/lib/graph/opportunity/fixtures";
import { buildProjection } from "@/lib/graph/opportunity/projection";
import { createTranslator } from "@/lib/i18n/translate";
import { extractTargetProfile } from "@/lib/intelligence/extract";
import { parseHtml } from "@/lib/intelligence/html";
import { analyzeRelevance } from "@/lib/intelligence/relevance";
import type { OwnCompanyContext, TargetProfile } from "@/lib/intelligence/types";
import { nextBestAction } from "@/lib/network/model";
import {
  assess,
  companyIntelligence,
  fromCanonical,
  fromGraph,
  fromSearch,
  relationshipFrom,
  SUPPORT_STATES,
  type CanonicalOpportunityRecord,
  type IntelContext,
  type OpportunityIntelligence,
  type Participant,
  type RelationshipInput,
  type Text,
  type ThesisDraft,
} from "./intelligence";

const NOW = new Date("2026-09-30T12:00:00Z");
const TARGET_ID = "00000000-0000-4000-8000-0000000000a1";
const OWN_ID = "00000000-0000-4000-8000-0000000000a0";

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

const HARDWARE_VENDOR = target({
  "/": `<p>Target Systems designs rugged edge servers and GPU appliances for defense and industrial customers.</p><p>Our servers are deployed by customers across North America.</p>`,
  "/products": `<p>The T-100 rugged server packs four accelerators in a short-depth chassis for harsh environments.</p>`,
});

const own = (over: Partial<OwnCompanyContext> = {}): OwnCompanyContext => ({
  name: "Own Co (fictional)",
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

const SERVICES_OWN = own({
  offerings: ["ODM manufacturing", "System integration and configuration", "Testing and burn-in", "Stock and logistics", "Deployment services"],
  customerSegments: ["Defense", "Industrial"],
  geographies: ["France", "Germany"],
  partnershipGoals: ["oem", "integration", "market_entry"],
});

const EMPTY_CTX: IntelContext = { relationships: [], signals: [] };

function searchBriefs(o: OwnCompanyContext, profile: TargetProfile, ctx: IntelContext = EMPTY_CTX, locale: "en" | "fr" = "en") {
  const a = analyzeRelevance(o, profile);
  return [...a.opportunities, ...a.hypotheses, ...a.observations, ...a.rejected].map((c) =>
    assess(fromSearch({ candidate: c, profile, own: o, ownCompany: { id: OWN_ID, name: o.name }, target: { id: TARGET_ID, name: profile.name }, insights: a.insights, locale }), ctx),
  );
}

const say = (b: Text, locale: "en" | "fr" = "en") => ("literal" in b ? b.literal : createTranslator(locale)(b.key, b.vars));

/** A controlled thesis for the shared assessment. */
function draft(over: Partial<ThesisDraft> = {}, sides: Partial<Participant>[] = [{}, {}]): ThesisDraft {
  const [a, b] = sides;
  return {
    id: "t:1",
    source: "search",
    label: "search_hypothesis",
    workflowStage: null,
    mechanism: { kind: "integration", concrete: true, rule: "build_for" },
    thesis: { literal: "Fictional thesis" },
    why: { literal: "A builds what B sells." },
    whyBasis: "inference",
    value: { literal: "B outsources assembly to A." },
    participants: [
      { companyId: OWN_ID, name: "Own Co", isOwn: true, role: "own", brings: [{ text: { literal: "Assembly" }, status: "fact" }], seeks: [], support: "fact", ...a },
      { companyId: TARGET_ID, name: "Target Co", isOwn: false, role: "target", brings: [{ text: { literal: "Appliance" }, status: "fact" }], seeks: [], support: "fact", ...b },
    ],
    fitEvidence: [],
    references: [],
    timing: [],
    relationships: [],
    assumptions: [],
    contradictions: [],
    unknowns: [{ code: "production_model", origin: "mechanism", text: { literal: "u" }, question: { literal: "Do you outsource assembly?" }, resolve: "ask", companyId: TARGET_ID, company: "Target Co" }],
    specific: true,
    demandEstablished: true,
    cap: null,
    ...over,
  };
}

const rel = (over: Partial<RelationshipInput> = {}): RelationshipInput => ({
  companyId: TARGET_ID,
  companyName: "Target Co",
  stage: null,
  contacts: 0,
  primaryContactName: null,
  interactions: 0,
  lastInteractionOn: null,
  openFollowUps: 0,
  events: [],
  ...over,
});

const SIGNAL = { id: "s1", companyId: TARGET_ID, companyName: "Target Co", headline: "Target Co opens a fictional plant", kind: "manufacturing", publishedOn: "2026-09-01", epistemic: "fact" as const };

// No provider on the deterministic path: any fetch fails the suite.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("network access is not allowed in Opportunity Intelligence");
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("business mechanism and contributions", () => {
  test("a concrete mechanism with facts on both sides is supported, and says who brings what", () => {
    const b = searchBriefs(SERVICES_OWN, HARDWARE_VENDOR).find((x) => x.mechanism.rule === "build_for")!;
    expect(b).toBeDefined();
    expect(b.mechanism.concrete).toBe(true);
    expect(["supported", "partially_supported"]).toContain(b.support);
    const [o, t] = b.participants;
    expect(o.isOwn && o.brings.length > 0).toBe(true);
    expect(t.role).toBe("target");
    expect(t.brings.length).toBeGreaterThan(0);
    // Separate, not merged into one symmetric list.
    expect(o.brings.map((x) => say(x.text))).not.toEqual(t.brings.map((x) => say(x.text)));
    expect(b.value).not.toBeNull();
    expect(say(b.thesis!)).toContain("Target Systems");
  });

  test("generic industry overlap alone is insufficient evidence", () => {
    const peer = own({ offerings: ["Rugged edge servers"], customerSegments: ["Defense", "Industrial"], geographies: ["United States"], partnershipGoals: ["customer", "technology_partner", "integration", "strategic"] });
    const briefs = searchBriefs(peer, HARDWARE_VENDOR);
    for (const b of briefs.filter((x) => !x.mechanism.concrete)) expect(b.support).toBe("insufficient_evidence");
    expect(briefs.some((b) => b.support === "supported")).toBe(false);
  });

  test("without a concrete mechanism, support is insufficient whatever the evidence", () => {
    expect(assess(draft({ mechanism: { kind: "customer", concrete: false, rule: "segment_customer" } }), EMPTY_CTX).support).toBe("insufficient_evidence");
    expect(assess(draft({ specific: false }), EMPTY_CTX).support).toBe("insufficient_evidence");
  });

  test("an unsupported contribution stays unknown and is never filled in", () => {
    const b = assess(draft({}, [{}, { brings: [], support: "unknown" }]), EMPTY_CTX);
    expect(b.participants[1].brings).toEqual([]);
    expect(b.support).toBe("insufficient_evidence");
    expect(b.unknowns[0].code).toBe("side_no_evidence");
    expect(b.critic.find((c) => c.id === "other_contribution")!.result).toBe("fail");
  });

  test("an inferred side is partial, and the own side missing asks for the profile", () => {
    expect(assess(draft({}, [{}, { support: "inference" }]), EMPTY_CTX).support).toBe("partially_supported");
    const noOwn = assess(draft({}, [{ brings: [], support: "unknown" }, {}]), EMPTY_CTX);
    expect(noOwn.unknowns.some((u) => u.code === "own_contribution" && u.resolve === "profile")).toBe(true);
    expect(noOwn.nextAction.kind).toBe("update_profile");
  });

  test("value is never invented: without it, support is capped", () => {
    const b = assess(draft({ value: null }), EMPTY_CTX);
    expect(b.value).toBeNull();
    expect(b.support).toBe("needs_validation");
    expect(b.critic.find((c) => c.id === "value")!.result).toBe("fail");
  });
});

describe("fit, timing and relationship stay separate", () => {
  const weakFit = () => draft({}, [{}, { brings: [], support: "unknown" }]);

  test("a signal adds WHY NOW, never fit", () => {
    const without = assess(draft(), EMPTY_CTX);
    const withSignal = assess(draft(), { relationships: [], signals: [SIGNAL] });
    expect(withSignal.timing.map((x) => x.kind)).toContain("signal");
    expect(withSignal.dimensions.timing).toBe("evidence");
    expect(withSignal.support).toBe(without.support);
    expect(withSignal.dimensions.fit).toBe(without.dimensions.fit);
    expect(withSignal.fitEvidence).toEqual(without.fitEvidence);
    expect(JSON.stringify(withSignal.participants)).not.toContain(SIGNAL.headline);
  });

  test("timing cannot rescue missing fit", () => {
    expect(assess(weakFit(), { relationships: [], signals: [SIGNAL] }).support).toBe("insufficient_evidence");
  });

  test("an event adds relationship/access and timing context, never fit", () => {
    const ctx = { relationships: [rel({ events: [{ eventId: "e1", eventName: "Fictional Expo", status: "met", upcoming: true }] })], signals: [] };
    const b = assess(draft(), ctx);
    expect(b.support).toBe(assess(draft(), EMPTY_CTX).support);
    expect(b.dimensions.access).toBe("via_event");
    expect(b.timing.some((x) => x.kind === "upcoming_event")).toBe(true);
    expect(JSON.stringify(b.fitEvidence)).not.toContain("Fictional Expo");
    expect(assess(weakFit(), ctx).support).toBe("insufficient_evidence");
  });

  test("a relationship changes actionability, never fit", () => {
    const strong = { relationships: [rel({ stage: "conversation", contacts: 2, primaryContactName: "Alex Example", interactions: 5, lastInteractionOn: "2026-09-20" })], signals: [] };
    const b = assess(draft(), strong);
    expect(b.support).toBe(assess(draft(), EMPTY_CTX).support);
    expect(b.dimensions.relationship).toBe("in_conversation");
    expect(b.nextAction.kind).toBe("ask_contact");
    expect(assess(weakFit(), strong).support).toBe("insufficient_evidence");
    // Relationship and timing are informational checks: never pass or fail.
    for (const id of ["timing", "relationship"] as const) expect(b.critic.find((c) => c.id === id)!.result).toBe("info");
  });

  test("no timing evidence is said explicitly, not manufactured", () => {
    const b = assess(draft(), EMPTY_CTX);
    expect(b.timing).toEqual([]);
    expect(b.dimensions.timing).toBe("none");
    expect(b.unknowns.at(-1)!.code).toBe("timing");
  });
});

describe("Opportunity Graph candidates", () => {
  const proj = buildProjection(snapshot());
  const { candidates } = findOpportunityCandidates(proj);
  const capNeed = candidates.find((c) => c.rule === "capability_need" && c.companies.some((x) => x.id === NOVA) && c.companies.some((x) => x.id === BRIGHT))!;
  const missing = candidates.find((c) => c.rule === "missing_piece" && c.companies.some((x) => x.id === CARGO))!;

  test("a graph path stays a connection worth investigating, never a qualified opportunity", () => {
    const b = assess(fromGraph(capNeed, "en"), EMPTY_CTX);
    expect(b.label).toBe("connection_worth_investigating");
    expect(b.workflowStage).toBeNull();
    // The seeker side rests on an inference: not "supported", whatever the topology.
    expect(b.support).not.toBe("supported");
    expect(b.references).toEqual(capNeed.evidence);
  });

  test("graph signals land in WHY NOW; the candidate's fit is unchanged", () => {
    const b = assess(fromGraph(capNeed, "en"), EMPTY_CTX);
    expect(b.timing.every((x) => x.kind === "signal")).toBe(true);
    expect(b.timing.length).toBe(capNeed.context.timing.length);
    const noSignal = findOpportunityCandidates(buildProjection(snapshot(ORG_A, { signals: [] }))).candidates.find((c) => c.id === capNeed.id)!;
    expect(assess(fromGraph(noSignal, "en"), EMPTY_CTX).support).toBe(b.support);
  });

  test("A + B + C: the complement fills the gap, at most partially supported", () => {
    const b = assess(fromGraph(missing, "en"), EMPTY_CTX);
    expect(b.participants.length).toBeGreaterThanOrEqual(3);
    expect(b.participants.find((p) => p.companyId === CARGO)!.role).toBe("complement");
    expect(b.participants.filter((p) => p.role === "participant").length).toBe(2);
    expect(["partially_supported", "needs_validation"]).toContain(b.support);
    expect(b.mechanism.kind).toBe("complement");
  });

  test("questions about the workspace's own need are not sent to anyone", () => {
    const b = assess(fromGraph(capNeed, "en"), EMPTY_CTX);
    for (const u of b.unknowns) expect(u.company).not.toBe("Fictive Own Co");
  });
});

describe("contradictions and the critic", () => {
  test("a company marked Not relevant contradicts the thesis and stops validation", () => {
    const b = assess(draft(), { relationships: [rel({ stage: "not_relevant" })], signals: [SIGNAL] });
    expect(b.support).toBe("contradicted");
    expect(b.contradictions[0].code).toBe("marked_not_relevant");
    expect(b.nextAction).toEqual({ kind: "none", reason: "not_relevant" });
    expect(b.critic.find((c) => c.id === "contradictions")!.result).toBe("fail");
  });

  test("a dormant relationship is an access issue, not a fit contradiction", () => {
    const b = assess(draft(), { relationships: [rel({ stage: "dormant" })], signals: [] });
    expect(b.contradictions.map((c) => [c.code, c.severity])).toContainEqual(["relationship_dormant", "access"]);
    expect(b.support).toBe(assess(draft(), EMPTY_CTX).support);
  });

  test("a weakening contradiction caps support", () => {
    const b = assess(draft({ contradictions: [{ code: "outside_goals", severity: "weakening", text: { literal: "x" } }] }), EMPTY_CTX);
    expect(b.support).toBe("needs_validation");
  });

  test("Search: possible competitor becomes the first thing to check", () => {
    const competitor = own({ offerings: ["Rugged edge servers", "GPU appliances"], soughtCapabilities: ["rugged edge servers"], partnershipGoals: ["supplier"] });
    const a = analyzeRelevance(competitor, HARDWARE_VENDOR);
    const c = [...a.opportunities, ...a.hypotheses, ...a.observations].find((x) => x.relationship === "supplier")!;
    expect(a.insights.length).toBeGreaterThan(0);
    // The Search critic alone passed it; the brief does not let the overlap go unchallenged.
    expect(c.verdict).toBe("pass");
    const b = assess(fromSearch({ candidate: c, profile: HARDWARE_VENDOR, own: competitor, ownCompany: { id: OWN_ID, name: competitor.name }, target: { id: TARGET_ID, name: "Target Systems" }, insights: a.insights, locale: "en" }), EMPTY_CTX);
    expect(b.contradictions.some((x) => x.code === "possible_competitor")).toBe(true);
    expect(b.unknowns[0].code).toBe("competes");
    expect(b.nextAction.kind).toBe("research");
    expect(b.support).toBe("needs_validation");
  });

  test("the critic runs in order and can reject", () => {
    const b = assess(draft({ mechanism: { kind: null, concrete: false, rule: null }, value: null }, [{}, { brings: [], support: "unknown" }]), EMPTY_CTX);
    expect(b.critic.map((c) => c.id)).toEqual(["mechanism", "own_contribution", "other_contribution", "demand", "value", "fit_specific", "contradictions", "critical_unknown", "timing", "relationship"]);
    expect(b.critic.filter((c) => c.result === "fail").length).toBeGreaterThanOrEqual(3);
    expect(b.support).toBe("insufficient_evidence");
  });
});

describe("unknowns, validation questions and the next validation action", () => {
  test("unknowns derive from the mechanism, in decision order", () => {
    const b = searchBriefs(SERVICES_OWN, HARDWARE_VENDOR).find((x) => x.mechanism.rule === "build_for")!;
    const codes = b.unknowns.map((u) => u.code);
    expect(codes[0]).toBe("production_model");
    expect(codes).toContain("manufacturing_partners");
    // The question names the company and the mechanism, not a generic partnership ask.
    const q = say(b.unknowns[0].question);
    expect(q).toContain("Target Systems");
    expect(q.toLowerCase()).not.toContain("interested in a partnership");
  });

  test("the next action targets the critical unknown, through the right channel", () => {
    const q = (x: OpportunityIntelligence) => ("question" in x.nextAction ? say(x.nextAction.question) : null);
    const noContact = assess(draft(), { relationships: [rel({ stage: "identified" })], signals: [] });
    expect(noContact.nextAction.kind).toBe("identify_contact");
    expect(q(noContact)).toBe("Do you outsource assembly?");
    const met = assess(draft(), { relationships: [rel({ events: [{ eventId: "e1", eventName: "Fictional Expo", status: "met", upcoming: false }] })], signals: [] });
    expect(met.nextAction.kind).toBe("follow_up_event");
    const research = assess(draft({ unknowns: [{ code: "deployment_geography", origin: "mechanism", text: { literal: "u" }, question: { literal: "Where?" }, resolve: "research", companyId: TARGET_ID, company: "Target Co" }] }), EMPTY_CTX);
    expect(research.nextAction.kind).toBe("research");
  });

  test("only timing open → watch for a dated reason; nothing open → the team decides", () => {
    expect(assess(draft({ unknowns: [] }), EMPTY_CTX).nextAction.kind).toBe("watch_timing");
    expect(assess(draft({ unknowns: [] }), { relationships: [], signals: [SIGNAL] }).nextAction.kind).toBe("decide");
  });
});

describe("epistemic discipline, evidence and privacy", () => {
  test("FACT / INFERENCE / ASSUMPTION are preserved, never upgraded", () => {
    const b = searchBriefs(SERVICES_OWN, HARDWARE_VENDOR).find((x) => x.mechanism.rule === "build_for")!;
    const claims = new Map(HARDWARE_VENDOR.claims.map((c) => [c.statement, c.epistemic]));
    for (const e of b.fitEvidence.filter((x) => x.origin === "official")) expect(e.status).toBe(claims.get((e.text as { literal: string }).literal)!);
    expect(b.whyBasis).toBe("inference");
    expect(b.fitEvidence.every((e) => e.url === null || e.url.startsWith("https://target.example"))).toBe(true);
    const g = assess(fromGraph(findOpportunityCandidates(buildProjection(snapshot())).candidates[0], "en"), EMPTY_CTX);
    for (const p of g.participants) expect(["fact", "inference", "assumption", "recorded", "unknown"]).toContain(p.support);
  });

  test("no probability, score or revenue figure anywhere in a brief", () => {
    for (const b of [...searchBriefs(SERVICES_OWN, HARDWARE_VENDOR), assess(draft(), { relationships: [rel()], signals: [SIGNAL] })]) {
      const text = JSON.stringify(b);
      expect(text).not.toMatch(/probability|score|revenue|\d+\s?%|[$€£]\s?\d/i);
      expect(SUPPORT_STATES).toContain(b.support);
    }
  });

  test("relationship context is minimized: no contact channel, note or interaction body", () => {
    const r = relationshipFrom({
      company: { id: TARGET_ID, name: "Target Co", stage: "conversation" },
      contacts: [{ name: "Alex Example", isPrimary: true, createdAt: "2026-01-01", email: "alex@target.example", phone: "+33 1 00 00 00 00", notes: "PRIVATE-NOTE" } as never],
      interactions: [{ occurredAt: "2026-09-20T10:00:00Z", summary: "PRIVATE-BODY" } as never],
      followUps: [{ status: "open", description: "PRIVATE-FOLLOWUP" } as never],
      events: [{ event: { id: "e1", name: "Fictional Expo", startsOn: "2026-10-10", description: "PRIVATE-EVENT" } as never, target: { status: "met", prepNotes: "PRIVATE-PREP", why: "PRIVATE-WHY" } as never }],
      today: "2026-09-30",
    });
    const text = JSON.stringify(assess(draft(), { relationships: [r], signals: [] }));
    for (const secret of ["alex@target.example", "+33", "PRIVATE-"]) expect(text).not.toContain(secret);
    expect(r).toMatchObject({ contacts: 1, interactions: 1, lastInteractionOn: "2026-09-20", openFollowUps: 1 });
    expect(r.events[0].upcoming).toBe(true);
  });
});

describe("canonical opportunities (read only)", () => {
  const record = (over: Partial<CanonicalOpportunityRecord> = {}): CanonicalOpportunityRecord => ({
    id: "00000000-0000-4000-8000-0000000000c1",
    title: "Fictional appliance assembly",
    stage: "meeting",
    kind: "multi",
    whyExists: "A sells an appliance; B assembles in Europe.",
    whyNow: "A announced a European launch.",
    structure: "B assembles A's appliance for European customers; C ships it.",
    evidence: [
      { id: "e1", claim: "A sells a fictional appliance", visibility: "public", epistemic: "fact", companyId: "a", marketingLanguage: false },
      { id: "e2", claim: "PRIVATE-AGENT-ONLY claim", visibility: "agent-only", epistemic: "fact", companyId: "b", marketingLanguage: false },
    ],
    assumptions: ["A wants an assembly partner"],
    unknowns: ["Whether A outsources assembly"],
    questions: ["Do you plan to assemble the European version internally or with a partner?"],
    missingCapabilities: [],
    criticVerdict: "pass",
    participants: [
      { companyId: "a", name: "A Co", isOwn: false, role: "vendor", contributions: ["Appliance"] },
      { companyId: "b", name: "B Co", isOwn: true, role: "partner", contributions: ["European assembly"] },
      { companyId: "c", name: "C Co", isOwn: false, role: "partner", contributions: ["Logistics"] },
    ],
    ...over,
  });

  test("workflow stage is kept apart from the support state, and never changed", () => {
    const r = record();
    const b = assess(fromCanonical(r), EMPTY_CTX);
    expect(b.workflowStage).toBe("meeting");
    expect(SUPPORT_STATES as readonly string[]).not.toContain(b.workflowStage);
    expect(r.stage).toBe("meeting");
    expect(b.label).toBe("tracked_opportunity");
    expect(b.participants.length).toBe(3);
    // A recorded contribution with no evidence attached is checked first; the recorded question follows.
    expect(b.unknowns[0].code).toBe("side_no_evidence");
    expect(b.unknowns.some((u) => say(u.question).includes("assemble the European version"))).toBe(true);
  });

  test("agent-only / private evidence never appears", () => {
    expect(JSON.stringify(assess(fromCanonical(record()), EMPTY_CTX))).not.toContain("PRIVATE-AGENT-ONLY");
  });

  test("recorded missing capabilities weaken the thesis", () => {
    const b = assess(fromCanonical(record({ missingCapabilities: ["logistics"] })), EMPTY_CTX);
    expect(b.contradictions.some((c) => c.code === "missing_capability")).toBe(true);
    expect(b.support).not.toBe("supported");
  });
});

describe("company view, isolation and no side effects", () => {
  test("weak/empty state is truthful: no brief is invented", () => {
    const x = companyIntelligence({ drafts: [], context: EMPTY_CTX, hasAnalysis: false, analysisStatus: null, hasGraphPattern: false });
    expect(x.briefs).toEqual([]);
    expect(x.reasons).toEqual(["no_analysis", "no_graph_pattern"]);
    expect(companyIntelligence({ drafts: [], context: EMPTY_CTX, hasAnalysis: true, analysisStatus: "own_profile_missing", hasGraphPattern: false }).reasons[0]).toBe("own_profile_missing");
  });

  test("tracked opportunities come first; then support; no rank numbers", () => {
    const x = companyIntelligence({
      drafts: [draft({ id: "s:weak" }, [{}, { brings: [], support: "unknown" }]), draft({ id: "s:strong" }), fromCanonical({ id: "c1", title: "T", stage: "discovered", kind: "customer", whyExists: "", whyNow: "", structure: "", evidence: [], assumptions: [], unknowns: [], questions: [], missingCapabilities: [], criticVerdict: null, participants: [] })],
      context: EMPTY_CTX,
      hasAnalysis: true,
      analysisStatus: "opportunities",
      hasGraphPattern: false,
    });
    expect(x.briefs.map((b) => b.id)).toEqual(["canonical:c1", "s:strong", "s:weak"]);
  });

  test("organization isolation: another workspace's context never attaches", () => {
    const a = findOpportunityCandidates(buildProjection(snapshot(ORG_A))).candidates[0];
    const foreign = { relationships: [rel({ companyId: "11111111-1111-4111-8111-111111111111", primaryContactName: "Foreign Person" })], signals: [{ ...SIGNAL, companyId: "11111111-1111-4111-8111-111111111111", headline: "FOREIGN-SIGNAL" }] };
    const b = assess(fromGraph(a, "en"), foreign);
    expect(JSON.stringify(b)).not.toContain("FOREIGN");
    expect(JSON.stringify(b)).not.toContain("Foreign Person");
    // The same fictional company in two workspaces produces distinct candidate paths.
    const bOrg = findOpportunityCandidates(buildProjection(snapshot(ORG_B))).candidates[0];
    expect(bOrg.path.nodes.every((k) => k.startsWith(ORG_B))).toBe(true);
  });

  test("assessing is pure: inputs are not mutated and nothing is created, qualified or sent", () => {
    const d = draft();
    const before = JSON.stringify(d);
    const ctx = { relationships: [rel({ stage: "identified" })], signals: [SIGNAL] };
    const b1 = assess(d, ctx);
    const b2 = assess(d, ctx);
    expect(JSON.stringify(d)).toBe(before);
    expect(b1).toEqual(b2);
    expect(ctx.relationships[0].stage).toBe("identified");
    expect(["send_email", "send_message", "create_opportunity", "qualify"]).not.toContain(b1.nextAction.kind);
  });

  test("Phase 6 relationship NBA is unchanged and distinct from the validation action", () => {
    const nba = nextBestAction({ stage: "identified", contacts: [], interactions: [], followUps: [], validationQuestion: null, today: "2026-09-30" });
    expect(nba.kind).toBe("add_contact");
    const b = assess(draft(), { relationships: [rel({ stage: "identified" })], signals: [] });
    expect(b.nextAction.kind).toBe("identify_contact");
    expect("question" in b.nextAction).toBe(true);
  });
});

describe("FR / EN", () => {
  test("the same brief is worded in each language without mixing", () => {
    const en = searchBriefs(SERVICES_OWN, HARDWARE_VENDOR, EMPTY_CTX, "en").find((x) => x.mechanism.rule === "build_for")!;
    const fr = searchBriefs(SERVICES_OWN, HARDWARE_VENDOR, EMPTY_CTX, "fr").find((x) => x.mechanism.rule === "build_for")!;
    expect(say(en.unknowns[0].question, "en")).not.toBe(say(fr.unknowns[0].question, "fr"));
    expect(say(fr.value!, "fr")).toContain("pourrait");
    expect(say(en.value!, "en")).toContain("could");
  });
});

describe("human review correction: goal compatibility never upgrades evidence", () => {
  // Fictional: a services company that integrates, configures, tests and deploys other companies' hardware.
  const INTEGRATOR = own({
    name: "Integrator Co (fictional)",
    offerings: ["Hardware integration, system configuration, testing and deployment support"],
    customerSegments: ["Technology companies selling servers"],
    geographies: ["Europe"],
    partnershipGoals: ["customer", "technology_partner", "oem", "strategic"],
  });

  test("the build mechanism is aligned with OEM/ODM or customer goals, as a hypothesis-grade brief, not Supported", () => {
    const a = analyzeRelevance(INTEGRATOR, HARDWARE_VENDOR);
    const c = [...a.opportunities, ...a.hypotheses, ...a.observations].find((x) => x.rule === "build_for")!;
    expect(c.relationship).toBe("integration");
    expect(c.aligned).toBe(true);
    expect(a.observations.some((x) => x.rule === "build_for")).toBe(false);
    expect(c.checks.find((k) => k.id === "goal_fit")!.code).toBe("aligned");
    // The most important missing fact is whether the target uses an external partner for these services.
    expect(c.validation[0]).toBe("outsourced_services");

    const b = assess(fromSearch({ candidate: c, profile: HARDWARE_VENDOR, own: INTEGRATOR, ownCompany: { id: OWN_ID, name: INTEGRATOR.name }, target: { id: TARGET_ID, name: "Target Systems" }, insights: a.insights, locale: "en" }), EMPTY_CTX);
    expect(b.contradictions.some((x) => x.code === "outside_goals")).toBe(false);
    expect(b.support).not.toBe("supported");
    expect(["partially_supported", "needs_validation"]).toContain(b.support);
    expect(b.critic.find((k) => k.id === "demand")).toMatchObject({ result: "warn", code: "unestablished" });
    expect(b.unknowns[0]).toMatchObject({ code: "outsourced_services", resolve: "ask" });
    const q = say(b.unknowns[0].question);
    expect(q).toContain("Target Systems");
    expect(q).toContain("external partner");
    expect(b.label).not.toBe("tracked_opportunity");
    expect(b.workflowStage).toBeNull();
  });

  test("the same target-side facts with a declared need on our side stay supportable (demand established)", () => {
    const seeker = own({ offerings: ["System integration"], soughtCapabilities: ["rugged edge servers"], partnershipGoals: ["supplier"] });
    const a = analyzeRelevance(seeker, HARDWARE_VENDOR);
    const c = [...a.opportunities, ...a.hypotheses].find((x) => x.rule === "sought_capability")!;
    const b = assess(fromSearch({ candidate: c, profile: HARDWARE_VENDOR, own: seeker, ownCompany: { id: OWN_ID, name: seeker.name }, target: { id: TARGET_ID, name: "Target Systems" }, insights: [], locale: "en" }), EMPTY_CTX);
    expect(b.critic.find((k) => k.id === "demand")!.result).toBe("pass");
  });

  test("demand not established caps support at partial, whatever the timing or relationship", () => {
    const ctx = { relationships: [rel({ stage: "conversation", contacts: 1, primaryContactName: "Alex Example", interactions: 3 })], signals: [SIGNAL] };
    expect(assess(draft({ demandEstablished: false }), ctx).support).toBe("partially_supported");
    expect(assess(draft({ demandEstablished: true }), ctx).support).toBe("supported");
  });
});
