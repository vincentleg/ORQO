/**
 * Company signals (Phase 7): organization-scoped reads and writes. Every call
 * runs as the signed-in user (RLS is the backstop) and also filters on the
 * organization; a signal can only be attached to a Network company of the
 * same organization (composite foreign key + check here).
 *
 * Signals hold PUBLIC information only. Private relationship memory is read
 * separately (relationshipMemories) for the internal relevance explanation and
 * is never written into a signal. No provider or model is called here.
 */
import { z } from "zod";
import { CLAIM_FIELDS, SOURCE_AUTHORITIES } from "@/lib/intelligence/types";
import { FOLLOW_UP_PRIORITIES, FOLLOW_UP_STATUSES, INTERACTION_KINDS, FOLLOW_UP_ORIGINS, isIsoDay, addDays, isoDay, type FollowUpView, type InteractionView } from "@/lib/network/model";
import {
  EVIDENCE_QUALITIES,
  SIGNAL_KINDS,
  SIGNAL_ORIGINS,
  SIGNAL_STATUSES,
  canTransition,
  dedupKey,
  evidenceQuality,
  type SignalCandidate,
  type SignalStatus,
  type SignalView,
} from "@/lib/signals/model";
import type { RelationshipMemory } from "@/lib/signals/relevance";
import { AppError, fromDbError, parseInput } from "@/lib/server/errors";
import { IsoTimestamp } from "@/lib/server/orqo/schemas";
import type { Db } from "@/lib/server/supabase/types";
import { createFollowUp, FollowUpInput, getNetworkCompany, listNetworkCompanies } from "./network-memory";

const SIGNAL_COLUMNS =
  "id, company_id, kind, origin, headline, detail, excerpt, field, concepts, epistemic, evidence_quality, source_url, source_label, source_authority, published_on, retrieved_at, previous_researched_at, previous_concepts, status, status_changed_at, follow_up_id, first_seen_at, last_seen_at";

const SignalRow = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  kind: z.enum(SIGNAL_KINDS),
  origin: z.enum(SIGNAL_ORIGINS),
  headline: z.string(),
  detail: z.string(),
  excerpt: z.string().nullable(),
  field: z.enum(CLAIM_FIELDS).nullable().catch(null),
  concepts: z.array(z.string()),
  epistemic: z.enum(["fact", "inference"]),
  evidence_quality: z.enum(EVIDENCE_QUALITIES),
  source_url: z.string(),
  source_label: z.string(),
  source_authority: z.enum(SOURCE_AUTHORITIES),
  published_on: z.string().nullable(),
  retrieved_at: IsoTimestamp.nullable(),
  previous_researched_at: IsoTimestamp.nullable(),
  previous_concepts: z.array(z.string()),
  status: z.enum(SIGNAL_STATUSES),
  status_changed_at: IsoTimestamp.nullable(),
  follow_up_id: z.uuid().nullable(),
  first_seen_at: IsoTimestamp,
  last_seen_at: IsoTimestamp,
});

function toSignal(r: z.infer<typeof SignalRow>): SignalView {
  return {
    id: r.id,
    companyId: r.company_id,
    kind: r.kind,
    origin: r.origin,
    headline: r.headline,
    detail: r.detail,
    excerpt: r.excerpt,
    field: r.field,
    concepts: r.concepts,
    epistemic: r.epistemic,
    evidenceQuality: r.evidence_quality,
    sourceUrl: r.source_url,
    sourceLabel: r.source_label,
    sourceAuthority: r.source_authority,
    publishedOn: r.published_on,
    retrievedAt: r.retrieved_at,
    previousResearchedAt: r.previous_researched_at,
    previousConcepts: r.previous_concepts,
    status: r.status,
    statusChangedAt: r.status_changed_at,
    followUpId: r.follow_up_id,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

/** Signals of the organization (optionally of one company), newest first. Bounded. */
export async function listSignals(db: Db, organizationId: string, opts: { companyId?: string; limit?: number } = {}): Promise<SignalView[]> {
  let q = db.from("company_signals").select(SIGNAL_COLUMNS).eq("organization_id", organizationId);
  if (opts.companyId) {
    if (!z.uuid().safeParse(opts.companyId).success) return [];
    q = q.eq("company_id", opts.companyId);
  }
  const { data, error } = await q.order("first_seen_at", { ascending: false }).limit(opts.limit ?? 300);
  if (error) throw fromDbError(error);
  return z.array(SignalRow).parse(data).map(toSignal);
}

async function getSignal(db: Db, organizationId: string, signalId: string): Promise<SignalView> {
  if (!z.uuid().safeParse(signalId).success) throw new AppError("not_found", "Signal not found.");
  const { data, error } = await db.from("company_signals").select(SIGNAL_COLUMNS).eq("organization_id", organizationId).eq("id", signalId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new AppError("not_found", "Signal not found.");
  return toSignal(SignalRow.parse(data));
}

async function requireSignalCompany(db: Db, organizationId: string, companyId: string): Promise<void> {
  const c = await getNetworkCompany(db, organizationId, companyId);
  if (!c || c.isOwnCompany) throw new AppError("not_found", "Company not found.");
}

/**
 * Stores proposed signals for one Network company. Deduplicated by
 * (company, dedup key): an already-known change only refreshes last_seen_at —
 * its status (e.g. dismissed) is kept, so a dismissed change never comes back.
 */
export async function storeSignalCandidates(db: Db, organizationId: string, companyId: string, candidates: readonly (SignalCandidate & { sourceId: string | null })[]): Promise<{ created: number; seenAgain: number }> {
  if (candidates.length === 0) return { created: 0, seenAgain: 0 };
  await requireSignalCompany(db, organizationId, companyId);
  const keys = candidates.map((c) => c.dedupKey);
  const { data: existing, error: exErr } = await db.from("company_signals").select("id, dedup_key").eq("organization_id", organizationId).eq("company_id", companyId).in("dedup_key", keys);
  if (exErr) throw fromDbError(exErr);
  const known = new Map(z.array(z.object({ id: z.uuid(), dedup_key: z.string() })).parse(existing).map((r) => [r.dedup_key, r.id]));
  const fresh = candidates.filter((c) => !known.has(c.dedupKey));
  if (fresh.length) {
    const rows = fresh.map((c) => ({
      organization_id: organizationId,
      company_id: companyId,
      kind: c.kind,
      origin: c.origin,
      headline: c.headline,
      detail: c.detail,
      excerpt: c.excerpt,
      field: c.field,
      concepts: c.concepts,
      epistemic: c.epistemic,
      evidence_quality: c.evidenceQuality,
      source_id: c.sourceId,
      source_url: c.sourceUrl,
      source_label: c.sourceLabel,
      source_authority: c.sourceAuthority,
      published_on: c.publishedOn,
      retrieved_at: c.retrievedAt,
      previous_researched_at: c.previousResearchedAt,
      previous_concepts: c.previousConcepts,
      dedup_key: c.dedupKey,
    }));
    // A concurrent run inserting the same change is absorbed by the unique key.
    const { error } = await db.from("company_signals").upsert(rows, { onConflict: "organization_id,company_id,dedup_key", ignoreDuplicates: true });
    if (error) throw fromDbError(error);
  }
  if (known.size) {
    const { error } = await db.from("company_signals").update({ last_seen_at: new Date().toISOString() }).eq("organization_id", organizationId).in("id", [...known.values()]);
    if (error) throw fromDbError(error);
  }
  return { created: fresh.length, seenAgain: known.size };
}

/** Evidence-store source ids of this organization for the given URLs (Phase 3 saves them as external_ref "web:<url>"). */
export async function sourceIdsByUrl(db: Db, organizationId: string, urls: readonly string[]): Promise<Map<string, string>> {
  const refs = [...new Set(urls)].map((u) => `web:${u}`.slice(0, 2100));
  if (refs.length === 0) return new Map();
  const { data, error } = await db.from("sources").select("id, external_ref").eq("organization_id", organizationId).in("external_ref", refs);
  if (error) throw fromDbError(error);
  return new Map(z.array(z.object({ id: z.uuid(), external_ref: z.string() })).parse(data).map((r) => [r.external_ref.slice(4), r.id]));
}

// ---------------------------------------------------------------------------
// A public change recorded by a person
// ---------------------------------------------------------------------------

export const ManualSignalInput = z.strictObject({
  kind: z.enum(SIGNAL_KINDS),
  headline: z.string().trim().min(3).max(400),
  detail: z.string().trim().max(1000).default(""),
  sourceUrl: z.url({ protocol: /^https?$/ }).max(2000),
  sourceAuthority: z.enum(["official", "third_party"]),
  // A day the source states, never in the future (one day of slack for time zones). Empty = unknown.
  publishedOn: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().refine(isIsoDay, "Expected a calendar day.").nullable())
    .refine((v) => v === null || v <= addDays(isoDay(new Date()), 1), "A publication date cannot be in the future."),
});

/**
 * A public change a person read and records with its source URL. The URL is
 * stored and shown as a link; ORQO never fetches it. Recorded as "reported by
 * your team" (moderate evidence), deduplicated by kind + normalized URL.
 */
export async function recordManualSignal(db: Db, organizationId: string, companyId: string, input: z.input<typeof ManualSignalInput>): Promise<{ created: boolean }> {
  const s = parseInput(ManualSignalInput, input);
  let host = "";
  try {
    host = new URL(s.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    throw new AppError("invalid_input", "Invalid source URL.");
  }
  const r = await storeSignalCandidates(db, organizationId, companyId, [
    {
      kind: s.kind,
      origin: "manual",
      headline: s.headline,
      detail: s.detail,
      excerpt: null,
      field: null,
      concepts: [],
      epistemic: "fact",
      evidenceQuality: evidenceQuality({ epistemic: "fact", authority: s.sourceAuthority, origin: "manual", hasExcerpt: false }),
      sourceUrl: s.sourceUrl,
      sourceLabel: host,
      sourceAuthority: s.sourceAuthority,
      publishedOn: s.publishedOn,
      retrievedAt: null,
      previousResearchedAt: null,
      previousConcepts: [],
      dedupKey: dedupKey(s.kind, { url: s.sourceUrl }),
      sourceId: null,
    },
  ]);
  return { created: r.created > 0 };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Reviewed / dismissed / reopened by a person. acted_on is reached only through createFollowUpFromSignal. */
export async function setSignalStatus(db: Db, organizationId: string, signalId: string, status: unknown): Promise<{ companyId: string }> {
  const to = parseInput(z.enum(["new", "reviewed", "dismissed"]), status) as SignalStatus;
  const current = await getSignal(db, organizationId, signalId);
  if (current.status === to) return { companyId: current.companyId };
  if (!canTransition(current.status, to)) throw new AppError("conflict", "This change is not allowed.");
  const { data, error } = await db.from("company_signals").update({ status: to }).eq("organization_id", organizationId).eq("id", signalId).eq("status", current.status).select("id");
  if (error) throw fromDbError(error);
  if (!data || data.length === 0) throw new AppError("conflict", "The signal changed meanwhile.");
  return { companyId: current.companyId };
}

/**
 * A person explicitly turns a signal into a follow-up on its company, through
 * the Network follow-up rules (same validation, membership-checked assignee).
 * The follow-up records the public source; nobody is contacted.
 */
export async function createFollowUpFromSignal(db: Db, organizationId: string, signalId: string, input: z.input<typeof FollowUpInput>): Promise<{ companyId: string; followUpId: string }> {
  const signal = await getSignal(db, organizationId, signalId);
  if (!canTransition(signal.status, "acted_on")) throw new AppError("conflict", "This signal is closed.");
  const followUpId = await createFollowUp(db, organizationId, signal.companyId, input, { fromSignal: true });
  const { error } = await db.from("company_signals").update({ status: "acted_on", follow_up_id: followUpId }).eq("organization_id", organizationId).eq("id", signal.id);
  if (error) throw fromDbError(error);
  return { companyId: signal.companyId, followUpId };
}

// ---------------------------------------------------------------------------
// Private relationship memory used for the internal relevance explanation
// ---------------------------------------------------------------------------

const MemoryInteraction = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  contact_id: z.uuid().nullable(),
  kind: z.enum(INTERACTION_KINDS),
  occurred_at: IsoTimestamp,
  title: z.string(),
  summary: z.string(),
  outcome: z.string(),
  next_step: z.string(),
  created_at: IsoTimestamp,
});
const MemoryFollowUp = z.object({
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
  created_at: IsoTimestamp,
});

/**
 * Stage, "why it matters", recent interactions and open follow-ups of the
 * given companies (this organization only). Read for the internal explanation;
 * never written anywhere else.
 */
export async function relationshipMemories(db: Db, organizationId: string, companyIds: readonly string[]): Promise<Map<string, RelationshipMemory>> {
  const ids = [...new Set(companyIds)].filter((id) => z.uuid().safeParse(id).success).slice(0, 200);
  const out = new Map<string, RelationshipMemory>();
  if (ids.length === 0) return out;
  const [companies, interactions, followUps] = await Promise.all([
    listNetworkCompanies(db, organizationId),
    db.from("interactions").select("id, company_id, contact_id, kind, occurred_at, title, summary, outcome, next_step, created_at").eq("organization_id", organizationId).in("company_id", ids).order("occurred_at", { ascending: false }).limit(1000),
    db.from("follow_ups").select("id, company_id, contact_id, interaction_id, title, description, due_on, status, priority, origin, assigned_to, closed_at, created_at").eq("organization_id", organizationId).in("company_id", ids).eq("status", "open").limit(1000),
  ]);
  for (const r of [interactions, followUps]) if (r.error) throw fromDbError(r.error);
  for (const c of companies) if (ids.includes(c.id) && !c.isOwnCompany) out.set(c.id, { stage: c.stage, reason: c.reason, interactions: [], followUps: [] });
  for (const i of z.array(MemoryInteraction).parse(interactions.data)) {
    const m = out.get(i.company_id);
    if (m && m.interactions.length < 50)
      (m.interactions as InteractionView[]).push({ id: i.id, companyId: i.company_id, contactId: i.contact_id, kind: i.kind, occurredAt: i.occurred_at, title: i.title, summary: i.summary, outcome: i.outcome, nextStep: i.next_step, createdAt: i.created_at });
  }
  for (const f of z.array(MemoryFollowUp).parse(followUps.data)) {
    const m = out.get(f.company_id);
    if (m)
      (m.followUps as FollowUpView[]).push({
        id: f.id,
        companyId: f.company_id,
        contactId: f.contact_id,
        interactionId: f.interaction_id,
        title: f.title,
        description: f.description,
        dueOn: f.due_on,
        status: f.status,
        priority: f.priority,
        origin: f.origin,
        assignedTo: f.assigned_to,
        closedAt: f.closed_at,
        createdAt: f.created_at,
      });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agent seam: public signals of one company (read-only)
// ---------------------------------------------------------------------------

export interface CompanySignalsContext {
  /** Public business changes with provenance; no private relationship memory. */
  provenance: "public_signals";
  companyId: string;
  signals: { kind: SignalView["kind"]; headline: string; epistemic: SignalView["epistemic"]; evidenceQuality: SignalView["evidenceQuality"]; sourceUrl: string; sourceAuthority: SignalView["sourceAuthority"]; publishedOn: string | null; firstSeenAt: string; status: SignalView["status"] }[];
}

export async function readCompanySignals(db: Db, organizationId: string, companyId: string): Promise<CompanySignalsContext | null> {
  const company = await getNetworkCompany(db, organizationId, companyId);
  if (!company || company.isOwnCompany) return null;
  const signals = await listSignals(db, organizationId, { companyId, limit: 20 });
  return {
    provenance: "public_signals",
    companyId,
    signals: signals.map((s) => ({ kind: s.kind, headline: s.headline, epistemic: s.epistemic, evidenceQuality: s.evidenceQuality, sourceUrl: s.sourceUrl, sourceAuthority: s.sourceAuthority, publishedOn: s.publishedOn, firstSeenAt: s.firstSeenAt, status: s.status })),
  };
}
