import type {
  Capability,
  Company,
  EvidenceRef,
  Need,
  OpportunityEvidence,
  Signal,
  World,
} from "@/lib/domain/types";
import type { Tag } from "@/lib/domain/taxonomy";

export const ORQO_INFERENCE_SOURCE = "s-orqo-inference";
const DAY_MS = 86_400_000;

export interface NeedMatch {
  need: Need;
  needCompanyId: string;
  capability: Capability;
  capabilityCompanyId: string;
  tags: Tag[];
}

export function offeredTags(company: Company): Set<Tag> {
  return new Set(company.offers.flatMap((c) => c.tags));
}

export function offersAny(company: Company, tags: readonly Tag[]): boolean {
  const offered = offeredTags(company);
  return tags.some((t) => offered.has(t));
}

export function capabilitiesWith(company: Company, tags: readonly Tag[]): Capability[] {
  return company.offers.filter((c) => c.tags.some((t) => tags.includes(t)));
}

export function needsWith(company: Company, tags: readonly Tag[]): Need[] {
  return company.needs.filter((n) => n.tags.some((t) => tags.includes(t)));
}

/** Needs of `needer` that `provider` can satisfy, grounded in concrete capabilities. */
export function matchNeeds(needer: Company, provider: Company): NeedMatch[] {
  const matches: NeedMatch[] = [];
  for (const need of needer.needs) {
    for (const capability of provider.offers) {
      const tags = need.tags.filter((t) => capability.tags.includes(t));
      if (tags.length > 0) {
        matches.push({ need, needCompanyId: needer.id, capability, capabilityCompanyId: provider.id, tags });
      }
    }
  }
  return matches;
}

export function recentSignals(world: World, companyIds: readonly string[], days = 120): Signal[] {
  const now = Date.parse(world.now);
  return Object.values(world.signals)
    .filter((s) => companyIds.includes(s.companyId))
    .filter((s) => {
      const age = now - Date.parse(s.occurredAt);
      return age >= 0 && age <= days * DAY_MS;
    })
    .sort((x, y) => Date.parse(y.occurredAt) - Date.parse(x.occurredAt));
}

const INTENSITY_RANK = { critical: 2, active: 1, exploring: 0 } as const;

export function strongestNeed(needs: readonly Need[]): Need | undefined {
  return [...needs].sort((x, y) => INTENSITY_RANK[y.intensity] - INTENSITY_RANK[x.intensity])[0];
}

export function isUrgent(need: Need): boolean {
  return need.intensity !== "exploring";
}

/** The sentence an agent may share with the other party about a need. */
export function disclosedNeed(company: Company, need: Need): string {
  if (need.visibility === "agent-only" || need.visibility === "private") {
    return need.disclosure ?? `${company.name} has a relevant need (details withheld).`;
  }
  return `${company.name}: ${need.detail}`;
}

export function evidenceFromCapability(company: Company, capability: Capability): Omit<OpportunityEvidence, "id">[] {
  return capability.evidence.map((e) => ({
    claim: `${company.name} — ${e.excerpt}`,
    epistemic: e.epistemic,
    sourceId: e.sourceId,
    companyId: company.id,
    groundedIn: capability.id,
    visibility: capability.visibility,
    marketingLanguage: e.marketingLanguage,
  }));
}

export function evidenceFromNeed(company: Company, need: Need): Omit<OpportunityEvidence, "id">[] {
  const withheld = need.visibility === "agent-only" || need.visibility === "private";
  return need.evidence.map((e: EvidenceRef) => ({
    claim: withheld ? disclosedNeed(company, need) : `${company.name} — ${e.excerpt}`,
    privateDetail: withheld ? e.excerpt : undefined,
    epistemic: e.epistemic,
    sourceId: e.sourceId,
    companyId: company.id,
    groundedIn: need.id,
    visibility: need.visibility,
    marketingLanguage: e.marketingLanguage,
  }));
}

export function inference(companyId: string, claim: string): Omit<OpportunityEvidence, "id"> {
  return { claim, epistemic: "inference", sourceId: ORQO_INFERENCE_SOURCE, companyId, visibility: "connection" };
}

export function regionAdjective(company: Company): string {
  const europe = ["Germany", "Czechia", "EU", "DACH", "Benelux", "France", "Nordics", "Europe"];
  if (company.geographies.some((g) => europe.some((e) => g.includes(e)))) return "European";
  if (company.geographies.includes("United States")) return "US";
  return company.geographies[0] ?? "";
}

export function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** Lower-cases the first letter unless the word is an acronym ("GPU", "AI"). */
export function lowerFirst(s: string): string {
  if (/^[A-Z][A-Z]/.test(s) || /^(European|American|German|French|Dutch)\b/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function listOf(xs: readonly string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
