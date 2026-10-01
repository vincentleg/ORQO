/**
 * Fictional Opportunity Graph fixtures for tests (Phase 10). No real
 * workspace, company or person.
 */
import type { CanonicalSnapshot } from "./projection";

export const ORG_A = "0a000000-0000-4000-8000-00000000000a";
export const ORG_B = "0b000000-0000-4000-8000-00000000000b";
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const OWN = id(1);
export const NOVA = id(2); // fictional provider: computer vision, with a fact
export const BRIGHT = id(3); // fictional seeker: needs computer vision (inference)
export const CARGO = id(4); // fictional logistics company
export const EVENT = id(50);
export const OPP = id(60);

/** A fictional workspace snapshot. Private fields do not exist on the type; the test below proves none leak via labels either. */
export function snapshot(org = ORG_A, over: Partial<CanonicalSnapshot> = {}): CanonicalSnapshot {
  return {
    organizationId: org,
    truncated: false,
    companies: [
      { id: OWN, name: "Fictive Own Co", domain: "own.example", isOwnCompany: true, networkStage: null, offerings: ["Rugged servers"], soughtCapabilities: ["European distribution partners"] },
      { id: NOVA, name: "Nova Vision (fictional)", domain: "nova.example", isOwnCompany: false, networkStage: "conversation", offerings: [], soughtCapabilities: [] },
      { id: BRIGHT, name: "Bright Retail (fictional)", domain: "bright.example", isOwnCompany: false, networkStage: null, offerings: [], soughtCapabilities: [] },
      { id: CARGO, name: "Cargo Line (fictional)", domain: null, isOwnCompany: false, networkStage: "identified", offerings: [], soughtCapabilities: [] },
    ],
    capabilities: [
      { id: id(10), companyId: NOVA, label: "Vision analytics", tags: ["computer-vision", "not-a-tag"], visibility: "public", evidence: [{ sourceId: id(90), epistemic: "fact" }] },
      { id: id(11), companyId: CARGO, label: "EU logistics", tags: ["logistics"], visibility: "public", evidence: [{ sourceId: id(91), epistemic: "fact" }] },
    ],
    needs: [{ id: id(20), companyId: BRIGHT, label: "Shelf vision", tags: ["computer-vision"], intensity: "active", visibility: "public", evidence: [{ sourceId: id(92), epistemic: "inference" }] }],
    intelligence: [{ id: id(30), domain: "nova.example", researchedAt: "2026-09-01T00:00:00.000Z" }],
    evidenceItems: [
      { id: id(31), intelligenceId: id(30), sourceId: id(93), field: "offering", epistemic: "inference", concepts: ["distribution", "software"], selfDescribed: true },
      { id: id(32), intelligenceId: id(30), sourceId: null, field: "industry", epistemic: "fact", concepts: ["defense"], selfDescribed: false },
      { id: id(33), intelligenceId: id(30), sourceId: null, field: "need", epistemic: "unknown", concepts: ["robotics"], selfDescribed: false },
    ],
    opportunities: [{ id: OPP, title: "Fictional OEM bundle", stage: "discovered", kind: "reciprocal", confidence: "moderate", missingCapabilities: ["logistics"], participants: [{ companyId: OWN, role: "vendor" }, { companyId: NOVA, role: "partner" }] }],
    signals: [
      { id: id(40), companyId: BRIGHT, kind: "geographic_expansion", headline: "Bright Retail opens fictional stores", status: "new", epistemic: "fact", evidenceQuality: "strong", sourceAuthority: "official", sourceId: id(94), publishedOn: "2026-09-10" },
      { id: id(41), companyId: BRIGHT, kind: "hiring", headline: "Dismissed fictional signal", status: "dismissed", epistemic: "fact", evidenceQuality: "limited", sourceAuthority: "third_party", sourceId: null, publishedOn: null },
    ],
    events: [{ id: EVENT, name: "Fictional Expo", startsOn: "2026-10-10", endsOn: null, archived: false }],
    eventTargets: [
      { id: id(51), eventId: EVENT, companyId: NOVA, status: "met", priority: "high", attendance: "expected" },
      { id: id(52), eventId: EVENT, companyId: BRIGHT, status: "targeted", priority: "medium", attendance: "unknown" },
    ],
    activity: [{ companyId: NOVA, lastInteractionOn: "2026-09-20", openFollowUps: 2 }],
    ...over,
  };
}
