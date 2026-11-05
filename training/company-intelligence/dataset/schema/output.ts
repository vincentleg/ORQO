/**
 * ORQO Company Intelligence v1 — the output contract of the trained "Business Intelligence Brain".
 *
 * One strict, machine-readable analysis of ONE target company, made for ONE represented company, from the
 * evidence supplied with the request (and nothing else). It reuses ORQO's vocabulary so it maps onto a
 * mission finding without a translation layer (see ../../eval/finding.ts):
 *
 *   epistemics       FACT / INFERENCE / UNKNOWN          (intelligence/types EPISTEMICS, minus "assumption")
 *   confidence       strong / moderate / limited          (intelligence/types CONFIDENCE_LEVELS — no percentages)
 *   relationship     customer, supplier, oem, …           (intelligence/types RELATIONSHIP_TYPES)
 *   business model   offering_form / revenue_model / customer_scope  (understanding/ontology DIMENSIONS)
 *   unknown fields   UNDERSTANDING_FIELDS + a few technical fields
 *
 * Traceability rule (enforced by the schema and the scorer):
 *   - a FACT cites evidence ids AND carries `quote`, a verbatim excerpt of one cited evidence item;
 *   - an INFERENCE cites the evidence ids it is derived from;
 *   - anything else is UNKNOWN and listed in `unknowns` — never filled in.
 * Named entities (products, customers, partners, places stated as fact) must appear in their quote.
 * There is deliberately NO field for a person's name, email or phone: decision makers are ROLES.
 *
 * Pure: zod only. No framework, I/O or provider.
 */
import { z } from "zod";
import { CONFIDENCE_LEVELS, RELATIONSHIP_TYPES, UNDERSTANDING_FIELDS } from "@/lib/intelligence/types";
import { DIMENSIONS } from "@/lib/understanding/ontology";

export const CONTRACT_VERSION = "orqo.company_intelligence/v1" as const;

export const EvidenceId = z.string().regex(/^e[0-9]{1,3}$/);
const Text = (max: number) => z.string().trim().min(2).max(max);
const Evidence = z.array(EvidenceId).max(8);

/** A traceable statement. FACT ⇒ quote + ≥1 evidence id; INFERENCE ⇒ ≥1 evidence id. */
export const ClaimSchema = z
  .strictObject({
    statement: Text(400),
    basis: z.enum(["fact", "inference"]),
    evidence: Evidence,
    quote: z.string().min(8).max(300).optional(),
  })
  .refine((c) => c.evidence.length > 0, { message: "a claim must cite evidence", path: ["evidence"] })
  .refine((c) => c.basis !== "fact" || !!c.quote, { message: "a fact needs a verbatim quote", path: ["quote"] });
export type Claim = z.infer<typeof ClaimSchema>;

/** A named entity stated by the evidence (product, customer, partner). Always a FACT with a quote containing the name. */
const NamedFact = z.strictObject({ name: Text(120), description: z.string().max(300), basis: z.literal("fact"), evidence: Evidence.min(1), quote: z.string().min(8).max(300) });

export const PRESENCE = ["present", "absent", "unknown"] as const;
/** A deployment / technical characteristic. unknown ⇔ basis unknown ⇔ no evidence. */
export const SignalSchema = z
  .strictObject({ status: z.enum(PRESENCE), basis: z.enum(["fact", "inference", "unknown"]), evidence: Evidence, quote: z.string().min(8).max(300).optional(), rationale: z.string().max(300) })
  .refine((s) => (s.status === "unknown") === (s.basis === "unknown"), { message: "status unknown ⇔ basis unknown" })
  .refine((s) => s.status === "unknown" || s.evidence.length > 0, { message: "a known signal must cite evidence" })
  .refine((s) => s.basis !== "fact" || !!s.quote, { message: "a fact needs a verbatim quote" });
export type Signal = z.infer<typeof SignalSchema>;
export const SIGNALS = ["cloud", "onPrem", "edge", "hardware"] as const;
export type SignalKey = (typeof SIGNALS)[number];

export const LOCATION_KINDS = ["headquarters", "office", "operations", "customers", "sales_coverage", "registered"] as const;
const LocationSchema = z
  .strictObject({ place: Text(120), kind: z.enum(LOCATION_KINDS), basis: z.enum(["fact", "inference"]), evidence: Evidence.min(1), quote: z.string().min(8).max(300).optional() })
  .refine((l) => l.basis !== "fact" || !!l.quote, { message: "a fact needs a verbatim quote" });

export const MATURITY_STAGES = ["pre_commercial", "early_commercial", "growth", "established", "unknown"] as const;
export const FIT_CLASSES = ["excellent", "moderate", "poor", "insufficient_evidence"] as const;
export type FitClass = (typeof FIT_CLASSES)[number];
/** fit.score must sit in its class band (insufficient_evidence ⇒ null). The ORQO UI shows the class, never the number. */
export const FIT_BANDS: Record<Exclude<FitClass, "insufficient_evidence">, [number, number]> = { excellent: [75, 100], moderate: [40, 74], poor: [0, 39] };

export const DECISION_FUNCTIONS = ["executive", "engineering", "product", "operations", "it_infrastructure", "security", "procurement", "sales", "partnerships", "marketing", "finance", "clinical", "research"] as const;
export const NEXT_ACTIONS = ["validate_fit", "gather_evidence", "engage_role", "deprioritize", "complete_own_profile"] as const;
export type NextActionKind = (typeof NEXT_ACTIONS)[number];

export const UNKNOWN_FIELDS = [...UNDERSTANDING_FIELDS, "deployment", "technology", "maturity", "decision_makers", "pricing", "scale", "partnerships"] as const;
export type UnknownField = (typeof UNKNOWN_FIELDS)[number];

export const CompanyIntelligenceSchema = z
  .strictObject({
    schemaVersion: z.literal(CONTRACT_VERSION),
    company: z.strictObject({ name: Text(200), domain: z.string().regex(/^[a-z0-9.-]{3,253}$/), website: z.string().max(500).nullable() }),
    /** What the company actually does (not its slogan). */
    summary: ClaimSchema,
    products: z.array(NamedFact).max(10),
    namedCustomers: z.array(NamedFact).max(10),
    partnerships: z.array(NamedFact).max(10),
    businessModel: z.strictObject({
      offeringForms: z.array(z.enum(DIMENSIONS.offering_form)).max(4),
      revenueModels: z.array(z.enum(DIMENSIONS.revenue_model)).max(4),
      customerScope: z.array(z.enum(DIMENSIONS.customer_scope)).max(4),
      claims: z.array(ClaimSchema).max(6),
    }),
    markets: z.array(z.strictObject({ label: Text(80), claim: ClaimSchema })).max(8),
    deployment: z.strictObject({ cloud: SignalSchema, onPrem: SignalSchema, edge: SignalSchema, hardware: SignalSchema }),
    technicalSignals: z.array(ClaimSchema).max(8),
    geography: z.strictObject({ status: z.enum(["known", "unknown"]), locations: z.array(LocationSchema).max(10) }).refine((g) => (g.status === "unknown") === (g.locations.length === 0), { message: "geography unknown ⇔ no locations" }),
    maturity: z.strictObject({ stage: z.enum(MATURITY_STAGES), basis: z.enum(["fact", "inference", "unknown"]), evidence: Evidence, rationale: z.string().max(300) }).refine((m) => (m.stage === "unknown") === (m.basis === "unknown"), { message: "stage unknown ⇔ basis unknown" }),
    /** Two pieces of evidence that disagree with each other (never resolved silently). */
    conflicts: z.array(z.strictObject({ description: Text(300), evidence: z.array(EvidenceId).min(2).max(6) })).max(5),
    fit: z
      .strictObject({ class: z.enum(FIT_CLASSES), score: z.number().int().min(0).max(100).nullable(), rationale: Text(600), supporting: z.array(ClaimSchema).max(6), contradicting: z.array(ClaimSchema).max(6) })
      .refine((f) => (f.class === "insufficient_evidence" ? f.score === null : f.score !== null && f.score >= FIT_BANDS[f.class][0] && f.score <= FIT_BANDS[f.class][1]), { message: "fit.score must sit in its class band (null for insufficient_evidence)" }),
    /** The commercial thesis. null when there is no credible opportunity (that is a valid answer). */
    opportunity: z
      .strictObject({ relationship: z.enum(RELATIONSHIP_TYPES), thesis: Text(600), ownBrings: Text(300), targetBrings: Text(300), basis: z.literal("inference"), evidence: Evidence.min(1) })
      .nullable(),
    /** Roles, never people. */
    decisionMakerRoles: z.array(z.strictObject({ role: Text(80), function: z.enum(DECISION_FUNCTIONS), rationale: Text(300) })).max(5),
    unknowns: z.array(z.strictObject({ field: z.enum(UNKNOWN_FIELDS), question: Text(300) })).max(12),
    confidence: z.strictObject({ level: z.enum(CONFIDENCE_LEVELS), rationale: Text(400) }),
    nextAction: z.strictObject({ kind: z.enum(NEXT_ACTIONS), text: Text(400) }),
  })
  .refine((o) => o.fit.class !== "insufficient_evidence" || o.confidence.level === "limited", { message: "insufficient_evidence implies limited confidence", path: ["confidence"] });

export type CompanyIntelligence = z.infer<typeof CompanyIntelligenceSchema>;

/** Every traceable statement in an output, with where it sits (for the grounding checks). */
export interface LocatedClaim {
  path: string;
  basis: "fact" | "inference";
  evidence: string[];
  quote?: string;
  /** A named entity that must appear in the quote (products, customers, partners, fact locations). */
  entity?: string;
  kind: "claim" | "named" | "signal" | "location";
}

export function claimsOf(o: CompanyIntelligence): LocatedClaim[] {
  const out: LocatedClaim[] = [];
  const claim = (path: string, c: Claim) => out.push({ path, basis: c.basis, evidence: c.evidence, quote: c.quote, kind: "claim" });
  claim("summary", o.summary);
  for (const [k, list] of [["products", o.products], ["namedCustomers", o.namedCustomers], ["partnerships", o.partnerships]] as const) list.forEach((n, i) => out.push({ path: `${k}[${i}]`, basis: "fact", evidence: n.evidence, quote: n.quote, entity: n.name, kind: "named" }));
  o.businessModel.claims.forEach((c, i) => claim(`businessModel.claims[${i}]`, c));
  o.markets.forEach((m, i) => claim(`markets[${i}]`, m.claim));
  for (const k of SIGNALS) {
    const s = o.deployment[k];
    if (s.basis !== "unknown") out.push({ path: `deployment.${k}`, basis: s.basis, evidence: s.evidence, quote: s.quote, kind: "signal" });
  }
  o.technicalSignals.forEach((c, i) => claim(`technicalSignals[${i}]`, c));
  o.geography.locations.forEach((l, i) => out.push({ path: `geography.locations[${i}]`, basis: l.basis, evidence: l.evidence, quote: l.quote, entity: l.basis === "fact" ? l.place : undefined, kind: "location" }));
  o.fit.supporting.forEach((c, i) => claim(`fit.supporting[${i}]`, c));
  o.fit.contradicting.forEach((c, i) => claim(`fit.contradicting[${i}]`, c));
  return out;
}
