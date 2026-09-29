/**
 * Orchestration module: bilateral consent, Business Match, meeting preparation
 * and lifecycle/outcome tracking. Consent responses are private: nothing here
 * exposes one participant's response to another until every participant is
 * interested.
 */
import type {
  Consent,
  ConsentResponse,
  LifecycleStage,
  MeetingBrief,
  Opportunity,
  ParticipantRole,
  World,
} from "@/lib/domain/types";
import { lowerFirst } from "./context";
import { logActivity } from "./pipeline";

export function participants(world: World, opp: Opportunity): string[] {
  const ids = opp.relationshipIds.flatMap((r) => world.relationships[r]?.personIds ?? []);
  return [...new Set(ids)].filter((p) => opp.companyIds.includes(world.people[p].companyId));
}

export function consentOf(world: World, oppId: string, personId: string): Consent | undefined {
  return world.consents.find((c) => c.opportunityId === oppId && c.personId === personId);
}

/** Matched once every participant was interested, even if later parked. */
export function isMatched(opp: Pick<Opportunity, "stageHistory">): boolean {
  return opp.stageHistory.some((h) => h.stage === "mutual-interest");
}

/** Lifecycle stage as seen by one participant. Others' private responses never leak into it. */
export function stageFor(world: World, opp: Opportunity, viewerId: string): LifecycleStage {
  if (isMatched(opp) || opp.stage === "rejected") return opp.stage;
  const mine = consentOf(world, opp.id, viewerId)?.response;
  if (mine === "interested") return "interested";
  if (mine === "not-now") return "dormant";
  if (mine === "not-relevant" || mine === "never") return "rejected";
  return opp.stage;
}

function recordOutcome(world: World, opp: Opportunity, stage: LifecycleStage, reason: string) {
  opp.stage = stage;
  opp.stageHistory = [...opp.stageHistory, { stage, at: world.now, reason }];
  world.outcomes = [...world.outcomes, { id: `out-${world.outcomes.length + 1}`, opportunityId: opp.id, stage, reason, recordedAt: world.now }];
}

export interface RespondResult {
  world: World;
  matched: boolean;
}

export function respond(input: World, oppId: string, personId: string, response: ConsentResponse): RespondResult {
  const world = structuredClone(input);
  const opp = world.opportunities[oppId];
  if (!opp || isMatched(opp)) return { world, matched: false };
  world.consents = [
    ...world.consents.filter((c) => !(c.opportunityId === oppId && c.personId === personId)),
    { opportunityId: oppId, personId, response, respondedAt: world.now, visibility: "private" },
  ];
  const person = world.people[personId];
  logActivity(world, "orchestration", `${person.name} responded privately to "${opp.title}"`, [oppId]);

  const everyone = participants(world, opp);
  const allIn = everyone.every((p) => consentOf(world, oppId, p)?.response === "interested");
  if (allIn) {
    recordOutcome(world, opp, "mutual-interest", "Every participant independently responded Interested.");
    world.briefs[oppId] = buildBrief(world, opp);
    for (const r of opp.relationshipIds) world.relationships[r].status = "matched";
    logActivity(world, "orchestration", `Business Match: ${opp.title}. Meeting brief prepared.`, [oppId]);
  }
  if (response === "never") {
    logActivity(world, "orchestration", `${person.name}'s agent will not suggest ${opp.patternId} structures with these companies again`, [oppId]);
  }
  return { world, matched: allIn };
}

const NEXT: Partial<Record<LifecycleStage, LifecycleStage>> = {
  "mutual-interest": "meeting",
  meeting: "qualified",
  qualified: "pilot",
  pilot: "partnership",
  partnership: "revenue",
};

export function nextStage(stage: LifecycleStage): LifecycleStage | undefined {
  return NEXT[stage];
}

export function advance(input: World, oppId: string, to: LifecycleStage, reason: string): World {
  const world = structuredClone(input);
  const opp = world.opportunities[oppId];
  if (!opp) return world;
  recordOutcome(world, opp, to, reason);
  logActivity(world, "orchestration", `${opp.title} → ${to.replace("-", " ")}: ${reason}`, [oppId]);
  return world;
}

const SUGGESTED_ROLE: Record<ParticipantRole, { role: string; why: string }> = {
  "software-vendor": { role: "Head of Engineering", why: "Owns runtime porting and hardware certification." },
  "hardware-partner": { role: "Product Manager, Edge Systems", why: "Owns reference designs, SKUs and volume planning." },
  vendor: { role: "Solutions Architect", why: "Answers pre-sales and deployment questions." },
  distributor: { role: "Channel Partner Manager", why: "Owns reseller enablement and margins." },
  seller: { role: "Account Executive", why: "Runs the commercial process." },
  buyer: { role: "Budget Owner", why: "Decides on pilot funding." },
  partner: { role: "Partnership Lead", why: "Coordinates the partnership." },
};

export function buildBrief(world: World, opp: Opportunity): MeetingBrief {
  const people = participants(world, opp).map((id) => world.people[id]);
  const name = (companyId: string) => world.companies[companyId].name;
  const owner = (companyId: string) => people.find((p) => p.companyId === companyId)?.name ?? name(companyId);
  const multi = opp.companyIds.length > 2;
  const firstSentence = opp.structure.split(". ")[0].replace(/\.$/, "");

  return {
    opportunityId: opp.id,
    createdAt: world.now,
    title: `${opp.title} — ${multi ? "working session" : "discovery call"}`,
    duration: multi ? "60 minutes" : "30 minutes",
    objective: `Test whether the proposed structure holds (${firstSentence}) and agree whether to scope a pilot.`,
    agenda: [
      { item: "Why the agents matched you: needs and timing", minutes: 5, owner: "ORQO brief" },
      ...opp.contributions.map((c) => ({ item: `${name(c.companyId)}: ${c.items.slice(0, 3).join(", ")}`, minutes: multi ? 10 : 7, owner: owner(c.companyId) })),
      { item: `Open questions: ${opp.unknowns.slice(0, 3).map(lowerFirst).join("; ")}`, minutes: multi ? 15 : 7, owner: "All" },
      { item: "Decision: pilot scope, owners and next date", minutes: 4, owner: "All" },
    ],
    keyQuestions: opp.questions,
    stakeholders: [
      ...people.map((p) => ({ personId: p.id, name: p.name, role: p.role, companyId: p.companyId, why: "Relationship owner; responded Interested." })),
      ...opp.companyIds.map((cid) => {
        const s = SUGGESTED_ROLE[opp.roles[cid] ?? "partner"];
        return { name: `${s.role} (suggested)`, role: s.role, companyId: cid, why: s.why };
      }),
    ],
    brief: `${opp.summary} ${opp.whyNow}`,
    nextActions: [
      ...opp.contributions.map((c) => ({ action: `Share ${c.items[0] ? lowerFirst(c.items[0]) : "requirements"} details and constraints before the call`, ownerCompanyId: c.companyId })),
      { action: "Confirm a time — ORQO proposes the next two open slots for all participants", ownerCompanyId: opp.companyIds[0] },
    ],
  };
}
