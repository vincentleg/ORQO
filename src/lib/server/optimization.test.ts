/**
 * Phase 17A.2: proofs for the runtime optimizations and the registry consistency invariant.
 * A recording fake database (no network) counts which tables each code path reads.
 */
import { describe, expect, test } from "bun:test";
import { AGENT_REGISTRY, CAPABILITIES } from "@/lib/agents/registry";
import { TOOL_PERMISSIONS } from "@/lib/agents/permissions";
import { TOOLS } from "@/lib/agents/tools";
import { TOOL_IDS } from "@/lib/agents/types";
import { toolNeeds } from "@/lib/governance/authority";
import type { Db } from "@/lib/server/supabase/types";

/** A chainable query builder that resolves to no rows, recording every table read. */
function recordingDb(): { db: Db; tables: string[] } {
  const tables: string[] = [];
  const builder = (): unknown =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") return (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
          return () => builder();
        },
      },
    );
  const db = { from: (t: string) => (tables.push(t), builder()), rpc: () => Promise.resolve({ data: null, error: null }) } as unknown as Db;
  return { db, tables };
}

const ORG = "00000000-0000-4000-8000-0000000000a1";

describe("the own company's understanding is loaded once per request", () => {
  test("loadOwnContext and relevanceTraitsFor reuse a preloaded understanding (no database read)", async () => {
    const { loadOwnContext, relevanceTraitsFor } = await import("@/lib/server/repositories/understanding");
    const { understandCompany } = await import("@/lib/understanding");
    const { SAAS } = await import("@/lib/understanding/fixtures");
    const own = { own: { id: ORG, name: "Ledgerline" } as never, understanding: understandCompany({ companyName: "Ledgerline", website: SAAS.profile.website, intelligence: SAAS, validations: [] }) };
    const { db, tables } = recordingDb();
    const row = { id: ORG, name: "Ledgerline", website: null, summary: "", offerings: [], customer_segments: [], markets: [], geographies: [], sought_capabilities: [], partnership_goals: [] } as never;
    const ctx = await loadOwnContext(db, ORG, row, own);
    expect(ctx.summary).toContain("accounts payable");
    const traits = await relevanceTraitsFor(db, ORG, SAAS, { own, targetTraits: ["offering_form:software"] });
    expect([...traits!.target]).toEqual(["offering_form:software"]);
    expect(tables).toEqual([]);
    // Without a preloaded understanding, the old behaviour (a database read) is unchanged.
    await relevanceTraitsFor(db, ORG, SAAS);
    expect(tables.length).toBeGreaterThan(0);
  });

  test("the canonical company page loads the own understanding once and shares it", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const page = readFileSync(join(import.meta.dir, "../../app/workspace/companies/[companyId]/page.tsx"), "utf8");
    expect(page.match(/getOwnUnderstanding\(/g)?.length).toBe(1);
    expect(page).toContain("getDossier(db, active.organizationId, intel, ownUnderstanding,");
    expect(page).toContain("loadOwnContext(db, active.organizationId, own, ownUnderstanding)");
    expect(page).toMatch(/relevanceTraitsFor\(db, active\.organizationId, intel, \{ own: ownUnderstanding/);
  });
});

describe("the CEO reads workspace memory once per request", () => {
  test("loadBriefing reuses memory the caller already read", async () => {
    const { loadBriefing } = await import("@/lib/server/ceo/briefing");
    const memory = { companies: [], unremembered: [], tracked: [] };
    const { db, tables } = recordingDb();
    await loadBriefing(db, ORG, memory);
    // tracked_opportunities is read only by loadWorkspaceMemory: absent here.
    expect(tables).not.toContain("tracked_opportunities");
    const again = recordingDb();
    await loadBriefing(again.db, ORG);
    expect(again.tables).toContain("tracked_opportunities");
  });
});

describe("registry ↔ tools ↔ permissions ↔ authority stay consistent", () => {
  // Read-only seams declared for planned agents (Relationship, Signal, Event, Graph): registered, not granted yet.
  const PLANNED_SEAMS = ["read_relationship_context", "read_company_signals", "read_event_context", "read_opportunity_graph"];

  test("every tool has a definition, a permission and an implementation, and its network/cost metadata agrees with its authority needs", async () => {
    const { TOOL_IMPLEMENTATIONS } = await import("@/lib/server/agents/tools");
    for (const t of TOOL_IDS) {
      const d = TOOLS[t];
      const n = toolNeeds(t);
      expect({ t, def: Boolean(d), perm: Boolean(TOOL_PERMISSIONS[t]), impl: t in TOOL_IMPLEMENTATIONS }).toEqual({ t, def: true, perm: true, impl: true });
      expect({ t, network: d.externalNetwork }).toEqual({ t, network: n.network !== "none" });
      expect({ t, paid: d.variableCost }).toEqual({ t, paid: Boolean((n as { paid?: boolean }).paid) });
      expect({ t, webDomain: TOOL_PERMISSIONS[t].domains.some((x) => x === "public_web" || x === "web_search") }).toEqual({ t, webDomain: d.externalNetwork });
    }
  });

  test("every tool an agent holds belongs to one of its capabilities; only declared seams are ungranted", () => {
    for (const a of Object.values(AGENT_REGISTRY)) for (const t of a.tools) expect({ agent: a.id, t, inCapability: a.capabilities.some((c) => CAPABILITIES[c].tools.includes(t)) }).toEqual({ agent: a.id, t, inCapability: true });
    const ungranted = TOOL_IDS.filter((t) => !Object.values(AGENT_REGISTRY).some((a) => a.tools.includes(t)));
    expect([...ungranted].sort()).toEqual([...PLANNED_SEAMS].sort() as typeof ungranted);
    for (const a of Object.values(AGENT_REGISTRY)) if (a.status === "available") expect({ agent: a.id, tools: a.tools.length > 0 }).toEqual({ agent: a.id, tools: true });
  });
});
