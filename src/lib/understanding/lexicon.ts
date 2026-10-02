/**
 * Detection vocabulary (EN/FR) for the ontology's traits. Vocabulary only: a
 * term can make a trait OBSERVED in a company's own wording; it never decides
 * what that trait means for the market (that is the ontology's job).
 *
 * Terms are matched on word boundaries, case- and accent-insensitively.
 * Ambiguous single words are avoided on purpose ("manufacturing" also describes
 * the industry a consultancy SERVES; "lab" also describes a customer).
 */
import { foldText } from "@/lib/intelligence/concepts";
import type { EvidenceCue, Trait, ValueChainRole } from "./ontology";

type Lexicon = Partial<Record<Trait, readonly string[]>>;

export const TRAIT_TERMS: Lexicon = {
  // Offering form.
  "offering_form:physical_product": ["hardware", "device", "devices", "equipment", "machinery", "machines", "components", "electronic assemblies", "appliance", "appliances", "servers", "sensors", "instruments", "we manufacture", "manufactured", "materiel", "equipement", "equipements", "appareil", "appareils", "composants", "machines", "capteurs", "serveurs", "nous fabriquons"],
  "offering_form:software": ["software", "saas", "software-as-a-service", "web app", "mobile app", "cloud-based", "cloud platform", "api", "apis", "logiciel", "logiciels", "application web", "application mobile", "plateforme saas"],
  "offering_form:service": ["consulting", "consultancy", "advisory", "agency", "managed services", "professional services", "outsourcing", "training programs", "conseil", "cabinet de conseil", "accompagnement", "prestations", "agence", "services manages"],
  "offering_form:data_content": ["datasets", "data feeds", "data provider", "market data", "publisher", "jeux de donnees", "fournisseur de donnees", "flux de donnees"],
  "offering_form:ip_licensing": ["licensing", "patented", "patents", "royalties", "out-license", "brevets", "brevete", "licence de technologie"],
  "offering_form:capacity_infrastructure": ["fleet", "warehouses", "warehousing", "freight", "trucking", "data centers", "colocation", "hosting", "solar farms", "power plants", "flotte", "entrepots", "fret", "transport routier", "hebergement", "centrales"],
  "offering_form:platform_marketplace": ["marketplace", "two-sided", "connects buyers and sellers", "place de marche", "mise en relation"],
  "offering_form:financial_product": ["lending", "loans", "insurance", "insurer", "financing solutions", "assurance", "prets", "credit"],
  "offering_form:research": ["drug discovery", "clinical trial", "clinical trials", "clinical-stage", "preclinical", "therapeutics", "drug candidates", "essais cliniques", "candidats medicaments", "decouverte de medicaments"],

  // Customer scope.
  "customer_scope:business": ["b2b", "businesses", "enterprises", "enterprise customers", "smbs", "mid-market", "organizations", "companies of all sizes", "entreprises", "pme", "eti", "grands comptes", "clients professionnels"],
  "customer_scope:consumer": ["consumers", "households", "shoppers", "families", "b2c", "particuliers", "grand public", "consommateurs", "menages"],
  "customer_scope:public_sector": ["government", "governments", "public sector", "government agencies", "defense agencies", "municipalities", "ministries", "secteur public", "collectivites", "administrations", "ministeres"],
  "customer_scope:institutions": ["universities", "hospitals", "research institutes", "research labs", "schools", "universites", "hopitaux", "etablissements de sante", "instituts de recherche"],

  // Revenue model.
  "revenue_model:subscription": ["subscription", "per month", "per seat", "per user", "annual plan", "abonnement", "par mois", "par utilisateur"],
  "revenue_model:usage_based": ["pay-as-you-go", "usage-based", "per transaction", "per shipment", "a l'usage", "par transaction"],
  "revenue_model:one_time_sale": ["buy now", "add to cart", "request a quote", "price list", "acheter", "demander un devis"],
  "revenue_model:project_fee": ["fixed fee", "fixed-fee", "per project", "project-based", "statement of work", "forfait", "missions de conseil"],
  "revenue_model:licensing_royalty": ["royalties", "license fees", "licensing revenue", "redevances"],
  "revenue_model:commission": ["commission", "take rate", "transaction fee"],
  "revenue_model:retainer": ["retainer", "monthly retainer"],
  "revenue_model:milestone_funding": ["milestone payments", "upfront payment", "milestones", "paiements d'etape"],

  // Sales motion.
  "sales_motion:self_serve": ["sign up", "start free", "free trial", "try for free", "get started free", "essai gratuit", "inscrivez-vous", "commencer gratuitement"],
  "sales_motion:direct_sales": ["contact sales", "book a demo", "request a demo", "talk to sales", "our sales team", "demander une demo", "contactez notre equipe commerciale"],
  "sales_motion:channel_partners": ["resellers", "reseller program", "channel partners", "distributors", "partner network", "revendeurs", "distributeurs", "reseau de partenaires"],
  "sales_motion:tender_procurement": ["tender", "tenders", "rfp", "public procurement", "framework agreement", "appels d'offres", "marches publics"],
  "sales_motion:marketplace_listing": ["aws marketplace", "azure marketplace", "google cloud marketplace", "appexchange", "app store", "google play"],
  "sales_motion:referral": ["referrals", "referral", "word of mouth", "bouche-a-oreille"],

  // Regulation.
  "regulation:regulated": ["fda", "ema", "gmp", "iso 13485", "hipaa", "ce marking", "marquage ce", "regulatory approval", "medical device", "dispositif medical", "itar", "banking license", "regulated", "reglementee", "agrement"],

  // Value-chain roles visible in the company's own wording.
  "role:manufacturer": ["we manufacture", "manufacturer of", "contract manufacturer", "contract manufacturing", "odm", "oem/odm", "electronics manufacturing services", "white-label production", "private label manufacturing", "production en marque blanche", "fabrication pour le compte", "our factory", "our factories", "production facility", "production sites", "fabricant", "nous fabriquons", "sous-traitant industriel", "nos usines", "notre usine"],
  "role:distributor": ["distributor of", "we distribute", "wholesale", "wholesaler", "value-added distributor", "distributeur de", "grossiste"],
  "role:integrator": ["system integrator", "systems integrator", "integration services", "implementation partner", "integrateur"],

  // Publicly visible proof.
  "has:partners": ["partner with", "partners with", "partnership with", "partnered with", "official partner", "technology partners", "partner program", "become a partner", "en partenariat avec", "partenaire officiel", "programme partenaires"],
  "has:integrations": ["integrates with", "integration with", "integrations", "native integration", "connectors", "s'integre", "connecteurs"],
  "has:certifications": ["iso 9001", "iso 27001", "iso 13485", "iso 14001", "soc 2", "as9100", "iatf 16949", "hds", "certified", "certifie", "certifiee"],
  "has:case_studies": ["case study", "case studies", "customer story", "customer stories", "success story", "etude de cas", "etudes de cas", "temoignages clients"],
};

/** Statements that describe a problem the company solves (self-described). */
export const PROBLEM_TERMS = ["help", "helps", "reduce", "reduces", "eliminate", "automate", "automates", "simplify", "simplifies", "optimize", "optimise", "aider", "aide", "reduire", "automatiser", "simplifier", "optimiser"];

export const CUE_ROLES: readonly ValueChainRole[] = ["manufacturer", "distributor", "integrator"];
export const CUE_FACETS: Record<EvidenceCue, "public_partners" | "integrations" | "certifications" | "case_studies"> = {
  partners: "public_partners",
  integrations: "integrations",
  certifications: "certifications",
  case_studies: "case_studies",
};

function escapeRe(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const boundary = (terms: readonly string[]) => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${terms.map((t) => escapeRe(foldText(t))).join("|")})(?=$|[^\\p{L}\\p{N}])`, "u");

const MATCHERS: { trait: Trait; re: RegExp }[] = (Object.entries(TRAIT_TERMS) as [Trait, string[]][]).map(([trait, terms]) => ({ trait, re: boundary(terms) }));
const PROBLEM_RE = boundary(PROBLEM_TERMS);

/**
 * A more specific reading of the same words wins: "available on the AWS
 * Marketplace" is a sales motion (a listing), not evidence the company RUNS a marketplace.
 */
const SUPERSEDES: Partial<Record<Trait, readonly Trait[]>> = {
  "sales_motion:marketplace_listing": ["offering_form:platform_marketplace"],
};

/** Traits whose vocabulary appears in a text. */
export function traitsIn(text: string): Trait[] {
  const folded = foldText(text);
  if (!folded) return [];
  const found = MATCHERS.filter((x) => x.re.test(folded)).map((x) => x.trait);
  const dropped = new Set(found.flatMap((t) => SUPERSEDES[t] ?? []));
  return found.filter((t) => !dropped.has(t));
}

export function describesProblem(text: string): boolean {
  return PROBLEM_RE.test(foldText(text));
}

const TERM_CACHE = new Map<readonly string[], RegExp>();
/** Whether a text mentions any of the terms (word boundaries, accent-insensitive). */
export function mentions(text: string, terms: readonly string[]): boolean {
  let re = TERM_CACHE.get(terms);
  if (!re) TERM_CACHE.set(terms, (re = boundary(terms)));
  return re.test(foldText(text));
}
