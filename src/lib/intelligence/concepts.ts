/**
 * Generic, bilingual business-concept lexicon used to compare two companies
 * deterministically. It is deliberately customer-agnostic: no workspace or
 * company is special-cased. A concept marked `generic` is too broad to drive
 * an opportunity on its own ("both do technology"); the critic enforces that.
 */

export const CONCEPT_CATEGORIES = ["offering_type", "technology", "industry", "geography", "business_model", "customer_type"] as const;
export type ConceptCategory = (typeof CONCEPT_CATEGORIES)[number];

export interface Concept {
  key: string;
  category: ConceptCategory;
  en: string;
  fr: string;
  /** Lower-case terms (EN and FR). Matched on word boundaries; accents are ignored. */
  terms: string[];
  generic?: boolean;
}

const c = (key: string, category: ConceptCategory, en: string, fr: string, terms: string[], generic = false): Concept => ({ key, category, en, fr, terms, generic });

export const CONCEPTS: readonly Concept[] = [
  // What a company sells (offering types).
  c("software", "offering_type", "Software", "Logiciel", ["software", "logiciel", "logiciels", "application", "applications"], true),
  c("saas", "offering_type", "SaaS platform", "Plateforme SaaS", ["saas", "software as a service", "cloud platform", "plateforme cloud"]),
  c("hardware", "offering_type", "Hardware", "Matériel", ["hardware", "materiel informatique", "equipements", "devices", "appliance", "appliances"]),
  c("servers", "offering_type", "Servers & systems", "Serveurs et systèmes", ["server", "servers", "serveur", "serveurs", "rack", "chassis", "rugged computer", "rugged computers", "ordinateur durci", "ordinateurs durcis"]),
  c("components", "offering_type", "Components", "Composants", ["components", "composants", "chips", "semiconductor", "semiconductors", "semi-conducteurs", "pcie card", "adapter card"]),
  c("services", "offering_type", "Professional services", "Services professionnels", ["consulting", "conseil", "professional services", "services professionnels", "managed services", "services manages", "system integration", "integration de systemes"]),
  c("manufacturing", "offering_type", "Manufacturing", "Fabrication", ["manufacturing", "manufacturer", "fabrication", "fabricant", "assembly", "assemblage", "industrialisation", "industrialization"]),
  c("oem_odm", "offering_type", "OEM / ODM", "OEM / ODM", ["oem", "odm", "white label", "marque blanche", "private label"]),
  c("distribution", "offering_type", "Distribution / resale", "Distribution / revente", ["distributor", "distributors", "distribution", "distributeur", "distributeurs", "reseller", "resellers", "revendeur", "revendeurs", "value-added reseller", "channel partner", "channel partners"]),
  c("platform", "offering_type", "Platform", "Plateforme", ["platform", "plateforme"], true),

  // Technologies and capabilities.
  c("ai", "technology", "AI", "IA", ["ai", "artificial intelligence", "intelligence artificielle", "ia", "machine learning", "apprentissage automatique"], true),
  c("ai_infrastructure", "technology", "AI infrastructure", "Infrastructure IA", ["ai infrastructure", "infrastructure ia", "gpu", "gpus", "accelerator", "accelerators", "accelerateur", "accelerateurs", "inference server", "ai training"]),
  c("composable", "technology", "Composable / disaggregated infrastructure", "Infrastructure composable", ["composable", "composability", "disaggregated", "desagregee", "cxl", "pcie fabric", "memory pooling"]),
  c("hpc", "technology", "High-performance computing", "Calcul haute performance", ["hpc", "high performance computing", "high-performance computing", "calcul haute performance", "supercomputer", "supercalculateur"]),
  c("edge", "technology", "Edge computing", "Edge computing", ["edge computing", "edge ai", "at the edge", "en peripherie", "edge server", "edge servers"]),
  c("cloud", "technology", "Cloud", "Cloud", ["cloud", "multi-cloud", "hybrid cloud", "cloud hybride"], true),
  c("data_center", "technology", "Data center", "Datacenter", ["data center", "data centers", "datacenter", "datacenters", "centre de donnees", "centres de donnees"]),
  c("storage", "technology", "Storage", "Stockage", ["storage", "stockage", "nvme", "ssd"]),
  c("networking", "technology", "Networking", "Réseau", ["networking", "network equipment", "network switches", "routers", "ethernet", "5g", "reseaux", "telecommunications equipment"]),
  c("cybersecurity", "technology", "Cybersecurity", "Cybersécurité", ["cybersecurity", "cyber security", "cybersecurite", "security operations", "zero trust", "threat detection", "firewall", "pare-feu"]),
  c("iot", "technology", "IoT", "IoT", ["iot", "internet of things", "internet des objets", "connected devices", "objets connectes"]),
  c("computer_vision", "technology", "Computer vision", "Vision par ordinateur", ["computer vision", "vision par ordinateur", "video analytics", "analyse video", "image recognition"]),
  c("robotics", "technology", "Robotics", "Robotique", ["robotics", "robotique", "robot", "robots", "autonomous mobile robot"]),
  c("embedded", "technology", "Embedded systems", "Systèmes embarqués", ["embedded", "embarque", "embarques", "firmware", "fpga"]),
  c("data_analytics", "technology", "Data & analytics", "Données et analytique", ["analytics", "business intelligence", "data platform", "analytique", "big data"], true),
  c("rugged", "technology", "Rugged / hardened systems", "Systèmes durcis", ["rugged", "ruggedized", "durci", "durcis", "mil-std", "harsh environment", "harsh environments", "environnements severes"]),

  // Industries / verticals.
  c("defense", "industry", "Defense", "Défense", ["defense", "defence", "defense industry", "military", "militaire", "armees", "aerospace and defense", "aerospace & defense"]),
  c("aerospace", "industry", "Aerospace", "Aéronautique et spatial", ["aerospace", "aeronautique", "aeronautics", "spatial", "space industry", "avionics", "avionique"]),
  c("healthcare", "industry", "Healthcare", "Santé", ["healthcare", "health care", "hospital", "hospitals", "sante", "hopital", "hopitaux", "medical", "medtech", "life sciences", "sciences de la vie"]),
  c("finance", "industry", "Financial services", "Services financiers", ["financial services", "banking", "bank", "banks", "banque", "banques", "insurance", "assurance", "fintech", "trading"]),
  c("manufacturing_industry", "industry", "Industrial / manufacturing sector", "Industrie manufacturière", ["industrial", "industriel", "industrie", "factory", "factories", "usine", "usines", "industry 4.0", "industrie 4.0"]),
  c("energy", "industry", "Energy & utilities", "Énergie", ["energy", "energie", "utilities", "oil and gas", "petrole", "renewable", "renouvelable", "power grid"]),
  c("telecom", "industry", "Telecommunications", "Télécommunications", ["telecom", "telecoms", "telecommunications", "operateur", "operateurs", "carrier", "carriers", "telco", "telcos"]),
  c("automotive", "industry", "Automotive & mobility", "Automobile et mobilité", ["automotive", "automobile", "vehicle", "vehicles", "vehicule", "vehicules", "mobility", "mobilite"]),
  c("transport_logistics", "industry", "Transport & logistics", "Transport et logistique", ["logistics", "logistique", "transportation", "freight", "fret", "supply chain", "warehouse", "entrepot", "railway", "ferroviaire"]),
  c("retail", "industry", "Retail", "Commerce de détail", ["retail", "retailer", "retailers", "distribution alimentaire", "e-commerce"]),
  c("public_sector", "industry", "Public sector", "Secteur public", ["public sector", "government", "governments", "secteur public", "collectivites", "smart city"]),
  c("education_research", "industry", "Education & research", "Enseignement et recherche", ["university", "universities", "universite", "universites", "research institute", "research labs", "laboratoire", "laboratoires", "higher education", "enseignement superieur"]),
  c("media", "industry", "Media & entertainment", "Médias et divertissement", ["media", "medias", "broadcast", "broadcasting", "entertainment", "gaming", "jeux video"]),
  c("semiconductor_industry", "industry", "Semiconductor industry", "Industrie des semi-conducteurs", ["semiconductor industry", "foundry", "fonderie"]),

  // Customer types.
  c("enterprise", "customer_type", "Large enterprises", "Grandes entreprises", ["enterprise", "enterprises", "fortune 500", "grands comptes", "grandes entreprises", "large organizations"], true),
  c("smb", "customer_type", "SMBs", "PME", ["smb", "smbs", "sme", "smes", "small business", "small businesses", "pme", "tpe"]),
  c("cloud_providers", "customer_type", "Cloud & hosting providers", "Fournisseurs cloud et hébergeurs", ["cloud service provider", "cloud service providers", "hyperscaler", "hyperscalers", "hosting provider", "hebergeur", "hebergeurs", "neocloud", "neoclouds"]),
  c("oems_customers", "customer_type", "OEMs", "OEM", ["oems", "equipment manufacturers", "fabricants d'equipements", "constructeurs"]),
  c("integrators_customers", "customer_type", "System integrators", "Intégrateurs", ["system integrators", "systems integrators", "integrateurs systemes", "si partners"]),

  // Business models.
  c("subscription", "business_model", "Subscription", "Abonnement", ["subscription", "subscriptions", "abonnement", "abonnements", "per seat", "per user"]),
  c("licensing", "business_model", "Licensing", "Licences", ["licensing", "license", "licence", "licences", "royalty", "royalties"]),
  c("as_a_service", "business_model", "As-a-service", "En tant que service", ["as a service", "as-a-service", "pay-per-use", "pay as you go", "consumption-based"]),

  // Geographies.
  c("europe", "geography", "Europe", "Europe", ["europe", "european", "europeen", "europeenne", "eu", "emea"]),
  c("france", "geography", "France", "France", ["france", "french", "francais", "francaise", "paris"]),
  c("germany", "geography", "Germany", "Allemagne", ["germany", "german", "allemagne", "deutschland", "dach"]),
  c("uk", "geography", "United Kingdom", "Royaume-Uni", ["united kingdom", "uk", "britain", "royaume-uni", "london", "londres"]),
  c("north_america", "geography", "North America", "Amérique du Nord", ["north america", "united states", "usa", "u.s.", "us-based", "amerique du nord", "etats-unis", "canada"]),
  c("apac", "geography", "Asia-Pacific", "Asie-Pacifique", ["apac", "asia", "asia-pacific", "asie", "japan", "japon", "singapore", "singapour", "india", "inde", "australia", "australie"]),
  c("middle_east", "geography", "Middle East & Africa", "Moyen-Orient et Afrique", ["middle east", "moyen-orient", "africa", "afrique", "gulf", "golfe"]),
  c("latam", "geography", "Latin America", "Amérique latine", ["latin america", "latam", "amerique latine", "brazil", "bresil", "mexico", "mexique"]),
];

const BY_KEY = new Map(CONCEPTS.map((x) => [x.key, x]));

export function concept(key: string): Concept | undefined {
  return BY_KEY.get(key);
}

export function conceptLabel(key: string, locale: "en" | "fr"): string {
  const x = BY_KEY.get(key);
  return x ? x[locale] : key;
}

export function isGeneric(key: string): boolean {
  return BY_KEY.get(key)?.generic === true;
}

/** Lower-case, accent-free, single-spaced text for matching. */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MATCHERS: { key: string; re: RegExp }[] = CONCEPTS.map((x) => ({
  key: x.key,
  // Word boundaries that also work next to punctuation and digits.
  re: new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${x.terms.map((t) => escapeRe(foldText(t))).join("|")})(?=$|[^\\p{L}\\p{N}])`, "u"),
}));

/** Concept keys mentioned in a text (order follows the lexicon). */
export function matchConcepts(text: string): string[] {
  const folded = foldText(text);
  if (!folded) return [];
  return MATCHERS.filter((m) => m.re.test(folded)).map((m) => m.key);
}

export function conceptsIn(texts: readonly string[], category?: ConceptCategory): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const k of matchConcepts(t)) found.add(k);
  return [...found].filter((k) => !category || BY_KEY.get(k)?.category === category);
}
