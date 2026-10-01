/**
 * Add to Network from Discover — a human choice, never automatic.
 *
 * The company is read from the STORED result of a Prospecting run of this
 * organization (the caller only names the run and the domain), so nobody can
 * add an arbitrary company with Discover provenance or reach another
 * workspace's run. A Network company with the same domain is reused, never
 * duplicated. Provenance lives in companies.external_ref:
 * "discover:<run id>:<domain>" (unique per organization, so a double submit
 * keeps one row).
 */
import { DiscoveryResult } from "@/lib/agents/contracts";
import { findKnownCompany } from "@/lib/search/query";
import { getRun } from "@/lib/server/agents/repository";
import { AppError } from "@/lib/server/errors";
import { createCompany, listCompanies } from "@/lib/server/repositories/companies";
import type { Db } from "@/lib/server/supabase/types";

export const DISCOVER_REF_PREFIX = "discover:";

export async function addDiscoveredCompany(db: Db, organizationId: string, runId: string, domain: string): Promise<{ companyId: string; created: boolean }> {
  const run = await getRun(db, organizationId, runId);
  const parsed = run && run.agent_id === "prospecting" ? DiscoveryResult.safeParse(run.result) : null;
  const company = parsed?.success ? parsed.data.companies.find((c) => c.domain === domain) : undefined;
  if (!run || !company) throw new AppError("not_found", "This company is not part of that discovery result.");

  const known = () => listCompanies(db, organizationId).then((all) => findKnownCompany({ kind: "website", domain: company.domain, url: company.website }, all.filter((c) => !c.is_own_company)));
  const existing = await known();
  if (existing) return { companyId: existing.id, created: false };
  try {
    const row = await createCompany(db, organizationId, { name: company.name, website: company.website, externalRef: `${DISCOVER_REF_PREFIX}${run.id}:${company.domain}`.slice(0, 200) });
    return { companyId: row.id, created: true };
  } catch (e) {
    // Same run and domain submitted twice at once: the unique external_ref kept one row.
    if (e instanceof AppError && e.code === "conflict") {
      const again = await known();
      if (again) return { companyId: again.id, created: false };
    }
    throw e;
  }
}
