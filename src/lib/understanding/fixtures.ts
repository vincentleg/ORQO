/**
 * Cross-domain test fixtures (Phase 14): FICTIONAL companies written as an
 * official website would describe them. Used only by automated tests: never
 * shown to users, never researched live. They exist to prove the engine
 * adapts to materially different businesses without per-industry code.
 */
import type { Claim, TargetProfile } from "@/lib/intelligence/types";

type Line = [field: Claim["field"], statement: string, epistemic?: Claim["epistemic"]];

export function fixtureProfile(name: string, domain: string, lines: readonly Line[]): { id: string; researchedAt: string; profile: TargetProfile } {
  const retrievedAt = "2026-09-01T10:00:00.000Z";
  return {
    id: `00000000-0000-4000-8000-${domain.length.toString().padStart(12, "0")}`,
    researchedAt: retrievedAt,
    profile: {
      name,
      domain,
      website: `https://${domain}`,
      resolution: { method: "url", confidence: "strong" },
      language: "en",
      sources: [{ key: "s0", url: `https://${domain}/`, title: name, authority: "official", pageType: "home", retrievedAt }],
      claims: lines.map(([field, statement, epistemic = "fact"], i) => ({ id: `c${i + 1}`, field, statement, sourceKey: epistemic === "fact" ? "s0" : undefined, epistemic, concepts: [], selfDescribed: true, method: "page_text" })),
      unknowns: [],
    },
  };
}

export const MANUFACTURER = fixtureProfile("Voltaris Assembly", "voltaris.example", [
  ["summary", "Voltaris Assembly is a contract manufacturer of electronic assemblies for industrial equipment makers and medical device companies."],
  ["offering", "We manufacture printed circuit board assemblies and box builds in our ISO 13485 certified production facility."],
  ["customer", "Our customers are industrial businesses and enterprises in the medical sector."],
  ["offering", "Request a quote for prototypes and series production."],
  ["geography", "Production sites in Poland and Mexico."],
  ["strategy", "In 2026 Voltaris opened a second production line."],
]);

export const SAAS = fixtureProfile("Ledgerline", "ledgerline.example", [
  ["summary", "Ledgerline is accounts payable automation software for mid-market finance teams."],
  ["product", "Ledgerline automates invoice capture and approval workflows."],
  ["offering", "Ledgerline integrates with NetSuite, Xero and QuickBooks through native integrations."],
  ["business_model", "Pricing is per user, per month, billed annually."],
  ["offering", "Start free with a 14-day free trial or book a demo."],
  ["offering", "Ledgerline is available on the AWS Marketplace."],
  ["customer", "Case studies: how mid-market businesses closed their books faster."],
]);

export const CONSULTANCY = fixtureProfile("Northbeam Advisory", "northbeam.example", [
  ["summary", "Northbeam Advisory is a management consultancy that helps manufacturing companies improve operations."],
  ["customer", "We work with mid-market enterprises and family-owned businesses."],
  ["offering", "Our consulting engagements are delivered on a fixed-fee or retainer basis."],
  ["offering", "Most of our new clients come through referrals from existing clients."],
  ["customer", "Read our case studies from operations turnarounds."],
  ["geography", "Offices in Lyon and Montreal."],
]);

export const BIOTECH = fixtureProfile("Helixora Therapeutics", "helixora.example", [
  ["summary", "Helixora is a clinical-stage company developing antibody therapeutics through its drug discovery platform."],
  ["offering", "We out-license our patented antibody platform to pharmaceutical companies."],
  ["strategy", "We partner with large pharmaceutical companies through milestone payments and royalties."],
  ["strategy", "Our lead candidate entered a Phase 2 clinical trial in 2026."],
  ["offering", "Our programs require FDA and EMA regulatory approval."],
  ["customer", "We collaborate with universities and research institutes."],
]);

export const LOGISTICS = fixtureProfile("Rivermark Freight", "rivermark.example", [
  ["summary", "Rivermark Freight operates a fleet of 400 trucks and three warehouses."],
  ["customer", "We serve businesses and municipalities across the Benelux and northern France."],
  ["business_model", "Pricing per shipment with volume contracts."],
  ["offering", "We respond to public tenders for urban logistics."],
  ["identity", "Rivermark Freight is ISO 9001 certified."],
]);

/** A real-world-like thin website: almost nothing to go on. */
export const NICHE = fixtureProfile("Atelier Brume", "brume.example", [["identity", "Atelier Brume — bespoke creations since 1998."]]);

export const CROSS_DOMAIN = { MANUFACTURER, SAAS, CONSULTANCY, BIOTECH, LOGISTICS, NICHE };
