import { describe, expect, test } from "bun:test";
import { DEMO_NOW } from "@/lib/data/seed";
import { commitEvaluation, evaluateRelationship } from "@/lib/engine/pipeline";
import { NewCapabilityInput, NewCompanyInput, NewNeedInput, NewSourceInput } from "@/lib/server/repositories/companies";
import { NewContactInput, NewRelationshipInput } from "@/lib/server/repositories/network";
import { buildEvaluationWorld, opportunityRowFor, participantRowsFor, type RelationshipSnapshot } from "@/lib/server/orqo/world";
import { OpportunityRow } from "@/lib/server/orqo/schemas";
import { importDemoRelationship, type FixtureSink } from "../support/demo-fixture";
import { comparable, referenceEvaluation } from "../support/reference";

const ORG = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-09-29T16:00:00.000Z";

/** Builds the rows the database would return, using the repositories' own input schemas. */
function memorySink(): { sink: FixtureSink; snapshot: () => Omit<RelationshipSnapshot, "relationship"> & { relationship?: RelationshipSnapshot["relationship"] } } {
  const s: Omit<RelationshipSnapshot, "relationship"> & { relationship?: RelationshipSnapshot["relationship"] } = {
    contacts: [],
    companies: [],
    capabilities: [],
    needs: [],
    sources: [],
    opportunities: [],
    runs: [],
  };
  const id = () => crypto.randomUUID();
  const sink: FixtureSink = {
    async createSource(raw) {
      const x = NewSourceInput.parse(raw);
      const row = { id: id(), kind: x.kind, label: x.label, url: x.url ?? null, retrieved_at: x.retrievedAt, simulated: x.simulated };
      s.sources.push(row);
      return row.id;
    },
    async createCompany(raw) {
      const x = NewCompanyInput.parse(raw);
      const row = { id: id(), organization_id: ORG, name: x.name, website: x.website ?? null, tagline: x.tagline, summary: x.summary, headquarters: x.headquarters, size: x.size, markets: x.markets, geographies: x.geographies, objectives: x.objectives, constraints: x.constraints, is_own_company: x.isOwnCompany, created_at: NOW };
      s.companies.push(row);
      return row.id;
    },
    async createCapability(raw) {
      const x = NewCapabilityInput.parse(raw);
      const row = { id: id(), company_id: x.companyId, label: x.label, detail: x.detail, tags: x.tags, evidence: x.evidence, visibility: x.visibility, observed_at: x.observedAt ?? NOW };
      s.capabilities.push(row);
      return row.id;
    },
    async createNeed(raw) {
      const x = NewNeedInput.parse(raw);
      const row = { id: id(), company_id: x.companyId, label: x.label, detail: x.detail, tags: x.tags, intensity: x.intensity, evidence: x.evidence, visibility: x.visibility, disclosure: x.disclosure ?? null, observed_at: x.observedAt ?? NOW };
      s.needs.push(row);
      return row.id;
    },
    async createContact(raw) {
      const x = NewContactInput.parse(raw);
      const row = { id: id(), company_id: x.companyId ?? null, name: x.name, role: x.role, location: x.location, bio: x.bio };
      s.contacts.push(row);
      return row.id;
    },
    async createRelationship(raw) {
      const x = NewRelationshipInput.parse(raw);
      s.relationship = {
        id: id(),
        organization_id: ORG,
        contact_a_id: x.contactAId,
        contact_b_id: x.contactBId,
        encounter_event: x.encounter.event,
        encounter_location: x.encounter.location,
        encountered_at: x.encounter.at ?? null,
        encounter_note: x.encounter.note,
        status: "unevaluated",
        agents_connected_at: null,
        visibility: x.visibility,
      };
      return s.relationship.id;
    },
  };
  return { sink, snapshot: () => s };
}

async function importedSnapshot(): Promise<RelationshipSnapshot> {
  const { sink, snapshot } = memorySink();
  await importDemoRelationship(sink, "r-maya-lukas");
  const s = snapshot();
  if (!s.relationship) throw new Error("relationship not imported");
  return { ...s, relationship: s.relationship };
}

describe("rows → engine world", () => {
  test("production pipeline reproduces the engine's European Edge AI Appliance Partnership exactly", async () => {
    const snapshot = await importedSnapshot();
    const world = buildEvaluationWorld(snapshot, DEMO_NOW);
    const result = evaluateRelationship(world, snapshot.relationship.id);
    const ref = referenceEvaluation("r-maya-lukas");

    expect(result.passing.map((p) => comparable(world, p.draft, p.critique))).toEqual(ref.result.passing.map((p) => comparable(ref.world, p.draft, p.critique)));
    expect(result.tests).toEqual(ref.result.tests);
    expect(result.passing[0].draft.title).toBe("European Edge AI Appliance Partnership");
  });

  test("engine output survives the row round trip and keeps contribution order", async () => {
    const snapshot = await importedSnapshot();
    const world = buildEvaluationWorld(snapshot, DEMO_NOW);
    const commit = commitEvaluation(world, evaluateRelationship(world, snapshot.relationship.id), { kind: "connection" });
    const opp = commit.world.opportunities[commit.created[0]];
    const uuid = crypto.randomUUID();
    const participants = participantRowsFor(ORG, uuid, opp).map(({ company_id, role, contributions, position }) => ({ company_id, role, contributions, position }));
    const row = OpportunityRow.parse({ ...opportunityRowFor(ORG, opp), id: uuid, opportunity_participants: [...participants].reverse() });

    const reloaded = buildEvaluationWorld({ ...snapshot, opportunities: [row] }, DEMO_NOW).opportunities[opp.id];
    expect(reloaded).toEqual({ ...opp, delta: undefined });
  });

  test("contacts must belong to two different companies", async () => {
    const snapshot = await importedSnapshot();
    const [a] = snapshot.contacts;
    const broken = { ...snapshot, contacts: snapshot.contacts.map((c) => ({ ...c, company_id: a.company_id })) };
    expect(() => buildEvaluationWorld(broken, NOW)).toThrow("different companies");
  });
});
