/**
 * Multi-Company Discovery / Graph module. For live opportunities that are missing
 * a capability someone urgently needs, search the viewer's network for a
 * company that provides it, and compose an N-way opportunity.
 */
import type {
  CandidateScan,
  Company,
  Contribution,
  NetworkProposal,
  Opportunity,
  OpportunityEvidence,
  ParticipantRole,
  Signal,
  World,
} from "@/lib/domain/types";
import { tagLabel, type Tag } from "@/lib/domain/taxonomy";
import { capabilitiesWith, evidenceFromCapability, isUrgent, listOf, lowerFirst, offersAny, uniq } from "./context";
import { critique } from "./critic";
import { buildWhyNow, type DrivingNeed, type OpportunityDraft } from "./patterns";
import { logActivity, opportunityId, toOpportunity } from "./pipeline";

const LIVE = new Set<Opportunity["stage"]>(["discovered", "interested", "mutual-interest", "meeting", "qualified", "pilot", "partnership", "revenue"]);
const DISTRIBUTION: Tag[] = ["eu-enterprise-distribution", "channel-sales", "us-enterprise-distribution"];

export function networkCompanies(world: World, personId: string): Company[] {
  const ids = Object.values(world.relationships)
    .filter((r) => r.personIds.includes(personId))
    .flatMap((r) => r.companyIds);
  const own = world.people[personId].companyId;
  return uniq(ids)
    .filter((id) => id !== own)
    .map((id) => world.companies[id]);
}

interface Gap {
  opportunity: Opportunity;
  tag: Tag;
  ownerId: string;
}

/** Missing capabilities that a participant urgently needs. Exploratory gaps are noted but not pursued. */
function urgentGaps(world: World): Gap[] {
  const gaps: Gap[] = [];
  for (const opp of Object.values(world.opportunities)) {
    if (!LIVE.has(opp.stage) || opp.kind === "multi") continue;
    for (const tag of opp.missingCapabilities) {
      const owner = opp.companyIds.find((id) => world.companies[id].needs.some((n) => n.tags.includes(tag) && isUrgent(n)));
      if (owner && !gaps.some((g) => g.opportunity.id === opp.id && g.ownerId === owner)) gaps.push({ opportunity: opp, tag, ownerId: owner });
    }
  }
  return gaps;
}


function mergeContributions(opps: Opportunity[], filler: Company, fillerRole: ParticipantRole, fillerItems: string[]): Contribution[] {
  const byCompany = new Map<string, Contribution>();
  for (const c of opps.flatMap((o) => o.contributions)) {
    const prev = byCompany.get(c.companyId);
    byCompany.set(c.companyId, prev ? { ...prev, items: uniq([...prev.items, ...c.items]) } : { ...c });
  }
  if (!byCompany.has(filler.id)) byCompany.set(filler.id, { companyId: filler.id, role: fillerRole, items: fillerItems });
  return [...byCompany.values()];
}

function composeDraft(world: World, base: Opportunity, related: Opportunity | undefined, filler: Company, gap: Gap): OpportunityDraft {
  const participants = uniq([...base.companyIds, filler.id]);
  const companies = participants.map((id) => world.companies[id]);
  const fillCap = capabilitiesWith(filler, [gap.tag])[0];
  const owner = world.companies[gap.ownerId];
  const isDistribution = DISTRIBUTION.includes(gap.tag);
  const fillerRole: ParticipantRole = related?.roles[filler.id] ?? (isDistribution ? "distributor" : "partner");
  const sources = related ? [base, related] : [base];
  const roles = Object.assign({}, ...sources.map((o) => o.roles), { [filler.id]: fillerRole }) as Record<string, ParticipantRole>;

  const needIds = uniq(sources.flatMap((o) => o.drivingNeedIds));
  const drivingNeeds: DrivingNeed[] = companies.flatMap((c) =>
    c.needs.filter((n) => needIds.includes(n.id) || (n.tags.includes(gap.tag) && c.id === owner.id)).map((need) => ({ companyId: c.id, need })),
  );
  const seen = new Set<string>();
  const evidence: Omit<OpportunityEvidence, "id">[] = [
    ...sources.flatMap((o) => o.evidence.map(({ id: _id, ...rest }) => rest)),
    ...evidenceFromCapability(filler, fillCap),
  ].filter((e) => (seen.has(e.claim) ? false : (seen.add(e.claim), true)));

  const relatedGap = related?.missingCapabilities.find((t) => base.companyIds.some((id) => id !== filler.id && offersAny(world.companies[id], [t])));
  const relatedProvider = relatedGap ? companies.find((c) => c.id !== filler.id && offersAny(c, [relatedGap])) : undefined;
  const others = companies.filter((c) => c.id !== filler.id).map((c) => c.name);
  const regions = listOf(filler.geographies);

  return {
    patternId: `multi-${base.patternId}${related ? `+${related.patternId}` : ""}`,
    kind: "multi",
    companyIds: participants,
    roles,
    title: base.title.replace(/ Partnership$/, "") + " Program",
    types: uniq([...sources.flatMap((o) => o.types), "strategic-alliance" as const]),
    summary: isDistribution
      ? `${base.summary.replace(/\.$/, "")} — distributed by ${filler.name} through its resellers in ${regions}.`
      : `${base.summary.replace(/\.$/, "")}, with ${filler.name} providing ${lowerFirst(fillCap.label)}.`,
    whyExists: [
      `The ${base.title} has no ${lowerFirst(tagLabel(gap.tag))}: ${owner.name} needs it and ${others.length === 2 ? `neither ${others[0]} nor ${others[1]}` : `none of ${listOf(others)}`} provides it. ${filler.name} does.`,
      related && relatedGap && relatedProvider
        ? `The ${related.title} was missing a ${lowerFirst(tagLabel(relatedGap))}, which ${relatedProvider.name} provides. One program closes both gaps.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    whyNow: buildWhyNow(world, companies, drivingNeeds),
    contributions: mergeContributions(sources, filler, fillerRole, [fillCap.label]),
    structure: `${base.structure} ${filler.name} ${
      isDistribution
        ? `onboards the appliance as a vendor line, stocks inventory and enables its resellers in ${regions}.`
        : `contributes ${lowerFirst(fillCap.label)} under a three-party agreement.`
    }`,
    evidence,
    assumptions: uniq([
      ...base.assumptions.slice(0, 2),
      ...(related?.assumptions.slice(0, 1) ?? []),
      "A three-way revenue split leaves each party adequate margin.",
    ]),
    unknowns: uniq(["Revenue split across all three parties", `Who holds the vendor contract with ${filler.name}`, ...base.unknowns.slice(0, 3)]),
    questions: uniq([
      "Which launch region and first reseller cohort?",
      ...base.questions.slice(0, 2),
      ...(related?.questions.slice(0, 1) ?? []),
      "Who is the single program owner across the three companies?",
    ]),
    risks: [
      "Three-party coordination slows decisions; the program needs one owner.",
      ...base.risks.filter((r) => !r.includes("route to market")),
    ],
    nextStep: "60-minute three-way working session: product scope, commercial model, launch region.",
    missingCapabilities: [],
    drivingNeeds,
  };
}

export interface MultiPartyResult {
  world: World;
  proposals: NetworkProposal[];
}

export function discoverMultiParty(input: World, signal?: Signal): MultiPartyResult {
  const world = structuredClone(input);
  const proposals: NetworkProposal[] = [];

  for (const gap of urgentGaps(world)) {
    const participants = gap.opportunity.companyIds;
    const people = uniq(gap.opportunity.relationshipIds.flatMap((r) => world.relationships[r].personIds));
    const network = uniq(people.flatMap((p) => networkCompanies(world, p)));
    const scanned: CandidateScan[] = network
      .filter((c) => !participants.includes(c.id))
      .map((c) => {
        const cap = capabilitiesWith(c, [gap.tag])[0];
        return cap
          ? { companyId: c.id, provides: true, note: `${cap.label}: ${cap.detail}` }
          : { companyId: c.id, provides: false, note: `Offers ${c.offers.slice(0, 2).map((o) => lowerFirst(o.label)).join(", ")} — no ${lowerFirst(tagLabel(gap.tag))}` };
      });
    const fillerId = scanned.find((s) => s.provides)?.companyId;
    if (!fillerId) continue;
    const filler = world.companies[fillerId];
    const all = uniq([...participants, fillerId]).sort();
    const id = opportunityId(`multi`, all);
    if (world.proposals[`prop-${id}`] || proposals.some((p) => p.id === `prop-${id}`)) {
      const existing = proposals.find((p) => p.id === `prop-${id}`);
      if (existing) existing.baseOpportunityIds = uniq([...existing.baseOpportunityIds, gap.opportunity.id]);
      continue;
    }
    const related = Object.values(world.opportunities).find(
      (o) => o.id !== gap.opportunity.id && o.kind !== "multi" && LIVE.has(o.stage) && o.companyIds.includes(fillerId) && o.companyIds.every((c) => all.includes(c)),
    );
    const draft = composeDraft(world, gap.opportunity, related, filler, gap);
    const c = critique(draft, world);
    if (c.report.verdict !== "pass") continue;

    const relationshipIds = Object.values(world.relationships)
      .filter((r) => r.companyIds.every((cid) => all.includes(cid)))
      .map((r) => r.id);
    const trigger = { kind: "network-search" as const, opportunityIds: uniq([gap.opportunity.id, ...(related ? [related.id] : [])]) };
    const opportunity = toOpportunity(id, draft, c, { relationshipIds, trigger, at: world.now, engine: "deterministic" });
    opportunity.parentOpportunityIds = trigger.opportunityIds;
    const owner = world.companies[gap.ownerId];
    const introducer = people.map((p) => world.people[p]).find((p) => Object.values(world.relationships).some((r) => r.personIds.includes(p.id) && r.companyIds.includes(fillerId)));
    const escalated = signal?.effect.escalateNeeds?.some((e) => owner.needs.find((n) => n.id === e.needId)?.tags.includes(gap.tag));
    opportunity.delta = {
      whatChanged: `${signal ? `${signal.headline}. ` : ""}${owner.name}'s need for ${lowerFirst(tagLabel(gap.tag))} became urgent, so ORQO searched the network for it.`,
      whyNowRelevant: `${filler.name} provides ${lowerFirst(tagLabel(gap.tag))} and is already in ${introducer ? `${introducer.name}'s` : "your"} network.`,
      whyNotBefore: escalated
        ? `Before the signal, ${owner.name}'s need for ${lowerFirst(tagLabel(gap.tag))} was exploratory. ORQO does not search the network for gaps nobody urgently needs filled.`
        : `No participant had an urgent need for ${lowerFirst(tagLabel(gap.tag))}.`,
    };

    const proposal: NetworkProposal = {
      id: `prop-${id}`,
      baseOpportunityIds: trigger.opportunityIds,
      missing: [gap.tag],
      candidateCompanyId: fillerId,
      scanned,
      opportunity,
      status: "proposed",
      createdAt: world.now,
    };
    proposals.push(proposal);
    world.proposals[proposal.id] = proposal;
    logActivity(
      world,
      "network",
      `${gap.opportunity.title} is missing ${lowerFirst(tagLabel(gap.tag))}. Scanned ${scanned.length} companies in the network: ${filler.name} provides it.`,
      [gap.opportunity.id, fillerId, proposal.id],
    );
  }
  return { world, proposals };
}

export function createFromProposal(input: World, proposalId: string): World {
  const world = structuredClone(input);
  const proposal = world.proposals[proposalId];
  if (!proposal || proposal.status !== "proposed") return world;
  world.opportunities[proposal.opportunity.id] = { ...proposal.opportunity, discoveredAt: world.now, stageHistory: [{ stage: "discovered", at: world.now, reason: "Created from a network proposal." }] };
  world.proposals[proposalId] = { ...proposal, status: "created" };
  logActivity(world, "network", `3-way opportunity created: ${proposal.opportunity.title}`, [proposal.opportunity.id]);
  return world;
}
