/**
 * Phase 10 — Opportunity Graph: projection, candidates and bounds. Fictional
 * workspaces and companies only (no real workspace, prospect or person).
 */
import { describe, expect, test } from "bun:test";
import { findOpportunityCandidates } from "./candidates";
import { NEIGHBORHOOD_LIMITS, neighborhood } from "./neighborhood";
import { BRIGHT, CARGO, EVENT, id, NOVA, OPP, ORG_A, ORG_B, OWN, snapshot } from "./fixtures";
import { buildProjection, nodeKey, PROJECTION_VERSION } from "./projection";

const k = (org: string, kind: Parameters<typeof nodeKey>[1], cid: string) => nodeKey(org, kind, cid);

describe("projection", () => {
  test("deterministic and idempotent: same snapshot → identical graph, no duplicates", () => {
    const a = buildProjection(snapshot());
    const b = buildProjection(snapshot());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(new Set(a.nodes.map((n) => n.key)).size).toBe(a.nodes.length);
    expect(new Set(a.edges.map((e) => e.key)).size).toBe(a.edges.length);
    expect(a.version).toBe(PROJECTION_VERSION);
    // Input order does not change the output.
    const s = snapshot();
    const shuffled = buildProjection({ ...s, companies: [...s.companies].reverse(), signals: [...s.signals].reverse() });
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(a));
  });

  test("identities are organization id + canonical record id, never names or domains", () => {
    const p = buildProjection(snapshot());
    for (const n of p.nodes) {
      expect(n.key).toBe(`${ORG_A}/${n.kind}/${n.canonicalId}`);
      expect(n.organizationId).toBe(ORG_A);
    }
    expect(p.nodes.find((n) => n.kind === "company" && n.canonicalId === NOVA)?.canonicalTable).toBe("companies");
    expect(p.nodes.some((n) => n.key.includes("nova.example") || n.key.includes("Nova"))).toBe(false);
  });

  test("the same real-world company in two workspaces stays two isolated nodes", () => {
    const a = buildProjection(snapshot(ORG_A));
    const b = buildProjection(snapshot(ORG_B));
    const keysA = new Set(a.nodes.map((n) => n.key));
    expect(b.nodes.some((n) => keysA.has(n.key))).toBe(false);
    for (const e of b.edges) {
      expect(e.from.startsWith(`${ORG_B}/`)).toBe(true);
      expect(e.to.startsWith(`${ORG_B}/`)).toBe(true);
    }
  });

  test("no private CRM data: contact channels, notes and interaction text have no path into the graph", () => {
    const p = buildProjection(snapshot());
    const text = JSON.stringify(p);
    for (const forbidden of ["@", "+33", "notes", "prep", "summary", "why"]) expect(text.includes(forbidden)).toBe(false);
    expect(p.nodes.some((n) => (n.kind as string) === "contact")).toBe(false);
    // Relationship context is structural: stage, a day, a count.
    const nova = p.nodes.find((n) => n.key === k(ORG_A, "company", NOVA))!;
    expect(nova.attrs).toEqual({ isOwnCompany: false, domain: "nova.example", stage: "conversation", lastInteractionOn: "2026-09-20", openFollowUps: 2 });
  });

  test("provenance references canonical records and evidence; no excerpts are copied", () => {
    const p = buildProjection(snapshot());
    const has = p.edges.find((e) => e.kind === "HAS_CAPABILITY" && e.to === k(ORG_A, "capability", id(10)))!;
    expect(has.provenance).toEqual([`company_capabilities:${id(10)}`, `sources:${id(90)}`]);
    const offers = p.edges.find((e) => e.kind === "OFFERS" && e.from === k(ORG_A, "company", NOVA))!;
    expect(offers.basis).toBe("evidence_store");
    expect(offers.provenance).toContain(`evidence_items:${id(31)}`);
    expect(offers.provenance).toContain(`company_intelligence:${id(30)}`);
    expect(offers.attrs.selfDescribed).toBe(1);
    const about = p.edges.find((e) => e.kind === "ABOUT")!;
    expect(about.provenance).toEqual([`company_signals:${id(40)}`, `sources:${id(94)}`]);
    const met = p.edges.find((e) => e.kind === "MET_AT")!;
    expect(met.provenance).toEqual([`event_companies:${id(51)}`]);
  });

  test("FACT / INFERENCE / ASSUMPTION are preserved; UNKNOWN never becomes an edge", () => {
    const p = buildProjection(snapshot());
    expect(p.edges.find((e) => e.kind === "HAS_CAPABILITY" && e.to === k(ORG_A, "capability", id(10)))?.epistemic).toBe("fact");
    expect(p.edges.find((e) => e.kind === "HAS_NEED")?.epistemic).toBe("inference");
    expect(p.edges.find((e) => e.kind === "OFFERS" && e.from === k(ORG_A, "company", NOVA))?.epistemic).toBe("inference");
    expect(p.edges.find((e) => e.kind === "MISSING")?.epistemic).toBe("inference");
    // The "unknown" need claim (robotics) is a gap, not a SEEKS edge.
    expect(p.edges.some((e) => e.kind === "SEEKS" && e.to.endsWith("concept:robotics"))).toBe(false);
    // Non-fit evidence fields (industry) and generic concepts (software) are not projected as fit claims.
    expect(p.nodes.some((n) => n.canonicalId === "concept:defense" || n.canonicalId === "concept:software")).toBe(false);
    // Unknown vocabulary tags are dropped.
    expect(p.nodes.some((n) => n.canonicalId === "tag:not-a-tag")).toBe(false);
  });

  test("a partner-program openness claim (need field, no concepts) never becomes a SEEKS edge", () => {
    const s = snapshot();
    const p = buildProjection({ ...s, evidenceItems: [...s.evidenceItems, { id: id(34), intelligenceId: id(30), sourceId: id(93), field: "need", epistemic: "inference", concepts: [], selfDescribed: true }] });
    expect(p.edges.some((e) => e.kind === "SEEKS" && e.from === k(ORG_A, "company", NOVA))).toBe(false);
  });

  test("dismissed signals are not projected; signals attach to companies only, never to concepts", () => {
    const p = buildProjection(snapshot());
    expect(p.nodes.some((n) => n.canonicalId === id(41))).toBe(false);
    const signalEdges = p.edges.filter((e) => e.from.includes("/signal/") || e.to.includes("/signal/"));
    expect(signalEdges.every((e) => e.kind === "ABOUT" && e.to.includes("/company/"))).toBe(true);
  });

  test("stale data disappears: a deleted canonical row is absent from the next projection", () => {
    const before = buildProjection(snapshot());
    const after = buildProjection(snapshot(ORG_A, { capabilities: snapshot().capabilities.filter((c) => c.companyId !== CARGO) }));
    expect(before.nodes.some((n) => n.canonicalId === id(11))).toBe(true);
    expect(after.nodes.some((n) => n.canonicalId === id(11))).toBe(false);
    expect(after.edges.some((e) => e.to === k(ORG_A, "capability", id(11)))).toBe(false);
  });
});

describe("candidates", () => {
  test("capability ↔ need surfaces a cautious candidate with unknowns and context, deterministically", () => {
    const p = buildProjection(snapshot());
    const first = findOpportunityCandidates(p);
    expect(JSON.stringify(findOpportunityCandidates(buildProjection(snapshot())))).toBe(JSON.stringify(first));
    const c = first.candidates.find((x) => x.id === `capability_need:${NOVA}:${BRIGHT}`)!;
    expect(c.rule).toBe("capability_need");
    // Provider side is a fact, seeker side an inference → partial, never "supported".
    expect(c.support).toBe("partial");
    expect(c.concepts.map((x) => x.term)).toEqual(["computer-vision"]);
    expect(c.unknowns.map((u) => u.key)).toEqual(expect.arrayContaining(["need_current", "offer_fit", "side_not_fact", "no_relationship"]));
    expect(c.evidence).toContain(`sources:${id(90)}`);
    expect(c.path.nodes).toContain(k(ORG_A, "concept", "tag:computer-vision"));
    // Timing and event context are attached, separately from fit.
    expect(c.context.timing.map((t) => t.signalId)).toEqual([id(40)]);
    expect(c.context.events.map((e) => e.status).sort()).toEqual(["met", "targeted"]);
  });

  test("a signal changes timing context, never fit support or order", () => {
    const withSignal = findOpportunityCandidates(buildProjection(snapshot()));
    const without = findOpportunityCandidates(buildProjection(snapshot(ORG_A, { signals: [] })));
    const strip = (r: typeof withSignal) => r.candidates.map((c) => [c.id, c.support, c.concepts.length]);
    expect(strip(withSignal)).toEqual(strip(without));
    // A signal alone (no capability/need) creates nothing.
    const onlySignals = snapshot(ORG_A, { capabilities: [], needs: [], evidenceItems: [], opportunities: [], companies: snapshot().companies.map((c) => ({ ...c, offerings: [], soughtCapabilities: [] })) });
    expect(findOpportunityCandidates(buildProjection(onlySignals)).total).toBe(0);
  });

  test("event attendance alone and an existing relationship alone do not create fit", () => {
    const s = snapshot(ORG_A, {
      capabilities: [],
      needs: [],
      evidenceItems: [],
      opportunities: [],
      companies: snapshot().companies.map((c) => ({ ...c, offerings: [], soughtCapabilities: [], networkStage: c.isOwnCompany ? null : "customer_partner" })),
      eventTargets: [
        { id: id(51), eventId: EVENT, companyId: NOVA, status: "met", priority: "high", attendance: "expected" },
        { id: id(52), eventId: EVENT, companyId: BRIGHT, status: "met", priority: "high", attendance: "expected" },
      ],
      activity: [{ companyId: NOVA, lastInteractionOn: "2026-09-29", openFollowUps: 3 }],
    });
    expect(findOpportunityCandidates(buildProjection(s)).total).toBe(0);
  });

  test("relationship context only breaks ties; it never changes support", () => {
    const base = findOpportunityCandidates(buildProjection(snapshot())).candidates.find((c) => c.rule === "capability_need" && c.companies[1].id === BRIGHT)!;
    const closer = snapshot(ORG_A, { companies: snapshot().companies.map((c) => (c.id === BRIGHT ? { ...c, networkStage: "customer_partner" } : c)) });
    const after = findOpportunityCandidates(buildProjection(closer)).candidates.find((c) => c.id === base.id)!;
    expect(after.support).toBe(base.support);
  });

  test("A + B + C: a recorded missing capability and a non-participant's tagged capability → missing_piece", () => {
    const r = findOpportunityCandidates(buildProjection(snapshot()));
    const c = r.candidates.find((x) => x.rule === "missing_piece")!;
    expect(c.id).toBe(`missing_piece:${OPP}:${CARGO}`);
    expect(c.companies.map((x) => [x.id, x.role])).toEqual([
      [OWN, "participant"],
      [NOVA, "participant"],
      [CARGO, "complement"],
    ]);
    expect(c.opportunity).toEqual({ id: OPP, title: "Fictional OEM bundle" });
    // The gap is an engine inference: a missing piece is never "supported".
    expect(c.support).toBe("partial");
    expect(c.unknowns.map((u) => u.key)).toEqual(expect.arrayContaining(["complement_fit", "partner_interest"]));
  });

  test("pairs already tracked in a canonical opportunity, and companies marked not relevant, are not resurfaced", () => {
    // OWN and NOVA already share OPP; give OWN a need NOVA can meet.
    const s = snapshot(ORG_A, { needs: [...snapshot().needs, { id: id(21), companyId: OWN, label: "Vision", tags: ["computer-vision"], intensity: "active", visibility: "public", evidence: [] }] });
    expect(findOpportunityCandidates(buildProjection(s)).candidates.some((c) => c.id === `capability_need:${NOVA}:${OWN}`)).toBe(false);
    const dismissed = snapshot(ORG_A, { companies: snapshot().companies.map((c) => (c.id === BRIGHT ? { ...c, networkStage: "not_relevant" } : c)) });
    expect(findOpportunityCandidates(buildProjection(dismissed)).candidates.some((c) => c.companies.some((x) => x.id === BRIGHT))).toBe(false);
  });

  test("candidates are bounded and can be scoped to one company", () => {
    const r = findOpportunityCandidates(buildProjection(snapshot()), { limit: 1000 });
    expect(r.candidates.length).toBeLessThanOrEqual(20);
    const scoped = findOpportunityCandidates(buildProjection(snapshot()), { involving: CARGO });
    expect(scoped.candidates.every((c) => c.companies.some((x) => x.id === CARGO))).toBe(true);
  });

  test("candidate discovery is pure: no network or provider is reachable", () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("no network in graph rules");
    }) as unknown as typeof fetch;
    try {
      findOpportunityCandidates(buildProjection(snapshot()));
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });
});

describe("neighborhood bounds", () => {
  test("bounded depth, per-layer and total node counts; unknown focus → null", () => {
    const companies = Array.from({ length: 80 }, (_, i) => ({ id: id(1000 + i), name: `Fictional ${i}`, domain: null, isOwnCompany: false, networkStage: null, offerings: [], soughtCapabilities: [] }));
    const capabilities = companies.map((c, i) => ({ id: id(2000 + i), companyId: c.id, label: "Vision", tags: ["computer-vision"], visibility: "public", evidence: [] }));
    const p = buildProjection(snapshot(ORG_A, { companies, capabilities, needs: [], evidenceItems: [], opportunities: [], signals: [], eventTargets: [], activity: [] }));
    const n = neighborhood(p, k(ORG_A, "company", companies[0].id), { maxDepth: 99, maxNodes: 999, maxPerLayer: 999 })!;
    expect(n.nodes.length).toBeLessThanOrEqual(NEIGHBORHOOD_LIMITS.maxNodes);
    expect(Math.max(...n.nodes.map((x) => x.depth))).toBeLessThanOrEqual(NEIGHBORHOOD_LIMITS.maxDepth);
    expect(n.omitted).toBeGreaterThan(0);
    expect(n.edges.every((e) => n.nodes.some((x) => x.key === e.from) && n.nodes.some((x) => x.key === e.to))).toBe(true);
    expect(neighborhood(p, `${ORG_B}/company/${companies[0].id}`)).toBeNull();
  });
});
