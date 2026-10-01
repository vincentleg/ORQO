/**
 * Loads the canonical PostgreSQL records the Opportunity Graph projects
 * (Phase 10). Reads only: runs as the signed-in user (RLS) AND filters every
 * query by the organization, so a forged organization id returns nothing.
 *
 * Column lists are the privacy boundary. Nothing below selects contact
 * channels, contact notes, interaction titles/bodies, follow-up text, event
 * "why"/preparation notes, Network reasons or evidence excerpts: the graph
 * holds structure and canonical references, not CRM content.
 */
import { z } from "zod";
import type { CanonicalSnapshot } from "@/lib/graph/opportunity/projection";
import { OFFER_FIELDS, SEEK_FIELDS } from "@/lib/graph/opportunity/projection";
import { websiteDomain } from "@/lib/search/query";
import { fromDbError } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";

/** Row bounds per table. Hitting one marks the projection as truncated (shown to the user). */
export const CANONICAL_LIMITS = {
  companies: 500,
  capabilities: 2000,
  needs: 2000,
  intelligence: 500,
  evidence: 4000,
  opportunities: 300,
  signals: 1000,
  events: 200,
  eventTargets: 2000,
  interactions: 5000,
  followUps: 5000,
} as const;

type Result = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function rows<T extends z.ZodType>(schema: T, query: Result): Promise<z.infer<T>[]> {
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return z.array(schema).parse(data ?? []);
}

const Mark = z.object({ sourceId: z.string(), epistemic: z.enum(["fact", "inference", "assumption"]) });
const Marks = z.array(z.unknown()).transform((xs) => xs.flatMap((x) => (Mark.safeParse(x).success ? [Mark.parse(x)] : [])));

export async function loadCanonicalSnapshot(db: Db, organizationId: string): Promise<CanonicalSnapshot> {
  const L = CANONICAL_LIMITS;
  const org = organizationId;
  const [companies, capabilities, needs, intelligence, evidence, opportunities, signals, events, targets, interactions, followUps] = await Promise.all([
    rows(
      z.object({ id: z.uuid(), name: z.string(), website: z.string().nullable(), is_own_company: z.boolean(), network_stage: z.string().nullable(), offerings: z.array(z.string()).nullable(), sought_capabilities: z.array(z.string()).nullable() }),
      db.from("companies").select("id, name, website, is_own_company, network_stage, offerings, sought_capabilities").eq("organization_id", org).order("created_at").limit(L.companies),
    ),
    rows(
      z.object({ id: z.uuid(), company_id: z.uuid(), label: z.string(), tags: z.array(z.string()), visibility: z.string(), evidence: Marks }),
      db.from("company_capabilities").select("id, company_id, label, tags, visibility, evidence").eq("organization_id", org).order("created_at").limit(L.capabilities),
    ),
    rows(
      z.object({ id: z.uuid(), company_id: z.uuid(), label: z.string(), tags: z.array(z.string()), intensity: z.string(), visibility: z.string(), evidence: Marks }),
      db.from("company_needs").select("id, company_id, label, tags, intensity, visibility, evidence").eq("organization_id", org).order("created_at").limit(L.needs),
    ),
    rows(z.object({ id: z.uuid(), domain: z.string(), researched_at: z.string() }), db.from("company_intelligence").select("id, domain, researched_at").eq("organization_id", org).order("researched_at").limit(L.intelligence)),
    rows(
      z.object({ id: z.uuid(), intelligence_id: z.uuid(), source_id: z.uuid().nullable(), field: z.string(), epistemic: z.enum(["fact", "inference", "assumption", "unknown"]), concepts: z.array(z.string()), self_described: z.boolean() }),
      db
        .from("evidence_items")
        .select("id, intelligence_id, source_id, field, epistemic, concepts, self_described")
        .eq("organization_id", org)
        .in("field", [...OFFER_FIELDS, ...SEEK_FIELDS])
        .neq("epistemic", "unknown")
        .order("created_at")
        .limit(L.evidence),
    ),
    rows(
      z.object({
        id: z.uuid(),
        title: z.string(),
        stage: z.string(),
        kind: z.string(),
        confidence: z.object({ level: z.string() }).loose().nullable(),
        missing_capabilities: z.array(z.string()),
        opportunity_participants: z.array(z.object({ company_id: z.uuid(), role: z.string() })),
      }),
      db.from("opportunities").select("id, title, stage, kind, confidence, missing_capabilities, opportunity_participants(company_id, role)").eq("organization_id", org).order("discovered_at").limit(L.opportunities),
    ),
    rows(
      z.object({
        id: z.uuid(),
        company_id: z.uuid(),
        kind: z.string(),
        headline: z.string(),
        status: z.string(),
        epistemic: z.enum(["fact", "inference"]),
        evidence_quality: z.string(),
        source_authority: z.string(),
        source_id: z.uuid().nullable(),
        published_on: z.string().nullable(),
      }),
      db
        .from("company_signals")
        .select("id, company_id, kind, headline, status, epistemic, evidence_quality, source_authority, source_id, published_on")
        .eq("organization_id", org)
        .neq("status", "dismissed")
        .order("first_seen_at", { ascending: false })
        .limit(L.signals),
    ),
    rows(
      z.object({ id: z.uuid(), name: z.string(), starts_on: z.string().nullable(), ends_on: z.string().nullable(), archived_at: z.string().nullable() }),
      db.from("events").select("id, name, starts_on, ends_on, archived_at").eq("organization_id", org).order("created_at").limit(L.events),
    ),
    rows(
      z.object({ id: z.uuid(), event_id: z.uuid(), company_id: z.uuid(), status: z.string(), priority: z.string(), attendance: z.string() }),
      db.from("event_companies").select("id, event_id, company_id, status, priority, attendance").eq("organization_id", org).order("created_at").limit(L.eventTargets),
    ),
    // Dates only: the latest interaction day per company.
    rows(z.object({ company_id: z.uuid(), occurred_at: z.string() }), db.from("interactions").select("company_id, occurred_at").eq("organization_id", org).order("occurred_at", { ascending: false }).limit(L.interactions)),
    // Counts only: open follow-ups per company.
    rows(z.object({ company_id: z.uuid() }), db.from("follow_ups").select("company_id").eq("organization_id", org).eq("status", "open").limit(L.followUps)),
  ]);

  const activity = new Map<string, { companyId: string; lastInteractionOn: string | null; openFollowUps: number }>();
  const touch = (id: string) => activity.get(id) ?? activity.set(id, { companyId: id, lastInteractionOn: null, openFollowUps: 0 }).get(id)!;
  for (const i of interactions) {
    const a = touch(i.company_id);
    const day = new Date(i.occurred_at).toISOString().slice(0, 10);
    if (!a.lastInteractionOn || day > a.lastInteractionOn) a.lastInteractionOn = day;
  }
  for (const f of followUps) touch(f.company_id).openFollowUps += 1;

  const truncated =
    companies.length >= L.companies ||
    capabilities.length >= L.capabilities ||
    needs.length >= L.needs ||
    intelligence.length >= L.intelligence ||
    evidence.length >= L.evidence ||
    opportunities.length >= L.opportunities ||
    signals.length >= L.signals ||
    events.length >= L.events ||
    targets.length >= L.eventTargets ||
    interactions.length >= L.interactions ||
    followUps.length >= L.followUps;

  return {
    organizationId: org,
    truncated,
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.website ? websiteDomain(c.website) : null,
      isOwnCompany: c.is_own_company,
      networkStage: c.network_stage,
      offerings: c.is_own_company ? (c.offerings ?? []) : [],
      soughtCapabilities: c.is_own_company ? (c.sought_capabilities ?? []) : [],
    })),
    capabilities: capabilities.map((c) => ({ id: c.id, companyId: c.company_id, label: c.label, tags: c.tags, visibility: c.visibility, evidence: c.evidence })),
    needs: needs.map((n) => ({ id: n.id, companyId: n.company_id, label: n.label, tags: n.tags, intensity: n.intensity, visibility: n.visibility, evidence: n.evidence })),
    intelligence: intelligence.map((i) => ({ id: i.id, domain: i.domain, researchedAt: i.researched_at })),
    evidenceItems: evidence.map((e) => ({ id: e.id, intelligenceId: e.intelligence_id, sourceId: e.source_id, field: e.field, epistemic: e.epistemic, concepts: e.concepts, selfDescribed: e.self_described })),
    opportunities: opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      stage: o.stage,
      kind: o.kind,
      confidence: o.confidence?.level ?? null,
      missingCapabilities: o.missing_capabilities,
      participants: o.opportunity_participants.map((p) => ({ companyId: p.company_id, role: p.role })),
    })),
    signals: signals.map((s) => ({
      id: s.id,
      companyId: s.company_id,
      kind: s.kind,
      headline: s.headline,
      status: s.status,
      epistemic: s.epistemic,
      evidenceQuality: s.evidence_quality,
      sourceAuthority: s.source_authority,
      sourceId: s.source_id,
      publishedOn: s.published_on,
    })),
    events: events.map((e) => ({ id: e.id, name: e.name, startsOn: e.starts_on, endsOn: e.ends_on, archived: e.archived_at !== null })),
    eventTargets: targets.map((t) => ({ id: t.id, eventId: t.event_id, companyId: t.company_id, status: t.status, priority: t.priority, attendance: t.attendance })),
    activity: [...activity.values()].sort((a, b) => a.companyId.localeCompare(b.companyId)),
  };
}
