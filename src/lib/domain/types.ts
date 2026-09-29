/**
 * ORQO domain model. Graph-first: every entity maps to a node label and every
 * reference maps to a typed edge (see lib/graph/elements.ts). Designed so a
 * Neo4j repository can persist it without reshaping.
 */

import type { Tag } from "./taxonomy";

export type ISODate = string;

/** Who may see a piece of information. Agents never disclose above this level. */
export type Visibility = "public" | "network" | "connection" | "agent-only" | "private";

/** Epistemic status of a claim. ORQO never presents inference as fact. */
export type Epistemic = "fact" | "inference" | "assumption";

export type SourceKind =
  | "company-website"
  | "press-release"
  | "news"
  | "public-filing"
  | "self-reported"
  | "conversation"
  | "agent-inferred"
  | "simulated-signal"
  | "web-search";

export interface Source {
  id: string;
  kind: SourceKind;
  label: string;
  url?: string;
  retrievedAt: ISODate;
  /** True for demo data. The UI labels simulated sources explicitly. */
  simulated: boolean;
}

export interface EvidenceRef {
  sourceId: string;
  excerpt: string;
  epistemic: Epistemic;
  /** Generic positioning copy rather than a specific, checkable statement. */
  marketingLanguage?: boolean;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  companyId: string;
  location: string;
  bio: string;
}

export interface Capability {
  id: string;
  companyId: string;
  label: string;
  detail: string;
  tags: Tag[];
  evidence: EvidenceRef[];
  visibility: Visibility;
  observedAt: ISODate;
}

export type NeedIntensity = "exploring" | "active" | "critical";

export interface Need {
  id: string;
  companyId: string;
  label: string;
  detail: string;
  tags: Tag[];
  intensity: NeedIntensity;
  evidence: EvidenceRef[];
  visibility: Visibility;
  /** What agents may say to the other side when visibility is agent-only or private. */
  disclosure?: string;
  observedAt: ISODate;
}

export interface Objective {
  id: string;
  statement: string;
  horizon: string;
  visibility: Visibility;
  evidence: EvidenceRef[];
}

/** A condition a counterparty must meet, e.g. a distributor's vendor requirements. */
export interface Constraint {
  id: string;
  label: string;
  /** Counterparty must hold at least one capability carrying one of these tags. */
  requiresTags: Tag[];
  /** Roles the requirement applies to within an opportunity. */
  appliesTo: ParticipantRole[];
  visibility: Visibility;
  evidence: EvidenceRef[];
}

export type ParticipantRole = "software-vendor" | "hardware-partner" | "vendor" | "distributor" | "seller" | "buyer" | "partner";

export interface Company {
  id: string;
  name: string;
  tagline: string;
  summary: string;
  headquarters: string;
  size: string;
  markets: string[];
  geographies: string[];
  offers: Capability[];
  needs: Need[];
  objectives: Objective[];
  constraints: Constraint[];
  accent: string;
}

export type RelationshipStatus = "unevaluated" | "evaluating" | "dormant" | "watching" | "active" | "matched";

export interface Encounter {
  event: string;
  location: string;
  date: ISODate;
  note: string;
}

/** What the agents concluded at a point in time. Relationships keep full history. */
export interface Evaluation {
  id: string;
  at: ISODate;
  trigger: EvaluationTrigger;
  outcome: "opportunity" | "no-strong-opportunity";
  opportunityIds: string[];
  rejectedHypotheses: RejectedHypothesis[];
  /** Conditions that would change the conclusion; the Re-Evaluation module watches these. */
  watchConditions: WatchCondition[];
  summary: string;
  engine: EngineId;
}

export interface RejectedHypothesis {
  title: string;
  patternId: string;
  verdict: CriticVerdict;
  reasons: string[];
}

export interface WatchCondition {
  id: string;
  companyId: string;
  description: string;
  kind: "capability" | "need-escalation";
  /** Capability: company gains a capability with one of these tags. Need-escalation: a need with these tags becomes active or critical. */
  tags: Tag[];
}

export type EvaluationTrigger =
  | { kind: "connection" }
  | { kind: "signal"; signalId: string }
  | { kind: "network-search"; opportunityIds: string[] };

export interface Relationship {
  id: string;
  personIds: [string, string];
  companyIds: [string, string];
  encounter: Encounter;
  status: RelationshipStatus;
  agentsConnectedAt?: ISODate;
  evaluations: Evaluation[];
  visibility: Visibility;
}

export type OpportunityType =
  | "customer"
  | "supplier"
  | "oem"
  | "technology-integration"
  | "distribution"
  | "channel-partnership"
  | "co-selling"
  | "joint-product"
  | "market-entry"
  | "licensing"
  | "data-partnership"
  | "strategic-alliance";

export type LifecycleStage =
  | "discovered"
  | "interested"
  | "mutual-interest"
  | "meeting"
  | "qualified"
  | "pilot"
  | "partnership"
  | "revenue"
  | "rejected"
  | "dormant";

export interface OpportunityEvidence {
  id: string;
  /** Disclosable form of the claim; safe to show every participant. */
  claim: string;
  /** Raw detail, visible only to the owning company. */
  privateDetail?: string;
  visibility: Visibility;
  epistemic: Epistemic;
  sourceId: string;
  companyId: string;
  marketingLanguage?: boolean;
  /** Capability/need/signal the claim is grounded in. */
  groundedIn?: string;
}

export interface Contribution {
  companyId: string;
  role: ParticipantRole;
  items: string[];
}

export type ConfidenceLevel = "strong" | "moderate" | "limited";

/** Evidence-based confidence. Counts are literal tallies, not scores. */
export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  rationale: string;
  facts: number;
  inferences: number;
  assumptions: number;
}

export type CriticVerdict = "pass" | "weak" | "reject";
export type CheckResult = "pass" | "warn" | "fail";

export interface CriticCheck {
  id: string;
  question: string;
  result: CheckResult;
  note: string;
}

export interface CriticReport {
  verdict: CriticVerdict;
  checks: CriticCheck[];
  summary: string;
}

export type EngineId = "deterministic" | `openrouter:${string}`;

export interface StageChange {
  stage: LifecycleStage;
  at: ISODate;
  reason: string;
}

export interface Opportunity {
  id: string;
  relationshipIds: string[];
  companyIds: string[];
  patternId: string;
  kind: "reciprocal" | "customer" | "multi";
  roles: Record<string, ParticipantRole>;
  /** Needs the structure depends on; lets the Critic re-run on stored opportunities. */
  drivingNeedIds: string[];
  title: string;
  types: OpportunityType[];
  summary: string;
  whyExists: string;
  whyNow: string;
  contributions: Contribution[];
  structure: string;
  evidence: OpportunityEvidence[];
  assumptions: string[];
  unknowns: string[];
  questions: string[];
  risks: string[];
  nextStep: string;
  /** Capabilities no participant provides; drives Multi-Company Discovery. */
  missingCapabilities: Tag[];
  confidence: ConfidenceAssessment;
  critic: CriticReport;
  stage: LifecycleStage;
  stageHistory: StageChange[];
  discoveredAt: ISODate;
  trigger: EvaluationTrigger;
  engine: EngineId;
  /** For re-evaluated or composed opportunities: what changed and why it did not exist before. */
  delta?: OpportunityDelta;
  parentOpportunityIds?: string[];
}

export interface OpportunityDelta {
  whatChanged: string;
  whyNowRelevant: string;
  whyNotBefore: string;
}

export type ConsentResponse = "interested" | "not-now" | "not-relevant" | "never";

/** Private to the responding person until every party is interested. */
export interface Consent {
  opportunityId: string;
  personId: string;
  response: ConsentResponse;
  respondedAt: ISODate;
  visibility: "private";
}

export interface MeetingBrief {
  opportunityId: string;
  createdAt: ISODate;
  title: string;
  duration: string;
  objective: string;
  agenda: { item: string; minutes: number; owner: string }[];
  keyQuestions: string[];
  stakeholders: { personId?: string; name: string; role: string; companyId: string; why: string }[];
  brief: string;
  nextActions: { action: string; ownerCompanyId: string }[];
}

export type SignalType =
  | "market-expansion"
  | "funding"
  | "product-launch"
  | "hiring"
  | "partnership"
  | "leadership-change";

export interface SignalEffect {
  addCapabilities?: Capability[];
  escalateNeeds?: { needId: string; intensity: NeedIntensity; evidence: EvidenceRef; disclosure?: string }[];
  addObjectives?: Objective[];
  addGeographies?: string[];
}

export interface Signal {
  id: string;
  companyId: string;
  type: SignalType;
  headline: string;
  description: string;
  sourceId: string;
  occurredAt: ISODate;
  effect: SignalEffect;
  /** Filled by the Re-Evaluation module after detection. */
  affectedRelationshipIds: string[];
  simulated: boolean;
}

export interface Outcome {
  id: string;
  opportunityId: string;
  stage: LifecycleStage;
  reason: string;
  recordedAt: ISODate;
}

export type AgentModule =
  | "research"
  | "bilateral"
  | "discovery"
  | "critic"
  | "orchestration"
  | "reevaluation"
  | "network";

export interface AgentActivity {
  id: string;
  at: ISODate;
  module: AgentModule;
  message: string;
  relatedIds: string[];
}

/** The complete ORQO world state; the in-memory graph. */
export interface World {
  now: ISODate;
  viewerId: string;
  people: Record<string, Person>;
  companies: Record<string, Company>;
  sources: Record<string, Source>;
  relationships: Record<string, Relationship>;
  opportunities: Record<string, Opportunity>;
  consents: Consent[];
  briefs: Record<string, MeetingBrief>;
  signals: Record<string, Signal>;
  outcomes: Outcome[];
  activity: AgentActivity[];
  proposals: Record<string, NetworkProposal>;
}

export interface CandidateScan {
  companyId: string;
  provides: boolean;
  note: string;
}

/** A Multi-Company Discovery result awaiting a human decision. */
export interface NetworkProposal {
  id: string;
  baseOpportunityIds: string[];
  missing: Tag[];
  candidateCompanyId: string;
  scanned: CandidateScan[];
  opportunity: Opportunity;
  status: "proposed" | "created" | "dismissed";
  createdAt: ISODate;
}
