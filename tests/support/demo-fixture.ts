/**
 * Imports one relationship of the hackathon demo network (companies, their
 * capabilities/needs, sources, both people, the relationship) through a
 * "sink" that accepts the same inputs as the production repositories.
 * TEST-ONLY: demo fixtures are never inserted into real user workspaces.
 */
import type { z } from "zod";
import { seedCompanies, seedPeople, seedRelationships, seedSources } from "@/lib/data/seed";
import type { EvidenceRef } from "@/lib/domain/types";
import type { NewCapabilityInput, NewCompanyInput, NewNeedInput, NewSourceInput } from "@/lib/server/repositories/companies";
import type { NewContactInput, NewRelationshipInput } from "@/lib/server/repositories/network";

export interface FixtureSink {
  createSource(input: z.input<typeof NewSourceInput>): Promise<string>;
  createCompany(input: z.input<typeof NewCompanyInput>): Promise<string>;
  createCapability(input: z.input<typeof NewCapabilityInput>): Promise<string>;
  createNeed(input: z.input<typeof NewNeedInput>): Promise<string>;
  createContact(input: z.input<typeof NewContactInput>): Promise<string>;
  createRelationship(input: z.input<typeof NewRelationshipInput>): Promise<string>;
}

export interface ImportedFixture {
  relationshipId: string;
  /** seed id → persisted id, for every imported entity */
  ids: Map<string, string>;
}

export async function importDemoRelationship(sink: FixtureSink, seedRelationshipId: string): Promise<ImportedFixture> {
  const rel = seedRelationships.find((r) => r.id === seedRelationshipId);
  if (!rel) throw new Error(`Unknown demo relationship ${seedRelationshipId}`);
  const companies = rel.companyIds.map((id) => {
    const c = seedCompanies.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown demo company ${id}`);
    return c;
  });
  const ids = new Map<string, string>();

  const evidence = companies.flatMap((c) => [...c.offers, ...c.needs, ...c.objectives, ...c.constraints].flatMap((x) => x.evidence));
  for (const sourceId of new Set(evidence.map((e) => e.sourceId))) {
    const s = seedSources.find((x) => x.id === sourceId);
    if (!s) throw new Error(`Unknown demo source ${sourceId}`);
    ids.set(s.id, await sink.createSource({ kind: s.kind, label: s.label, url: s.url, retrievedAt: s.retrievedAt, simulated: s.simulated, externalRef: s.id }));
  }
  const remap = (refs: EvidenceRef[]): EvidenceRef[] => refs.map((e) => ({ ...e, sourceId: ids.get(e.sourceId) ?? e.sourceId }));

  for (const c of companies) {
    const companyId = await sink.createCompany({
      name: c.name,
      tagline: c.tagline,
      summary: c.summary,
      headquarters: c.headquarters,
      size: c.size,
      markets: c.markets,
      geographies: c.geographies,
      objectives: c.objectives.map((o) => ({ ...o, evidence: remap(o.evidence) })),
      constraints: c.constraints.map((k) => ({ ...k, evidence: remap(k.evidence) })),
      externalRef: c.id,
    });
    ids.set(c.id, companyId);
    for (const cap of c.offers) {
      ids.set(
        cap.id,
        await sink.createCapability({ companyId, label: cap.label, detail: cap.detail, tags: cap.tags, evidence: remap(cap.evidence), visibility: cap.visibility, observedAt: cap.observedAt, externalRef: cap.id }),
      );
    }
    for (const n of c.needs) {
      ids.set(
        n.id,
        await sink.createNeed({
          companyId,
          label: n.label,
          detail: n.detail,
          tags: n.tags,
          intensity: n.intensity,
          evidence: remap(n.evidence),
          visibility: n.visibility,
          disclosure: n.disclosure,
          observedAt: n.observedAt,
          externalRef: n.id,
        }),
      );
    }
  }

  for (const personId of rel.personIds) {
    const p = seedPeople.find((x) => x.id === personId);
    if (!p) throw new Error(`Unknown demo person ${personId}`);
    ids.set(p.id, await sink.createContact({ companyId: ids.get(p.companyId), name: p.name, role: p.role, location: p.location, bio: p.bio, externalRef: p.id }));
  }

  const [a, b] = rel.personIds.map((id) => ids.get(id) ?? "");
  const relationshipId = await sink.createRelationship({
    contactAId: a,
    contactBId: b,
    encounter: { event: rel.encounter.event, location: rel.encounter.location, at: rel.encounter.date, note: rel.encounter.note },
    visibility: rel.visibility,
    externalRef: rel.id,
  });
  ids.set(rel.id, relationshipId);
  return { relationshipId, ids };
}
