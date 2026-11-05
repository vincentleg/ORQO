/**
 * The guided tour's scenario (Nov 2026). Pure and deterministic: no database, no network, no provider.
 *
 * Companies:
 * - INFODIP: its capabilities as INFODIP describes them (OEM/ODM integration for Europe/EMEA). No customer,
 *   price, contact or unpublished commercial information.
 * - Northvale Edge Systems: a FICTIONAL American edge-AI appliance company (reserved .example domain), shown with a
 *   "Fictional company" label everywhere. No real company is described.
 *
 * Everything ORQO "concludes" in the tour is computed here by the product's own engine — Business DNA, market
 * model, scenario generation, critic, dossier, comparison, opportunity map, tracked-opportunity snapshot — exactly
 * as for a real workspace. Only the research itself is prepared (it is reproducible demo evidence, labelled as
 * such) and the monitoring timeline is illustrative (labelled).
 */
import type { Claim, TargetProfile } from "@/lib/intelligence/types";
import { snapshotOf, type TrackedOpportunity } from "@/lib/opportunity/tracked";
import { understandCompany, type MarketModel, type StatedProfile } from "@/lib/understanding";
import { companyDossier, type Dossier } from "@/lib/understanding/dossier";
import type { Scenario } from "@/lib/understanding/scenarios";

type Line = [field: Claim["field"], statement: string, epistemic?: Claim["epistemic"]];

/** Prepared, reproducible research results: one source per company, retrieved at a fixed date. */
function prepared(name: string, domain: string, website: string, sourceTitle: string, lines: readonly Line[]): { id: string; researchedAt: string; profile: TargetProfile } {
  const retrievedAt = "2026-11-02T09:00:00.000Z";
  return {
    id: `7e570000-0000-4000-8000-${(domain.length * 7919).toString().padStart(12, "0").slice(-12)}`,
    researchedAt: retrievedAt,
    profile: {
      name,
      domain,
      website,
      resolution: { method: "url", confidence: "strong" },
      language: "en",
      sources: [{ key: "s0", url: website, title: sourceTitle, authority: "official", pageType: "home", retrievedAt }],
      claims: lines.map(([field, statement, epistemic = "fact"], i) => ({ id: `c${i + 1}`, field, statement, sourceKey: epistemic === "fact" ? "s0" : undefined, epistemic, concepts: [], selfDescribed: true, method: "page_text" })),
      unknowns: [],
    },
  };
}

export const INFODIP_PROFILE: StatedProfile = {
  summary: "French OEM/ODM integrator: assembles, configures, tests and delivers IT hardware for business customers across Europe and EMEA.",
  offerings: ["Server integration", "Workstation integration", "Edge computing appliances", "AI infrastructure", "Hardware customization and branding", "OS and application installation", "Testing and validation", "European and EMEA deployment"],
  customerSegments: ["Hardware and software vendors", "Industrial companies", "Enterprises"],
  markets: ["Industrial", "Enterprise"],
  geographies: ["France", "Europe", "EMEA"],
};

const INFODIP_RESEARCH = prepared("INFODIP", "infodip", "https://orqo-jet.vercel.app/tour#infodip", "INFODIP capability statement (company-provided)", [
  ["summary", "INFODIP is a French OEM/ODM integrator that assembles, configures, tests and delivers IT hardware solutions for business customers across Europe and EMEA."],
  ["offering", "Server integration, workstation integration and edge computing appliances built to the customer's specification."],
  ["offering", "AI infrastructure integration: GPU servers assembled, configured and validated before delivery."],
  ["offering", "Hardware customization, branding, operating system and application installation, testing and validation."],
  ["geography", "We deploy systems for customers across France, Europe and EMEA."],
  ["customer", "Our customers are hardware and software vendors, industrial companies and enterprises."],
]);

export const NORTHVALE_RESEARCH = prepared("Northvale Edge Systems", "northvale-edge.example", "https://northvale-edge.example/", "Northvale Edge Systems — official website (fictional)", [
  ["summary", "Northvale Edge Systems is an American company that designs edge AI appliances for video analytics in industrial sites and smart infrastructure."],
  ["product", "Our edge AI appliances run our video analytics software on GPU-accelerated hardware."],
  ["customer", "Our customers are manufacturers, logistics operators and municipalities in North America."],
  ["geography", "We are headquartered in Austin, Texas, and sell in the United States and Canada."],
  ["strategy", "In 2026 Northvale announced its expansion into Europe and is looking for manufacturing partners to build and deliver its appliances locally."],
]);

export interface TourData {
  own: { name: string; profile: StatedProfile; market: MarketModel };
  target: { research: typeof NORTHVALE_RESEARCH };
  dossier: Dossier;
  lead: Scenario;
  tracked: TrackedOpportunity;
}

/** Computes the whole tour from the two companies with the product engine. Throws if the engine finds no credible lead. */
export function buildTour(): TourData {
  const own = { name: "INFODIP", understanding: understandCompany({ companyName: "INFODIP", website: null, intelligence: INFODIP_RESEARCH, validations: [], profile: INFODIP_PROFILE }) };
  const target = { name: NORTHVALE_RESEARCH.profile.name, understanding: understandCompany({ companyName: NORTHVALE_RESEARCH.profile.name, website: NORTHVALE_RESEARCH.profile.website, intelligence: NORTHVALE_RESEARCH, validations: [] }) };
  const dossier = companyDossier(own, target);
  const lead = dossier.scenarios[0] ?? dossier.novel[0];
  if (dossier.verdict !== "opportunity" || !lead) throw new Error("The tour scenario must produce a credible opportunity.");
  const tracked: TrackedOpportunity = {
    id: "7e570000-0000-4000-8000-00000000de30",
    targetCompanyId: "7e570000-0000-4000-8000-0000000000aa",
    targetName: dossier.targetName,
    scenarioKey: lead.key,
    mechanism: lead.mechanism,
    status: "investigating",
    snapshot: snapshotOf(dossier, lead),
    statusChangedAt: "2026-11-02T09:05:00.000Z",
    createdAt: "2026-11-02T09:05:00.000Z",
    updatedAt: "2026-11-02T09:05:00.000Z",
  };
  return { own: { name: "INFODIP", profile: INFODIP_PROFILE, market: own.understanding.market }, target: { research: NORTHVALE_RESEARCH }, dossier, lead, tracked };
}

export { MONITORING_EVENTS, QUESTION_ROLES } from "./copy";
