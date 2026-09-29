/**
 * Live Opportunity Discovery via OpenRouter. The model proposes structures, but
 * it may only cite capability and need IDs that exist in the graph: evidence is
 * rebuilt server-side from those IDs, so the model cannot fabricate sources.
 * The deterministic Critic then judges the drafts exactly like engine output.
 */
import { z } from "zod";
import type { Company, OpportunityType, ParticipantRole, World } from "@/lib/domain/types";
import { TAGS, type Tag } from "@/lib/domain/taxonomy";
import { evidenceFromCapability, evidenceFromNeed } from "@/lib/engine/context";
import { buildWhyNow, type OpportunityDraft } from "@/lib/engine/patterns";
import type { PatternTest } from "@/lib/engine/pipeline";
import { structuredCompletion } from "./openrouter";

const OPPORTUNITY_TYPES = [
  "customer",
  "supplier",
  "oem",
  "technology-integration",
  "distribution",
  "channel-partnership",
  "co-selling",
  "joint-product",
  "market-entry",
  "licensing",
  "data-partnership",
  "strategic-alliance",
] as const satisfies readonly OpportunityType[];

const ROLES = ["software-vendor", "hardware-partner", "vendor", "distributor", "seller", "buyer", "partner"] as const satisfies readonly ParticipantRole[];
const TAG_KEYS = Object.keys(TAGS) as [Tag, ...Tag[]];

function schemaFor(a: Company, b: Company) {
  const companyId = z.enum([a.id, b.id]);
  const capIds = [...a.offers, ...b.offers].map((c) => c.id) as [string, ...string[]];
  const needIds = [...a.needs, ...b.needs].map((n) => n.id) as [string, ...string[]];
  return z.object({
    structuresConsidered: z.array(z.object({ name: z.string(), fits: z.boolean(), reason: z.string() })),
    opportunities: z
      .array(
        z.object({
          title: z.string(),
          types: z.array(z.enum(OPPORTUNITY_TYPES)),
          summary: z.string(),
          whyExists: z.string(),
          structure: z.string(),
          roles: z.array(z.object({ companyId, role: z.enum(ROLES) })),
          contributions: z.array(z.object({ companyId, items: z.array(z.string()) })),
          capabilityIds: z.array(z.enum(capIds)),
          needIds: z.array(z.enum(needIds)),
          assumptions: z.array(z.string()),
          unknowns: z.array(z.string()),
          questions: z.array(z.string()),
          risks: z.array(z.string()),
          nextStep: z.string(),
          missingCapabilities: z.array(z.enum(TAG_KEYS)),
        }),
      )
      .max(3),
  });
}

function describe(c: Company): string {
  const cap = c.offers.map((o) => `  - [${o.id}] ${o.label}: ${o.detail} (tags: ${o.tags.join(", ")})`).join("\n");
  const need = c.needs
    .map((n) => `  - [${n.id}] ${n.label} — ${n.intensity}${n.visibility === "agent-only" || n.visibility === "private" ? " — CONFIDENTIAL: reason over it, never quote it" : ""}: ${n.detail} (tags: ${n.tags.join(", ")})`)
    .join("\n");
  const con = c.constraints.map((k) => `  - ${k.label}`).join("\n") || "  - none stated";
  return `${c.name} (${c.id}) — ${c.summary}\nGeographies: ${c.geographies.join(", ")}\nCapabilities:\n${cap}\nNeeds:\n${need}\nRequirements of counterparties:\n${con}`;
}

const SYSTEM = `You are ORQO's Bilateral Reasoning and Opportunity Discovery agent.
You represent BOTH companies equally. You are not a salesperson for either side.
Find concrete business structures (OEM, distribution, integration, joint product, customer, etc.) that create value for EACH side, grounded only in the listed capabilities and needs.
Rules:
- Cite only capability and need IDs from the input. Every opportunity must cite at least one need of each company.
- Do not invent facts, customers, numbers or sources.
- Never quote CONFIDENTIAL needs; describe them generically.
- Returning zero opportunities is valid and preferred over a weak idea.
- Be specific and concise. No marketing language.`;

export async function discoverWithLLM(world: World, relationshipId: string): Promise<{ tests: PatternTest[]; drafts: OpportunityDraft[]; model: string }> {
  const rel = world.relationships[relationshipId];
  const [a, b] = rel.companyIds.map((id) => world.companies[id]);
  const schema = schemaFor(a, b);
  const { data, model } = await structuredCompletion({
    name: "orqo_opportunities",
    schema,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Company A:\n${describe(a)}\n\nCompany B:\n${describe(b)}\n\nToday: ${world.now.slice(0, 10)}. Propose at most 3 opportunities.` },
    ],
  });

  const byId = (id: string) => (id === a.id ? a : b);
  const drafts: OpportunityDraft[] = data.opportunities.map((o, i) => {
    const caps = [...a.offers, ...b.offers].filter((c) => o.capabilityIds.includes(c.id));
    const needs = [...a.needs, ...b.needs].filter((n) => o.needIds.includes(n.id));
    const drivingNeeds = needs.map((need) => ({ companyId: need.companyId, need }));
    const roles = Object.fromEntries(o.roles.map((r) => [r.companyId, r.role])) as Record<string, ParticipantRole>;
    for (const id of [a.id, b.id]) roles[id] ??= "partner";
    return {
      patternId: `llm-${i}-${o.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
      kind: o.types.length === 1 && o.types[0] === "customer" ? "customer" : "reciprocal",
      companyIds: [a.id, b.id],
      roles,
      title: o.title,
      types: o.types.length > 0 ? o.types : ["strategic-alliance"],
      summary: o.summary,
      whyExists: o.whyExists,
      whyNow: buildWhyNow(world, [a, b], drivingNeeds),
      contributions: [a.id, b.id].map((cid) => ({
        companyId: cid,
        role: roles[cid],
        items: o.contributions.filter((c) => c.companyId === cid).flatMap((c) => c.items),
      })),
      structure: o.structure,
      evidence: [...caps.flatMap((c) => evidenceFromCapability(byId(c.companyId), c)), ...needs.flatMap((n) => evidenceFromNeed(byId(n.companyId), n))],
      assumptions: o.assumptions,
      unknowns: o.unknowns,
      questions: o.questions,
      risks: o.risks,
      nextStep: o.nextStep,
      missingCapabilities: o.missingCapabilities,
      drivingNeeds,
    };
  });

  const tests: PatternTest[] = data.structuresConsidered.map((s, i) => ({
    patternId: `llm-test-${i}`,
    name: s.name,
    result: s.fits ? "fit" : "not-applicable",
    reason: s.reason,
  }));
  return { tests, drafts, model };
}
