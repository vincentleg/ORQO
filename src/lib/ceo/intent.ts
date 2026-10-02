/**
 * ORQO CEO: the typed intent contract and the deterministic interpretation of a business request (Phase 16B).
 *
 * The user states an objective in plain English or French. This module turns it into a typed request: what
 * the user wants (an intent), which companies the text mentions, and simple constraints. It is pure and
 * deterministic: no model, no provider, no database. The server then resolves the mentioned companies inside
 * the organization (ceo/resolve) and answers with existing product capabilities (server/ceo).
 *
 * CEO is not a security authority and not an agent. It interprets and routes.
 * - Supported intents map to capabilities that exist today.
 * - Future capabilities (outreach, monitoring, autonomous execution) are recognized so ORQO can say honestly
 *   that it does not do them yet. They are never executed.
 * Vocabulary is data (CEO_LEXICON), and it holds no industry assumption.
 */
import { conceptsIn, foldText, isGeneric } from "@/lib/intelligence/concepts";

export const CEO_INTENTS = [
  "analyze_company",
  "evaluate_partnership",
  "explain_opportunity",
  "identify_missing_information",
  "recommend_next_investigation",
  "show_priorities",
  "find_prospects",
  "prepare_meeting",
  "compare_companies",
] as const;
export type CeoIntentType = (typeof CEO_INTENTS)[number];

/** Capabilities ORQO recognizes but does not perform (Phase 17-18). Never executed. */
export const FUTURE_CAPABILITIES = ["outreach", "monitoring", "autonomous_execution"] as const;
export type FutureCapability = (typeof FUTURE_CAPABILITIES)[number];

export type CeoSupport = "executable" | "partial" | "future";

/** The product capability behind each intent, and how far ORQO supports it today. */
export const CEO_CAPABILITIES: Record<CeoIntentType, { capability: "company_dossier" | "tracked_opportunities" | "stored_briefing" | "prospect_discovery" | "deal_report" | "none"; support: CeoSupport; needsCompany: boolean }> = {
  analyze_company: { capability: "company_dossier", support: "executable", needsCompany: true },
  evaluate_partnership: { capability: "company_dossier", support: "executable", needsCompany: true },
  explain_opportunity: { capability: "tracked_opportunities", support: "executable", needsCompany: false },
  identify_missing_information: { capability: "company_dossier", support: "executable", needsCompany: true },
  recommend_next_investigation: { capability: "stored_briefing", support: "executable", needsCompany: false },
  show_priorities: { capability: "stored_briefing", support: "executable", needsCompany: false },
  // Opens Discover with the objective; the Prospecting Agent keeps its own plan gate and runs only when the user starts it.
  find_prospects: { capability: "prospect_discovery", support: "partial", needsCompany: false },
  // The Deal Intelligence Report plus open questions; there is no written meeting brief yet.
  prepare_meeting: { capability: "deal_report", support: "partial", needsCompany: true },
  compare_companies: { capability: "none", support: "future", needsCompany: false },
};

export const CEO_TEXT_MAX = 500;

export interface CeoConstraints {
  /** Concept keys found in the text (from the existing concept vocabulary). */
  geographies: string[];
  industries: string[];
}

/** What the text alone says. Company mentions are resolved later, inside the organization. */
export interface ParsedRequest {
  /** "unknown" when nothing in the text says what the user wants. */
  type: CeoIntentType | "unknown";
  future: FutureCapability | null;
  /** Website domains written in the text. */
  domains: string[];
  /** A short phrase after "with / about / analyze…", when the text names something ORQO may not know. */
  phrase: string | null;
  constraints: CeoConstraints;
  objective: string;
}

/** The resolved, organization-scoped intent the server answers. */
export interface CeoIntent {
  type: CeoIntentType;
  objective: string;
  entities: CeoEntity[];
  constraints: CeoConstraints;
  context: { organizationId: string };
  requiredCapability: (typeof CEO_CAPABILITIES)[CeoIntentType]["capability"];
  support: CeoSupport;
}

/**
 * A company the request is about, always resolved inside the organization:
 * - known: a remembered company (by id);
 * - researched: stored research exists but the company is not remembered yet;
 * - unresolved: named in the text, unknown to this workspace.
 */
export type CeoEntity =
  | { kind: "company"; resolution: "known"; companyId: string; name: string; domain: string | null }
  | { kind: "company"; resolution: "researched"; companyId: null; name: string; domain: string }
  | { kind: "company"; resolution: "unresolved"; companyId: null; name: string; domain: string | null };

// ---------------------------------------------------------------------------
// Vocabulary (EN + FR, folded: lowercase, no accents). Order of INTENT_RULES matters: first match wins.

const FUTURE_RULES: [FutureCapability, RegExp][] = [
  ["outreach", /\b(send|write|draft|email|e-mail|reach out|contact them|message them|envoie|envoyer|ecris|ecrire|redige|rediger|contacte[rz]?|relance[rz]?)\b.*\b(email|e-mail|mail|message|them|lui|leur|les|linkedin)\b|\b(reach out|cold email|prospecte automatiquement)\b/],
  ["monitoring", /\b(monitor|keep an eye|watch|alert me|notify me|track changes|surveille[rz]?|alerte[rz]?-moi|previens-moi|previens moi|veille sur)\b/],
  ["autonomous_execution", /\b(automatically|on my behalf|without me|for me every|autonomously|automatiquement|a ma place|de maniere autonome|tout seul)\b/],
];

const INTENT_RULES: [CeoIntentType, RegExp][] = [
  ["compare_companies", /\b(compare|comparer|compare[rz]|comparaison|versus|vs\.?)\b/],
  ["prepare_meeting", /\b(meeting|meet with|call with|prepare me|brief me|rendez-vous|rdv|reunion|entretien|prepare[rz]?-moi|prepare[rz]? moi)\b/],
  ["find_prospects", /\b(find|discover|look for|search for|identify|suggest|which companies could|who could help|trouve[rz]?|cherche[rz]?|identifie[rz]?|decouvr\w*|quelles entreprises pourraient|qui pourrait nous aider)\b.*\b(companies|company|partners?|prospects?|customers?|clients?|suppliers?|entreprises?|societes?|partenaires?|fournisseurs?)\b/],
  ["identify_missing_information", /\b(don'?t we know|do not we know|do we not know|we don'?t know|unknowns?|missing|gaps?|ne savons pas|ne sait pas|inconnues?|manque|il nous manque|ignorons)\b/],
  ["explain_opportunity", /\b(explain|why does .* matter|why is .* (an )?opportunit\w*|explique[rz]?|pourquoi .* (compte|opportunite))\b/],
  ["recommend_next_investigation", /\b(investigate next|look at next|look into next|who should i (investigate|look)|which company should|next company|what next|prochaine entreprise|enqueter|investiguer|regarder ensuite|etudier ensuite|quelle entreprise .* ensuite)\b/],
  ["show_priorities", /\b(work on today|today|priorit\w*|deserve my attention|focus on|what should (i|we) (do|work)|which opportunities|aujourd'?hui|sur quoi|meritent|merite mon attention|que dois-je|que devons-nous)\b/],
  ["evaluate_partnership", /\b(could we|can we|what could we|work with|worth|interesting|matter to us|matters to us|opportunit\w*|partner\w*|business with|actually|really|pourrions|pourrait-on|peut-on|que faire avec|travailler avec|interessant\w*|vaut|opportunite\w*|partenariat|affaires avec|vraiment)\b/],
  ["analyze_company", /\b(analy[sz]e|analysis|research|tell me about|who is|what does|look into|study|analyse[rz]?|etudie[rz]?|qui est|que fait|parle-moi de|presente[rz]?-moi)\b/],
];

/** Words after which the text usually names a company. */
const MENTION_LEAD = /\b(?:with|about|analy[sz]e|research|avec|sur|analyse[rz]?|etudie[rz]?|chez)\s+(.{2,60}?)(?=[?.!,;:]|\s+(?:and|et|today|aujourd'?hui|actually|vraiment|for us|pour nous|for me|pour moi|ensuite|next)\b|$)/g;
const DOMAIN = /\b((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/g;
const PHRASE_STOP = new Set(["us", "nous", "them", "eux", "this", "that", "ce", "cette", "cet", "it", "today", "germany", "france", "my", "our", "notre", "nos", "mon", "ma", "mes", "the", "le", "la", "les", "a", "an", "un", "une"]);

export function parseCeoRequest(raw: string): ParsedRequest {
  const objective = raw.replace(/\s+/g, " ").trim().slice(0, CEO_TEXT_MAX);
  const text = foldText(objective);
  const future = FUTURE_RULES.find(([, re]) => re.test(text))?.[0] ?? null;
  const type = INTENT_RULES.find(([, re]) => re.test(text))?.[0] ?? "unknown";
  const domains = [...new Set([...text.matchAll(DOMAIN)].map((m) => m[1]).filter((d) => !/^\d/.test(d)))];
  const concepts = (category: Parameters<typeof conceptsIn>[1]) => [...new Set(conceptsIn([objective], category).filter((k) => !isGeneric(k)))];
  return { type, future, domains, phrase: mentionPhrase(objective, text), constraints: { geographies: concepts("geography"), industries: concepts("industry") }, objective };
}

/**
 * The phrase that most likely names a company: the last "with / about / avec / sur …" phrase, or else a
 * capitalized name that does not start the sentence. Used only to say which company ORQO does not know yet.
 */
function mentionPhrase(original: string, text: string): string | null {
  const leads = [...text.matchAll(MENTION_LEAD)].map((m) => m[1].trim()).filter((x) => x && !PHRASE_STOP.has(x.split(" ")[0]));
  if (leads.length) return leads[leads.length - 1];
  const words = original.split(/\s+/);
  const caps = words.slice(1).filter((w) => /^\p{Lu}[\p{L}\p{N}&.-]+/u.test(w)).map((w) => w.replace(/[?.!,;:]+$/, ""));
  return caps.length ? foldText(caps[0]) : words.length === 1 && /^\p{Lu}/u.test(words[0]) ? foldText(words[0].replace(/[?.!,;:]+$/, "")) : null;
}

// ---------------------------------------------------------------------------
// Company mentions, matched against the organization's own memory (candidates come from the server).

export interface CompanyCandidate {
  id: string;
  name: string;
  website: string | null;
}

const NAME_NOISE = new Set(["the", "and", "group", "groupe", "inc", "llc", "ltd", "corp", "company", "co", "sa", "sas", "sarl", "gmbh", "ag", "plc", "technologies", "technology", "systems", "solutions", "services", "international", "global", "labs", "partners"]);

function termsOf(c: CompanyCandidate): string[] {
  const out = new Set<string>();
  const full = foldText(c.name).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  if (full.length >= 3) out.add(full);
  const first = full.split(" ").find((w) => w.length >= 4 && !NAME_NOISE.has(w));
  if (first) out.add(first);
  if (c.website) {
    const host = c.website.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "").toLowerCase();
    out.add(host);
    const label = host.split(".")[0];
    if (label.length >= 4 && !NAME_NOISE.has(label)) out.add(label);
  }
  return [...out];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The remembered companies the text names, best match first (longest matched term), without duplicates.
 * Matching is on word boundaries, so a short name cannot match inside another word.
 */
export function matchCompanies(raw: string, candidates: readonly CompanyCandidate[]): CompanyCandidate[] {
  const text = foldText(raw);
  const scored: { c: CompanyCandidate; len: number; at: number }[] = [];
  for (const c of candidates) {
    let best: { len: number; at: number } | null = null;
    for (const term of termsOf(c)) {
      const m = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(term)}(?=$|[^\\p{L}\\p{N}])`, "u").exec(text);
      if (m && (!best || term.length > best.len)) best = { len: term.length, at: m.index };
    }
    if (best) scored.push({ c, ...best });
  }
  // A more specific match covers a looser one: "Kestrel Compute" names that company, not every "Kestrel".
  const kept = scored.filter((x) => !scored.some((y) => y !== x && y.len > x.len && y.at <= x.at && y.at + y.len >= x.at + x.len));
  return kept.sort((a, b) => b.len - a.len || a.at - b.at).map((x) => x.c);
}

/** Builds the typed intent once the server resolved the mentioned companies inside the organization. */
export function toIntent(parsed: ParsedRequest, type: CeoIntentType, organizationId: string, entities: CeoEntity[]): CeoIntent {
  const cap = CEO_CAPABILITIES[type];
  return { type, objective: parsed.objective, entities, constraints: parsed.constraints, context: { organizationId }, requiredCapability: cap.capability, support: cap.support };
}
