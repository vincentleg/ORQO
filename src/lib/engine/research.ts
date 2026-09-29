/**
 * Research module. In demo mode, company understanding is read from the local
 * graph (seeded, simulated sources). A live provider (see lib/server/research)
 * produces the same Company shape from public web research.
 */
import type { Company, World } from "@/lib/domain/types";

export interface CompanyUnderstanding {
  companyId: string;
  summary: string;
  highlights: string[];
  sourceIds: string[];
}

export interface ResearchProvider {
  readonly id: string;
  research(query: { name: string; website?: string }): Promise<Company>;
}

export function understandCompany(world: World, companyId: string): CompanyUnderstanding {
  const c = world.companies[companyId];
  const sourceIds = [
    ...new Set([...c.offers, ...c.needs, ...c.objectives, ...c.constraints].flatMap((x) => x.evidence.map((e) => e.sourceId))),
  ];
  return {
    companyId,
    summary: `${c.offers.length} capabilities · ${c.needs.length} needs · ${c.objectives.length} objectives · ${sourceIds.length} sources`,
    highlights: [c.summary, ...c.offers.slice(0, 3).map((o) => `Offers: ${o.label}`)],
    sourceIds,
  };
}
