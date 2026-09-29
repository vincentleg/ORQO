/**
 * Opportunity structure library used by the Opportunity Discovery module.
 * Each pattern tests whether a concrete business structure is supported by the
 * two companies' aligned capabilities and needs, and if so drafts it. Patterns
 * are company-agnostic: they read only the typed graph.
 */
import type {
  Company,
  Contribution,
  Need,
  OpportunityEvidence,
  OpportunityType,
  ParticipantRole,
  World,
} from "@/lib/domain/types";
import type { Tag } from "@/lib/domain/taxonomy";
import {
  capabilitiesWith,
  disclosedNeed,
  evidenceFromCapability,
  evidenceFromNeed,
  inference,
  isUrgent,
  listOf,
  lowerFirst,
  monthYear,
  offersAny,
  recentSignals,
  regionAdjective,
  uniq,
  type NeedMatch,
} from "./context";

export interface DrivingNeed {
  companyId: string;
  need: Need;
}

export interface OpportunityDraft {
  patternId: string;
  kind: "reciprocal" | "customer" | "multi";
  companyIds: string[];
  roles: Record<string, ParticipantRole>;
  title: string;
  types: OpportunityType[];
  summary: string;
  whyExists: string;
  whyNow: string;
  contributions: Contribution[];
  structure: string;
  evidence: Omit<OpportunityEvidence, "id">[];
  assumptions: string[];
  unknowns: string[];
  questions: string[];
  risks: string[];
  nextStep: string;
  missingCapabilities: Tag[];
  drivingNeeds: DrivingNeed[];
}

export interface PairContext {
  world: World;
  a: Company;
  b: Company;
  /** a's needs that b can satisfy */
  aNeedsMet: NeedMatch[];
  /** b's needs that a can satisfy */
  bNeedsMet: NeedMatch[];
  /** Need ids already claimed by a higher-priority structure. */
  claimed: ReadonlySet<string>;
}

export type PatternResult = { fit: true; draft: OpportunityDraft } | { fit: false; reason: string };

export interface Pattern {
  id: string;
  name: string;
  evaluate(ctx: PairContext): PatternResult;
}

const SOFTWARE: Tag[] = ["edge-ai-software", "ai-inference", "computer-vision"];
const HARDWARE_NEEDS: Tag[] = ["hardware-integration", "gpu-edge-systems", "eu-manufacturing", "testing-certification"];
const SOFTWARE_NEEDS: Tag[] = ["edge-ai-software", "ai-inference", "computer-vision", "us-technology", "enterprise-ai-apps"];
const PRODUCT: Tag[] = ["enterprise-ai-apps", "ai-infrastructure-product", "packaged-solution", "video-analytics"];
const DISTRIBUTION: Tag[] = ["eu-enterprise-distribution", "channel-sales", "us-enterprise-distribution"];
const DISTRIBUTION_NEEDS: Tag[] = [...DISTRIBUTION, "enterprise-relationships"];

const matchesOn = (matches: NeedMatch[], tags: Tag[]) => matches.filter((m) => m.tags.some((t) => tags.includes(t)));
const uniqueNeeds = (matches: NeedMatch[]) => uniq(matches.map((m) => m.need));
const uniqueCaps = (matches: NeedMatch[]) => uniq(matches.map((m) => m.capability));
const regionNoun = (c: Company) => (regionAdjective(c) === "European" ? "Europe" : c.geographies[0] ?? "the target market");

export function buildWhyNow(world: World, parties: Company[], drivers: DrivingNeed[]): string {
  const parts: string[] = recentSignals(world, parties.map((p) => p.id))
    .slice(0, 2)
    .map((s) => `${s.headline} (${monthYear(s.occurredAt)}).`);
  const rank = { critical: 0, active: 1, exploring: 2 } as const;
  // Ties go to needs stated first-hand in conversation: direct intent is stronger timing evidence than second-hand notes.
  const firstHand = (d: DrivingNeed) => (d.need.evidence.some((e) => world.sources[e.sourceId]?.kind === "conversation") ? 0 : 1);
  const urgent = drivers
    .filter((d) => isUrgent(d.need))
    .sort((x, y) => rank[x.need.intensity] - rank[y.need.intensity] || firstHand(x) - firstHand(y));
  for (const company of parties) {
    const d = urgent.find((u) => u.companyId === company.id);
    if (d) parts.push(disclosedNeed(company, d.need));
  }
  return parts.length > 0 ? parts.join(" ") : "No time-sensitive trigger found. The needs involved are exploratory on both sides.";
}

function evidenceFor(matches: NeedMatch[], companies: Record<string, Company>): Omit<OpportunityEvidence, "id">[] {
  const out: Omit<OpportunityEvidence, "id">[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (!seen.has(m.capability.id)) {
      seen.add(m.capability.id);
      out.push(...evidenceFromCapability(companies[m.capabilityCompanyId], m.capability));
    }
    if (!seen.has(m.need.id)) {
      seen.add(m.need.id);
      out.push(...evidenceFromNeed(companies[m.needCompanyId], m.need));
    }
  }
  return out;
}

const drivers = (matches: NeedMatch[]): DrivingNeed[] =>
  uniqueNeeds(matches).map((need) => ({ companyId: need.companyId, need }));

/** Software company + hardware integrator → pre-integrated appliance (OEM). */
const oemAppliance: Pattern = {
  id: "oem-appliance",
  name: "OEM appliance",
  evaluate({ world, a: s, b: h, aNeedsMet, bNeedsMet }) {
    if (!offersAny(s, SOFTWARE)) return { fit: false, reason: `${s.name} has no AI software to embed.` };
    if (!offersAny(h, ["hardware-integration"]) || !offersAny(h, ["oem-odm", "eu-manufacturing"]))
      return { fit: false, reason: `${h.name} does not build hardware.` };
    const sMet = matchesOn(aNeedsMet, HARDWARE_NEEDS);
    const hMet = matchesOn(bNeedsMet, SOFTWARE_NEEDS);
    if (sMet.length === 0) return { fit: false, reason: `${s.name} has no stated hardware need.` };
    if (hMet.length === 0) return { fit: false, reason: `${h.name} has no stated software need.` };

    const expansion = aNeedsMet.filter((m) => m.tags.includes("eu-deployment") || m.tags.includes("eu-market-presence"));
    const all = [...sMet, ...hMet, ...expansion];
    const region = regionNoun(h);
    const product = offersAny(s, ["edge-ai-software"]) ? "Edge AI" : "AI";
    const gpu = capabilitiesWith(h, ["gpu-edge-systems"])[0];
    const certifies = offersAny(h, ["testing-certification"]);
    const hCaps = uniqueCaps(sMet.concat(expansion)).map((c) => c.label);
    const sCaps = uniqueCaps(hMet).map((c) => c.label);
    const missing = DISTRIBUTION.filter((t) => s.needs.some((n) => n.tags.includes(t)) && !offersAny(s, [t]) && !offersAny(h, [t]));
    const hwNeed = sMet[0].need;

    return {
      fit: true,
      draft: {
        patternId: "oem-appliance",
        kind: "reciprocal",
        companyIds: [s.id, h.id],
        roles: { [s.id]: "software-vendor", [h.id]: "hardware-partner" },
        title: `${regionAdjective(h)} ${product} Appliance Partnership`,
        types: regionAdjective(s) === regionAdjective(h) ? ["oem", "technology-integration"] : ["oem", "technology-integration", "market-entry"],
        summary: `A pre-integrated ${product.toLowerCase() === "edge ai" ? "edge AI" : "AI"} appliance: ${s.name} software on ${h.name} hardware, built, certified and deployed in ${region}.`,
        whyExists: `${s.name} sells its ${lowerFirst(sCaps[0] ?? "AI software")}, but ${lowerFirst(hwNeed.detail)} ${h.name} offers ${listOf(hCaps.slice(0, 3).map(lowerFirst))}, and is looking for AI software to ship on its systems. Each side holds what the other is missing.`,
        whyNow: buildWhyNow(world, [s, h], drivers(all)),
        contributions: [
          { companyId: s.id, role: "software-vendor", items: sCaps },
          { companyId: h.id, role: "hardware-partner", items: hCaps },
        ],
        structure: `${h.name} builds a co-branded appliance on its ${gpu ? "existing edge GPU reference designs" : "edge hardware"}, pre-imaged with ${s.name} software. ${s.name} licenses software per unit; ${h.name} handles manufacturing, ${certifies ? "certification, " : ""}logistics and field deployment in ${region}.`,
        evidence: [
          ...evidenceFor(all, world.companies),
          inference(h.id, `A pre-integrated appliance removes the hardware-sourcing step that ${s.name} reports is stalling enterprise deals.`),
        ],
        assumptions: [
          `${s.name}'s runtime can be certified on ${h.name}'s reference hardware without major porting.`,
          `Unit volumes justify a dedicated appliance SKU for ${h.name}.`,
          `${s.name} is willing to sell through an appliance, not only as software.`,
        ],
        unknowns: [
          "Preferred GPU architecture and hardware tier",
          "Expected annual unit volume",
          `Certification requirements in target ${regionAdjective(h)} markets`,
          "Commercial ownership: brand, customer contract, pricing",
          "Support model: first- and second-line responsibilities",
        ],
        questions: [
          "Which appliance tier fits the first use case: compact Jetson-class or rack-mount x86?",
          "What volume would justify a dedicated SKU for both sides?",
          "Who owns the end-customer contract and first-line support?",
          "Which certifications do the first target customers require?",
          "What is the target price per deployed appliance?",
        ],
        risks: [
          "Margin stacking could price the appliance above software-only alternatives.",
          ...(missing.length > 0 ? [`Neither company has an enterprise sales channel in ${region}; the appliance still needs a route to market.`] : []),
        ],
        nextStep: "30-minute technical and commercial discovery call.",
        missingCapabilities: missing,
        drivingNeeds: drivers(all),
      },
    };
  },
};

/** Product company + distributor → channel distribution agreement. */
const channelDistribution: Pattern = {
  id: "channel-distribution",
  name: "Channel distribution",
  evaluate({ world, a: v, b: d, aNeedsMet, bNeedsMet }) {
    if (!offersAny(v, PRODUCT)) return { fit: false, reason: `${v.name} has no product a channel could resell.` };
    if (!offersAny(d, DISTRIBUTION)) return { fit: false, reason: `${d.name} has no distribution or channel capability.` };
    const vMet = matchesOn(aNeedsMet, DISTRIBUTION_NEEDS);
    const dMet = matchesOn(bNeedsMet, PRODUCT);
    if (vMet.length === 0) return { fit: false, reason: `${v.name} has no stated distribution need.` };
    if (dMet.length === 0) return { fit: false, reason: `${d.name} is not looking for ${v.name}'s kind of product.` };

    const all = [...vMet, ...dMet];
    const packagedGap = d.needs.some((n) => n.tags.includes("packaged-solution") && isUrgent(n)) && !offersAny(v, ["packaged-solution"]);
    const missing: Tag[] = packagedGap ? ["packaged-solution"] : [];
    const fit = (id: string) => dMet.filter((m) => m.capability.id === id).reduce((n, m) => n + m.tags.length, 0);
    const product = [...uniqueCaps(dMet)].sort((x, y) => fit(y.id) - fit(x.id))[0];
    const dCaps = uniqueCaps(vMet).map((c) => c.label);
    const regions = listOf(d.geographies);

    return {
      fit: true,
      draft: {
        patternId: "channel-distribution",
        kind: "reciprocal",
        companyIds: [v.id, d.id],
        roles: { [v.id]: "vendor", [d.id]: "distributor" },
        title: `${regionAdjective(d)} Enterprise Channel Partnership`,
        types: regionAdjective(v) === regionAdjective(d) ? ["distribution", "channel-partnership"] : ["distribution", "channel-partnership", "market-entry"],
        summary: `${d.name} distributes ${v.name}'s ${lowerFirst(product.label)} through its reseller network in ${regions}.`,
        whyExists: `${v.name} wants enterprise customers in ${regionNoun(d)} and has no channel there. ${d.name} has a stated need for ${lowerFirst(uniqueNeeds(dMet)[0].label)}, and ${v.name}'s ${lowerFirst(product.label)} fits that gap.`,
        whyNow: buildWhyNow(world, [v, d], drivers(all)),
        contributions: [
          { companyId: v.id, role: "vendor", items: uniq(uniqueCaps(dMet).map((c) => c.label)) },
          { companyId: d.id, role: "distributor", items: dCaps },
        ],
        structure: `Two-tier distribution agreement: ${d.name} onboards ${v.name} as a vendor line, stocks and finances inventory, and enables its resellers; ${v.name} provides pre-sales engineering, local support and partner pricing.`,
        evidence: [
          ...evidenceFor(all, world.companies),
          inference(d.id, `${d.name}'s security-led buyers overlap with the safety and compliance use cases ${v.name} already serves.`),
        ],
        assumptions: [
          `${v.name}'s product fits ${d.name}'s security-led buyer base.`,
          `${d.name}'s resellers can be enabled to sell and deploy video analytics.`,
          `Channel margins work alongside ${v.name}'s per-device pricing.`,
        ],
        unknowns: ["Launch regions and reseller tiers", "Partner margin structure", "Pre-sales and support split", "Stocking terms and minimum commitments"],
        questions: [
          `Which ${d.name} regions and resellers would launch first?`,
          "What margin does the channel need at each tier?",
          `Who provides L1 and L2 support to end customers?`,
          "Is a hardware bundle required for the channel to carry the product?",
        ],
        risks: packagedGap
          ? [`${d.name} sells packaged hardware/software solutions; ${v.name} is software-only today.`]
          : ["Reseller enablement for a new product category can take two to three quarters."],
        nextStep: `45-minute portfolio fit review with ${d.name}'s emerging-technology team.`,
        missingCapabilities: missing,
        drivingNeeds: drivers(all),
      },
    };
  },
};

/** One side needs what the other sells → customer relationship. */
const customer: Pattern = {
  id: "customer",
  name: "Customer relationship",
  evaluate({ world, a: seller, b: buyer, bNeedsMet, claimed }) {
    if (claimed.size > 0) return { fit: false, reason: "A partnership structure already fits this pair; a plain customer relationship would undersell it." };
    const open = bNeedsMet.filter((m) => !claimed.has(m.need.id));
    if (bNeedsMet.length === 0) return { fit: false, reason: `${buyer.name} has no stated need ${seller.name} can serve.` };
    if (open.length === 0) return { fit: false, reason: "Already covered by a stronger structure." };
    const need = open[0].need;
    const caps = uniqueCaps(open.filter((m) => m.need.id === need.id));

    return {
      fit: true,
      draft: {
        patternId: "customer",
        kind: "customer",
        companyIds: [seller.id, buyer.id],
        roles: { [seller.id]: "seller", [buyer.id]: "buyer" },
        title: `${need.label} with ${seller.name}`,
        types: ["customer"],
        summary: `${buyer.name} adopts ${seller.name}'s ${lowerFirst(caps[0].label)} to address ${lowerFirst(need.label)}.`,
        whyExists: `${buyer.name}: ${need.detail} ${seller.name} offers ${listOf(caps.map((c) => lowerFirst(c.label)))}.`,
        whyNow: buildWhyNow(world, [seller, buyer], [{ companyId: buyer.id, need }]),
        contributions: [
          { companyId: seller.id, role: "seller", items: caps.map((c) => c.label) },
          { companyId: buyer.id, role: "buyer", items: ["Pilot site and operational data", "Budget owner for the use case"] },
        ],
        structure: `Paid pilot: ${seller.name} deploys its ${lowerFirst(caps[0].label)} at one ${buyer.name} site with agreed success criteria, converting to a volume license.`,
        evidence: evidenceFor(open, world.companies),
        assumptions: [`${buyer.name} has budget allocated for ${lowerFirst(need.label)}.`, `A single-site pilot is representative of ${buyer.name}'s operations.`],
        unknowns: ["Budget and timeline", "Decision maker", "Integration requirements"],
        questions: [`Is ${lowerFirst(need.label)} funded this year?`, "Who owns the decision?", "What would a successful pilot prove?"],
        risks: [`Need is ${need.intensity}; value to ${seller.name} depends on ${buyer.name} committing budget.`],
        nextStep: `Short qualification call with ${buyer.name}.`,
        missingCapabilities: [],
        drivingNeeds: [{ companyId: buyer.id, need }],
      },
    };
  },
};

/** Ordered by priority: higher-priority structures claim needs first. */
export const PATTERNS: Pattern[] = [oemAppliance, channelDistribution, customer];
