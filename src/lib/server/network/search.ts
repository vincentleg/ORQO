/**
 * Add to Network from Search — a human choice, never automatic.
 *
 * The caller only sends the search query. The server re-parses it, reads this
 * organization's stored analysis (if any) for the name, website and sourced
 * self-description, and never trusts a name or summary from the browser. A
 * Network company with the same domain (or, without a website, the same
 * name) is reused, never duplicated. Provenance: network_origin = 'search'
 * and external_ref "search:<domain>" (unique per organization, so a double
 * submit keeps one row).
 */
import { SEARCH_REF_PREFIX } from "@/lib/network/model";
import { findKnownCompany, parseSearchQuery, websiteDomain, type SearchTarget } from "@/lib/search/query";
import { AppError } from "@/lib/server/errors";
import { createCompany, listCompanies } from "@/lib/server/repositories/companies";
import { findIntelligence, nameKey } from "@/lib/server/research/repository";
import type { Db } from "@/lib/server/supabase/types";

export async function addSearchedCompany(db: Db, organizationId: string, query: string): Promise<{ companyId: string; created: boolean }> {
  const target = parseSearchQuery(query);
  if (!target) throw new AppError("invalid_input", "Nothing to add.");

  const intel = await findIntelligence(db, organizationId, target.kind === "website" ? { domain: target.domain } : { name: target.name });
  const profile = intel?.profile ?? null;
  const website = profile?.website ?? (target.kind === "website" ? target.url : undefined);
  const domain = website ? websiteDomain(website) : null;
  // Every key the company may already be known under: the searched target, and the analyzed site.
  const keys: SearchTarget[] = [target, ...(domain && website ? [{ kind: "website" as const, domain, url: website }] : [])];

  const known = async () => {
    const companies = (await listCompanies(db, organizationId)).filter((c) => !c.is_own_company);
    for (const k of keys) {
      const hit = findKnownCompany(k, companies);
      if (hit) return hit;
    }
    return null;
  };
  const existing = await known();
  if (existing) return { companyId: existing.id, created: false };

  const name = profile?.name ?? (target.kind === "website" ? target.domain : target.name);
  const summary = profile?.claims.find((c) => c.field === "summary")?.statement;
  const ref = `${SEARCH_REF_PREFIX}${domain ?? `name:${nameKey(name)}`}`.slice(0, 200);
  try {
    const row = await createCompany(db, organizationId, { name, networkOrigin: "search", externalRef: ref, ...(website && { website }), ...(summary && { summary: summary.slice(0, 4000) }) });
    return { companyId: row.id, created: true };
  } catch (e) {
    // The same company submitted twice at once: the unique external_ref kept one row.
    if (e instanceof AppError && e.code === "conflict") {
      const again = await known();
      if (again) return { companyId: again.id, created: false };
    }
    throw e;
  }
}
