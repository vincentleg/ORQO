/**
 * Company identity for Events (Phase 8). An event never creates a second copy
 * of a company the organization already knows: it reuses the canonical
 * company found by website domain, then by name (the Search conventions).
 * When the same name is already known under a DIFFERENT website, the match is
 * ambiguous and nothing is merged silently. Pure and deterministic.
 */
import { findKnownCompany, websiteDomain } from "@/lib/search/query";

export interface KnownCompany {
  id: string;
  name: string;
  website: string | null;
  isOwnCompany: boolean;
}

export type EventCompanyResolution =
  | { kind: "existing"; companyId: string }
  | { kind: "ambiguous"; companyId: string; name: string }
  | { kind: "own_company" }
  | { kind: "create"; name: string; website: string | null; domain: string | null };

export function resolveEventCompany(input: { name: string; website: string | null }, companies: readonly KnownCompany[]): EventCompanyResolution {
  const name = input.name.trim().replace(/\s+/g, " ");
  const domain = input.website ? websiteDomain(input.website) : null;
  const website = domain ? input.website : null;

  if (domain) {
    const byDomain = findKnownCompany({ kind: "website", domain, url: `https://${domain}` }, companies);
    if (byDomain) return byDomain.isOwnCompany ? { kind: "own_company" } : { kind: "existing", companyId: byDomain.id };
  }
  const byName = findKnownCompany({ kind: "name", name }, companies);
  if (byName) {
    if (byName.isOwnCompany) return { kind: "own_company" };
    const known = byName.website ? websiteDomain(byName.website) : null;
    if (domain && known && known !== domain) return { kind: "ambiguous", companyId: byName.id, name: byName.name };
    return { kind: "existing", companyId: byName.id };
  }
  return { kind: "create", name, website, domain };
}

/** Provenance key of a company created through an event (unique per organization: a double submit keeps one row). */
export function eventExternalRef(eventId: string, r: { name: string; domain: string | null }): string {
  const key = r.domain ?? `name:${r.name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}`;
  return `event:${eventId}:${key}`.slice(0, 200);
}
