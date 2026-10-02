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

// Phase 15 partners (fictional): one counterpart per domain, to test what two companies could do together.
export const HARDWARE_CO = fixtureProfile("Quartzline Devices", "quartzline.example", [
  ["summary", "Quartzline Devices designs rugged edge servers and sensors for industrial businesses."],
  ["customer", "Our customers are enterprises in energy and transport."],
  ["strategy", "In 2026 Quartzline launched a new edge server line for harsh environments."],
]);

export const SAAS_PARTNER = fixtureProfile("Fieldnote", "fieldnote.example", [
  ["summary", "Fieldnote is spend management software for mid-market businesses."],
  ["offering", "Fieldnote integrates with accounting tools through native integrations and an open API."],
  ["offering", "Book a demo with our sales team."],
]);

export const PHARMA = fixtureProfile("Corvant Pharma", "corvant.example", [
  ["summary", "Corvant Pharma is a manufacturer of branded medicines sold to hospitals."],
  ["offering", "We manufacture in our GMP certified production facility and work with distributors."],
  ["strategy", "Corvant in-licenses late-stage programs from partners."],
]);

export const ECOM_BRAND = fixtureProfile("Lumen & Co", "lumen.example", [
  ["summary", "Lumen & Co designs diffuser devices and home fragrance for consumers."],
  ["offering", "Buy now in our online shop, delivered to households."],
]);

export const HAULIER = fixtureProfile("Northway Haulage", "northway.example", [
  ["summary", "Northway Haulage operates a fleet of trucks and warehouses for businesses."],
  ["business_model", "Pricing per shipment."],
]);

// Phase 16: existing relationships (fictional). The same patterns in five domains. In each, the user's company
// names the target in its own evidence, and ORQO must not turn that relationship into a prospect without evidence.

/** Systems integrator that builds its appliances on a large manufacturer's servers (the existing-supplier pattern). */
export const APPLIANCE_INTEGRATOR = fixtureProfile("Arvenor Systems", "arvenor.example", [
  ["summary", "Arvenor Systems is a manufacturer of turnkey appliances for industrial businesses and public institutions."],
  ["offering", "Our appliances are built on Kestrel Compute servers and assembled in our own facility."],
  ["customer", "Our customers are enterprises in energy and municipalities."],
]);

export const SERVER_MAKER = fixtureProfile("Kestrel Compute", "kestrel.example", [
  ["summary", "Kestrel Compute is a global manufacturer of servers, storage and laptops for enterprises."],
  ["offering", "We manufacture our products in our own factories."],
  ["offering", "We sell through channel partners and resellers worldwide."],
]);

/** Same manufacturer, with dated evidence of an incremental need the integrator could serve. */
export const SERVER_MAKER_OUTSOURCING = fixtureProfile("Kestrel Compute", "kestrel.example", [
  ["summary", "Kestrel Compute is a global manufacturer of servers, storage and laptops for enterprises."],
  ["offering", "We sell through channel partners and resellers worldwide."],
  ["strategy", "In 2026 Kestrel Compute launched a program to outsource the production of its edge appliances to manufacturing partners."],
]);

export const SAAS_ON_CLOUD = fixtureProfile("Ledgerline", "ledgerline.example", [
  ["summary", "Ledgerline is accounts payable automation software for mid-market finance teams."],
  ["offering", "Ledgerline runs on Nimbusfield Cloud infrastructure in two regions."],
  ["business_model", "Pricing is per user, per month, billed annually."],
  ["customer", "Case studies: how mid-market businesses closed their books faster."],
]);

export const CLOUD_PROVIDER = fixtureProfile("Nimbusfield Cloud", "nimbusfield.example", [
  ["summary", "Nimbusfield Cloud provides cloud infrastructure, hosting and data centers to businesses."],
  ["business_model", "Usage-based pricing, billed per hour."],
]);

export const IMPLEMENTER = fixtureProfile("Arclight Consulting", "arclight.example", [
  ["summary", "Arclight Consulting is a consultancy for mid-market finance teams."],
  ["offering", "We are a certified implementation partner of Fieldnote and implement Fieldnote for our clients."],
  ["customer", "We work with mid-market businesses."],
  ["offering", "Our consulting engagements are delivered on a fixed-fee basis."],
]);

/** The software vendor, with its own partner program (a generic cue, not a new need). */
export const IMPLEMENTED_VENDOR = fixtureProfile("Fieldnote", "fieldnote.example", [
  ["summary", "Fieldnote is spend management software for mid-market businesses."],
  ["offering", "Fieldnote integrates with accounting tools through native integrations and an open API."],
  ["offering", "Join our partner program."],
]);

export const REAGENT_BUYER = fixtureProfile("Calderon Bio", "calderon.example", [
  ["summary", "Calderon Bio is a clinical-stage company developing antibody therapeutics."],
  ["offering", "Our laboratories use Vestry Scientific reagents and instruments."],
  ["strategy", "Our lead candidate entered a Phase 2 clinical trial in 2026."],
  ["offering", "Our programs require FDA approval."],
]);

export const REAGENT_SUPPLIER = fixtureProfile("Vestry Scientific", "vestry.example", [
  ["summary", "Vestry Scientific is a manufacturer of laboratory reagents and instruments for research institutes and pharmaceutical companies."],
  ["offering", "We sell through distributors and our online shop."],
]);

export const DTC_BRAND = fixtureProfile("Lumen & Co", "lumen.example", [
  ["summary", "Lumen & Co designs diffuser devices and home fragrance for consumers."],
  ["offering", "Buy now in our online shop, delivered to households by our logistics partner Northway Haulage."],
]);

export const BRAND_LOGISTICS = fixtureProfile("Northway Haulage", "northway.example", [
  ["summary", "Northway Haulage operates a fleet of trucks and warehouses for businesses and consumer brands."],
  ["business_model", "Pricing per shipment."],
]);
