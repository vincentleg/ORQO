/**
 * Network relationship memory (Phase 6): relationship metadata, contacts,
 * interactions, follow-ups and the trigger-written history of one
 * organization. Every call runs as the signed-in user, so RLS is the backstop;
 * every query also filters on the organization, and child rows are checked to
 * belong to the same Network company before they are written.
 *
 * All of this is PRIVATE relationship knowledge recorded by people. It is never
 * mixed with public web evidence, and no provider or model is called here.
 */
import { z } from "zod";
import {
  FOLLOW_UP_ORIGINS,
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_STATUSES,
  INTERACTION_KINDS,
  NETWORK_EVENT_KINDS,
  NETWORK_ORIGINS,
  NETWORK_STAGES,
  effectiveOrigin,
  followUpOrigin,
  isIsoDay,
  type ContactView,
  type FollowUpView,
  type InteractionView,
  type NetworkEventView,
  type NetworkOrigin,
  type NetworkStage,
} from "@/lib/network/model";
import { AppError, fromDbError, parseInput } from "@/lib/server/errors";
import { IsoTimestamp } from "@/lib/server/orqo/schemas";
import type { Db } from "@/lib/server/supabase/types";

const Text = (max: number) => z.string().trim().max(max);
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const HttpUrl = z.url({ protocol: /^https?$/ }).max(500);
const IsoDay = z.string().refine(isIsoDay, "Expected a calendar day (YYYY-MM-DD).");

// ---------------------------------------------------------------------------
// Network companies
// ---------------------------------------------------------------------------

const NETWORK_COMPANY_COLUMNS = "id, name, website, summary, markets, geographies, is_own_company, external_ref, network_stage, network_origin, network_reason, origin_event_id, created_at";

const NetworkCompanyRow = z.object({
  id: z.uuid(),
  name: z.string(),
  website: z.string().nullable(),
  summary: z.string(),
  markets: z.array(z.string()),
  geographies: z.array(z.string()),
  is_own_company: z.boolean(),
  external_ref: z.string().nullable(),
  network_stage: z.enum(NETWORK_STAGES).nullable(),
  network_origin: z.enum(NETWORK_ORIGINS).nullable(),
  network_reason: z.string(),
  origin_event_id: z.uuid().nullable(),
  created_at: IsoTimestamp,
});

export interface NetworkCompany {
  id: string;
  name: string;
  website: string | null;
  summary: string;
  markets: string[];
  geographies: string[];
  isOwnCompany: boolean;
  externalRef: string | null;
  stage: NetworkStage | null;
  /** Recorded, or proven by stored provenance; null when unknown. */
  origin: NetworkOrigin | null;
  /** True when the origin was recorded by a person or at creation, false when derived from provenance. */
  originRecorded: boolean;
  reason: string;
  /** Phase 8: the event through which the company entered the Network (written once, at creation). */
  originEventId: string | null;
  addedAt: string;
}

function toCompany(r: z.infer<typeof NetworkCompanyRow>): NetworkCompany {
  return {
    id: r.id,
    name: r.name,
    website: r.website,
    summary: r.summary,
    markets: r.markets,
    geographies: r.geographies,
    isOwnCompany: r.is_own_company,
    externalRef: r.external_ref,
    stage: r.network_stage,
    origin: effectiveOrigin(r.network_origin, r.external_ref),
    originRecorded: r.network_origin !== null,
    reason: r.network_reason,
    originEventId: r.origin_event_id,
    addedAt: r.created_at,
  };
}

export async function listNetworkCompanies(db: Db, organizationId: string): Promise<NetworkCompany[]> {
  const { data, error } = await db.from("companies").select(NETWORK_COMPANY_COLUMNS).eq("organization_id", organizationId).order("created_at", { ascending: true });
  if (error) throw fromDbError(error);
  return z.array(NetworkCompanyRow).parse(data).map(toCompany);
}

export async function getNetworkCompany(db: Db, organizationId: string, companyId: string): Promise<NetworkCompany | null> {
  if (!z.uuid().safeParse(companyId).success) return null;
  const { data, error } = await db.from("companies").select(NETWORK_COMPANY_COLUMNS).eq("organization_id", organizationId).eq("id", companyId).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? toCompany(NetworkCompanyRow.parse(data)) : null;
}

/** A Network company (never the organization's own company) of this organization, or not_found. */
async function requireNetworkCompany(db: Db, organizationId: string, companyId: string): Promise<NetworkCompany> {
  const c = await getNetworkCompany(db, organizationId, companyId);
  if (!c || c.isOwnCompany) throw new AppError("not_found", "Company not found.");
  return c;
}

export const RelationshipUpdate = z.strictObject({
  stage: z.enum(NETWORK_STAGES).nullable(),
  origin: z.enum(NETWORK_ORIGINS).nullable(),
  reason: Text(2000),
});

/** Stage, origin and "why it matters" — set by a person. A stage change is recorded in the history by the database. */
export async function updateRelationship(db: Db, organizationId: string, companyId: string, input: z.input<typeof RelationshipUpdate>): Promise<void> {
  const u = parseInput(RelationshipUpdate, input);
  await requireNetworkCompany(db, organizationId, companyId);
  const { data, error } = await db
    .from("companies")
    .update({ network_stage: u.stage, network_origin: u.origin, network_reason: u.reason })
    .eq("organization_id", organizationId)
    .eq("id", companyId)
    .eq("is_own_company", false)
    .select("id");
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) throw new AppError("not_found", "Company not found.");
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const CONTACT_COLUMNS = "id, company_id, name, role, email, phone, profile_url, notes, is_primary, created_at";
const ContactRow = z.object({
  id: z.uuid(),
  company_id: z.uuid().nullable(),
  name: z.string(),
  role: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  profile_url: z.string().nullable(),
  notes: z.string(),
  is_primary: z.boolean(),
  created_at: IsoTimestamp,
});
const toContact = (r: z.infer<typeof ContactRow>): ContactView & { companyId: string | null } => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  role: r.role,
  email: r.email,
  phone: r.phone,
  profileUrl: r.profile_url,
  notes: r.notes,
  isPrimary: r.is_primary,
  createdAt: r.created_at,
});

export const ContactInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  role: Text(200).default(""),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.email().nullable()),
  phone: OptionalText(50).pipe(z.string().min(3).nullable()),
  profileUrl: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(HttpUrl.nullable()),
  notes: Text(4000).default(""),
  isPrimary: z.boolean().default(false),
});

async function clearPrimary(db: Db, organizationId: string, companyId: string, exceptId: string | null): Promise<void> {
  let q = db.from("contacts").update({ is_primary: false }).eq("organization_id", organizationId).eq("company_id", companyId).eq("is_primary", true);
  if (exceptId) q = q.neq("id", exceptId);
  const { error } = await q;
  if (error) throw fromDbError(error);
}

/** `eventId` is set only by the server when a contact is recorded at an event (Phase 8). */
export async function createNetworkContact(db: Db, organizationId: string, companyId: string, input: z.input<typeof ContactInput>, opts: { eventId?: string } = {}): Promise<string> {
  const c = parseInput(ContactInput, input);
  await requireNetworkCompany(db, organizationId, companyId);
  if (opts.eventId) await assertEvent(db, organizationId, opts.eventId);
  if (c.isPrimary) await clearPrimary(db, organizationId, companyId, null);
  const { data, error } = await db
    .from("contacts")
    .insert({ organization_id: organizationId, company_id: companyId, name: c.name, role: c.role, email: c.email, phone: c.phone, profile_url: c.profileUrl, notes: c.notes, is_primary: c.isPrimary, event_id: opts.eventId ?? null })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.uuid() }).parse(data).id;
}

export async function updateNetworkContact(db: Db, organizationId: string, companyId: string, contactId: string, input: z.input<typeof ContactInput>): Promise<void> {
  const c = parseInput(ContactInput, input);
  await requireNetworkCompany(db, organizationId, companyId);
  if (!z.uuid().safeParse(contactId).success) throw new AppError("not_found", "Contact not found.");
  if (c.isPrimary) await clearPrimary(db, organizationId, companyId, contactId);
  const { data, error } = await db
    .from("contacts")
    .update({ name: c.name, role: c.role, email: c.email, phone: c.phone, profile_url: c.profileUrl, notes: c.notes, is_primary: c.isPrimary })
    .eq("organization_id", organizationId)
    .eq("company_id", companyId)
    .eq("id", contactId)
    .select("id");
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) throw new AppError("not_found", "Contact not found.");
}

/** The contact must be one of this company's contacts (not just of the organization). */
async function assertCompanyContact(db: Db, organizationId: string, companyId: string, contactId: string | null): Promise<void> {
  if (!contactId) return;
  const { data, error } = await db.from("contacts").select("id").eq("organization_id", organizationId).eq("company_id", companyId).eq("id", contactId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new AppError("invalid_input", "This contact does not belong to the company.");
}

/** The event must be one of this organization's events (the composite foreign key also enforces it). */
async function assertEvent(db: Db, organizationId: string, eventId: string): Promise<void> {
  if (!z.uuid().safeParse(eventId).success) throw new AppError("not_found", "Event not found.");
  const { data, error } = await db.from("events").select("id").eq("organization_id", organizationId).eq("id", eventId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new AppError("not_found", "Event not found.");
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

const INTERACTION_COLUMNS = "id, company_id, contact_id, kind, occurred_at, title, summary, outcome, next_step, event_id, created_at";
const InteractionRow = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  contact_id: z.uuid().nullable(),
  kind: z.enum(INTERACTION_KINDS),
  occurred_at: IsoTimestamp,
  title: z.string(),
  summary: z.string(),
  outcome: z.string(),
  next_step: z.string(),
  event_id: z.uuid().nullable(),
  created_at: IsoTimestamp,
});
const toInteraction = (r: z.infer<typeof InteractionRow>): InteractionView => ({
  id: r.id,
  companyId: r.company_id,
  contactId: r.contact_id,
  kind: r.kind,
  occurredAt: r.occurred_at,
  title: r.title,
  summary: r.summary,
  outcome: r.outcome,
  nextStep: r.next_step,
  eventId: r.event_id,
  createdAt: r.created_at,
});

export const InteractionInput = z.strictObject({
  kind: z.enum(INTERACTION_KINDS),
  occurredAt: z.iso.datetime({ offset: true }),
  contactId: z.uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
  summary: Text(8000).default(""),
  outcome: Text(2000).default(""),
  nextStep: Text(500).default(""),
});

/** `eventId` is set only by the server when the interaction happened at an event (Phase 8). */
export async function recordInteraction(db: Db, organizationId: string, companyId: string, input: z.input<typeof InteractionInput>, opts: { eventId?: string } = {}): Promise<string> {
  const i = parseInput(InteractionInput, input);
  await requireNetworkCompany(db, organizationId, companyId);
  await assertCompanyContact(db, organizationId, companyId, i.contactId);
  if (opts.eventId) await assertEvent(db, organizationId, opts.eventId);
  const { data, error } = await db
    .from("interactions")
    .insert({ organization_id: organizationId, company_id: companyId, contact_id: i.contactId, kind: i.kind, occurred_at: i.occurredAt, title: i.title, summary: i.summary, outcome: i.outcome, next_step: i.nextStep, event_id: opts.eventId ?? null })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.uuid() }).parse(data).id;
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

const FOLLOW_UP_COLUMNS = "id, company_id, contact_id, interaction_id, title, description, due_on, status, priority, origin, assigned_to, closed_at, event_id, created_at";
const FollowUpRow = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  contact_id: z.uuid().nullable(),
  interaction_id: z.uuid().nullable(),
  title: z.string(),
  description: z.string(),
  due_on: z.string().nullable(),
  status: z.enum(FOLLOW_UP_STATUSES),
  priority: z.enum(FOLLOW_UP_PRIORITIES),
  origin: z.enum(FOLLOW_UP_ORIGINS),
  assigned_to: z.uuid().nullable(),
  closed_at: IsoTimestamp.nullable(),
  event_id: z.uuid().nullable(),
  created_at: IsoTimestamp,
});
const toFollowUp = (r: z.infer<typeof FollowUpRow>): FollowUpView => ({
  id: r.id,
  companyId: r.company_id,
  contactId: r.contact_id,
  interactionId: r.interaction_id,
  title: r.title,
  description: r.description,
  dueOn: r.due_on,
  status: r.status,
  priority: r.priority,
  origin: r.origin,
  assignedTo: r.assigned_to,
  closedAt: r.closed_at,
  eventId: r.event_id,
  createdAt: r.created_at,
});

export const FollowUpInput = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: Text(4000).default(""),
  dueOn: IsoDay.nullable().default(null),
  priority: z.enum(FOLLOW_UP_PRIORITIES).default("normal"),
  contactId: z.uuid().nullable().default(null),
  interactionId: z.uuid().nullable().default(null),
  assignedTo: z.uuid().nullable().default(null),
});

/**
 * `fromSignal` is set only by the server when a person explicitly creates a follow-up from a public signal (Phase 7);
 * `eventId` when they create it in the context of an event (Phase 8). The origin keeps its Phase 6/7 meaning: a
 * follow-up from an interaction's next step stays origin "interaction", and the event is kept as context.
 */
export async function createFollowUp(db: Db, organizationId: string, companyId: string, input: z.input<typeof FollowUpInput>, opts: { fromSignal?: boolean; eventId?: string } = {}): Promise<string> {
  const f = parseInput(FollowUpInput, input);
  await requireNetworkCompany(db, organizationId, companyId);
  await assertCompanyContact(db, organizationId, companyId, f.contactId);
  if (opts.eventId) await assertEvent(db, organizationId, opts.eventId);
  if (f.interactionId) {
    const { data, error } = await db.from("interactions").select("id").eq("organization_id", organizationId).eq("company_id", companyId).eq("id", f.interactionId).maybeSingle();
    if (error) throw fromDbError(error);
    if (!data) throw new AppError("invalid_input", "This interaction does not belong to the company.");
  }
  const { data, error } = await db
    .from("follow_ups")
    .insert({
      organization_id: organizationId,
      company_id: companyId,
      contact_id: f.contactId,
      interaction_id: f.interactionId,
      title: f.title,
      description: f.description,
      due_on: f.dueOn,
      priority: f.priority,
      origin: followUpOrigin({ interactionId: f.interactionId, fromSignal: opts.fromSignal, eventId: opts.eventId }),
      event_id: opts.eventId ?? null,
      // The database also checks that the assignee is a member of this organization.
      assigned_to: f.assignedTo,
    })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.uuid() }).parse(data).id;
}

/** open → done / dismissed, or reopened. closed_at and the history entry are set by the database. */
export async function setFollowUpStatus(db: Db, organizationId: string, followUpId: string, status: unknown): Promise<{ companyId: string }> {
  const s = parseInput(z.enum(FOLLOW_UP_STATUSES), status);
  if (!z.uuid().safeParse(followUpId).success) throw new AppError("not_found", "Follow-up not found.");
  const { data, error } = await db.from("follow_ups").update({ status: s }).eq("organization_id", organizationId).eq("id", followUpId).select("company_id");
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) throw new AppError("not_found", "Follow-up not found.");
  return { companyId: z.object({ company_id: z.uuid() }).parse(data[0]).company_id };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const EventRow = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  kind: z.enum(NETWORK_EVENT_KINDS),
  subject_id: z.uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  occurred_at: IsoTimestamp,
});
const StageOrNull = z.enum(NETWORK_STAGES).nullable().catch(null);

export interface CompanyMemory {
  contacts: ContactView[];
  interactions: InteractionView[];
  followUps: FollowUpView[];
  events: NetworkEventView[];
}

/** Everything recorded about one Network company. Bounded reads: the most recent 200 of each kind. */
export async function getCompanyMemory(db: Db, organizationId: string, companyId: string): Promise<CompanyMemory> {
  const [contacts, interactions, followUps, events] = await Promise.all([
    db.from("contacts").select(CONTACT_COLUMNS).eq("organization_id", organizationId).eq("company_id", companyId).order("created_at", { ascending: true }).limit(200),
    db.from("interactions").select(INTERACTION_COLUMNS).eq("organization_id", organizationId).eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(200),
    db.from("follow_ups").select(FOLLOW_UP_COLUMNS).eq("organization_id", organizationId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(200),
    db.from("network_events").select("id, kind, subject_id, metadata, occurred_at").eq("organization_id", organizationId).eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(200),
  ]);
  for (const r of [contacts, interactions, followUps, events]) if (r.error) throw fromDbError(r.error);
  return {
    contacts: z.array(ContactRow).parse(contacts.data).map(toContact),
    interactions: z.array(InteractionRow).parse(interactions.data).map(toInteraction),
    followUps: z.array(FollowUpRow).parse(followUps.data).map(toFollowUp),
    events: z
      .array(EventRow)
      .parse(events.data)
      .map((e) => ({ id: e.id, kind: e.kind, subjectId: e.subject_id, from: StageOrNull.parse(e.metadata.from ?? null), to: StageOrNull.parse(e.metadata.to ?? null), occurredAt: e.occurred_at })),
  };
}

export interface NetworkOverview {
  companies: NetworkCompany[];
  contactsByCompany: Map<string, ContactView[]>;
  latestInteractionByCompany: Map<string, InteractionView>;
  followUps: FollowUpView[];
}

/**
 * The Network home in four organization-wide reads: companies, contacts,
 * recent interactions (newest first) and follow-ups (all open ones, plus the
 * most recently closed).
 */
export async function getNetworkOverview(db: Db, organizationId: string): Promise<NetworkOverview> {
  const [companies, contacts, interactions, open, closed] = await Promise.all([
    listNetworkCompanies(db, organizationId),
    db.from("contacts").select(CONTACT_COLUMNS).eq("organization_id", organizationId).not("company_id", "is", null).order("created_at", { ascending: true }).limit(2000),
    db.from("interactions").select(INTERACTION_COLUMNS).eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(1000),
    db.from("follow_ups").select(FOLLOW_UP_COLUMNS).eq("organization_id", organizationId).eq("status", "open").order("due_on", { ascending: true, nullsFirst: false }).limit(500),
    db.from("follow_ups").select(FOLLOW_UP_COLUMNS).eq("organization_id", organizationId).neq("status", "open").order("closed_at", { ascending: false }).limit(50),
  ]);
  for (const r of [contacts, interactions, open, closed]) if (r.error) throw fromDbError(r.error);
  const contactsByCompany = new Map<string, ContactView[]>();
  for (const c of z.array(ContactRow).parse(contacts.data).map(toContact)) {
    if (!c.companyId) continue;
    contactsByCompany.set(c.companyId, [...(contactsByCompany.get(c.companyId) ?? []), c]);
  }
  const latestInteractionByCompany = new Map<string, InteractionView>();
  for (const i of z.array(InteractionRow).parse(interactions.data).map(toInteraction)) if (!latestInteractionByCompany.has(i.companyId)) latestInteractionByCompany.set(i.companyId, i);
  return {
    companies,
    contactsByCompany,
    latestInteractionByCompany,
    followUps: [...z.array(FollowUpRow).parse(open.data), ...z.array(FollowUpRow).parse(closed.data)].map(toFollowUp),
  };
}

// ---------------------------------------------------------------------------
// Opportunities already recorded for a company (existing Phase 1 model)
// ---------------------------------------------------------------------------

const OpportunityLink = z.object({
  role: z.string(),
  opportunities: z.object({ id: z.uuid(), title: z.string(), stage: z.string(), next_step: z.string(), summary: z.string() }),
});

export interface CompanyOpportunity {
  id: string;
  title: string;
  stage: string;
  nextStep: string;
  summary: string;
  role: string;
}

export async function listCompanyOpportunities(db: Db, organizationId: string, companyId: string): Promise<CompanyOpportunity[]> {
  const { data, error } = await db
    .from("opportunity_participants")
    .select("role, opportunities!inner(id, title, stage, next_step, summary)")
    .eq("organization_id", organizationId)
    .eq("company_id", companyId)
    .limit(50);
  if (error) throw fromDbError(error);
  return z
    .array(OpportunityLink)
    .parse(data)
    .map((r) => ({ id: r.opportunities.id, title: r.opportunities.title, stage: r.opportunities.stage, nextStep: r.opportunities.next_step, summary: r.opportunities.summary, role: r.role }));
}

// ---------------------------------------------------------------------------
// Agent seam: relationship context (read-only, data-minimized)
// ---------------------------------------------------------------------------

export interface RelationshipContext {
  /** Everything below was recorded privately by this workspace's people; never public evidence. */
  provenance: "private_relationship_memory";
  company: { id: string; name: string; stage: NetworkStage | null; origin: NetworkOrigin | null };
  contacts: { id: string; name: string; role: string; isPrimary: boolean }[];
  recentInteractions: { kind: InteractionView["kind"]; occurredAt: string; title: string; nextStep: string }[];
  openFollowUps: { title: string; dueOn: string | null; priority: FollowUpView["priority"] }[];
}

/**
 * What a future Relationship or Follow-up agent may read about one Network
 * company. Contact channels (email, phone, profile) and free-text notes are
 * deliberately left out; the agent gets only what it needs to prepare a
 * recommendation for a human.
 */
export async function readRelationshipContext(db: Db, organizationId: string, companyId: string): Promise<RelationshipContext | null> {
  const company = await getNetworkCompany(db, organizationId, companyId);
  if (!company || company.isOwnCompany) return null;
  const memory = await getCompanyMemory(db, organizationId, companyId);
  return {
    provenance: "private_relationship_memory",
    company: { id: company.id, name: company.name, stage: company.stage, origin: company.origin },
    contacts: memory.contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, isPrimary: c.isPrimary })),
    recentInteractions: memory.interactions.slice(0, 10).map((i) => ({ kind: i.kind, occurredAt: i.occurredAt, title: i.title, nextStep: i.nextStep })),
    openFollowUps: memory.followUps.filter((f) => f.status === "open").map((f) => ({ title: f.title, dueOn: f.dueOn, priority: f.priority })),
  };
}

// ---------------------------------------------------------------------------
// Phase 8: canonical records seen through an event (reads only)
// ---------------------------------------------------------------------------

/** Interactions recorded with this event as context, newest first. */
export async function listEventInteractions(db: Db, organizationId: string, eventId: string): Promise<InteractionView[]> {
  const { data, error } = await db.from("interactions").select(INTERACTION_COLUMNS).eq("organization_id", organizationId).eq("event_id", eventId).order("occurred_at", { ascending: false }).limit(500);
  if (error) throw fromDbError(error);
  return z.array(InteractionRow).parse(data).map(toInteraction);
}

/** Follow-ups created with this event as context. */
export async function listEventFollowUps(db: Db, organizationId: string, eventId: string): Promise<FollowUpView[]> {
  const { data, error } = await db.from("follow_ups").select(FOLLOW_UP_COLUMNS).eq("organization_id", organizationId).eq("event_id", eventId).order("created_at", { ascending: false }).limit(500);
  if (error) throw fromDbError(error);
  return z.array(FollowUpRow).parse(data).map(toFollowUp);
}

/** Who the team knows at these companies: names and roles only (no channels, no notes). */
export interface ContactRef {
  id: string;
  companyId: string;
  name: string;
  role: string;
  isPrimary: boolean;
  /** The event this contact was recorded at, if any. */
  eventId: string | null;
}

export async function listContactRefs(db: Db, organizationId: string, filter: { companyIds: readonly string[] } | { eventId: string }): Promise<ContactRef[]> {
  let q = db.from("contacts").select("id, company_id, name, role, is_primary, event_id").eq("organization_id", organizationId);
  if ("eventId" in filter) q = q.eq("event_id", filter.eventId);
  else {
    const ids = [...new Set(filter.companyIds)].filter((id) => z.uuid().safeParse(id).success).slice(0, 500);
    if (ids.length === 0) return [];
    q = q.in("company_id", ids);
  }
  const { data, error } = await q.order("created_at", { ascending: true }).limit(2000);
  if (error) throw fromDbError(error);
  return z
    .array(z.object({ id: z.uuid(), company_id: z.uuid().nullable(), name: z.string(), role: z.string(), is_primary: z.boolean(), event_id: z.uuid().nullable() }))
    .parse(data)
    .flatMap((r) => (r.company_id ? [{ id: r.id, companyId: r.company_id, name: r.name, role: r.role, isPrimary: r.is_primary, eventId: r.event_id }] : []));
}
