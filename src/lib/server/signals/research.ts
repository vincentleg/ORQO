import "server-only";
/**
 * Research → signals (Phase 7). Called after a Search analysis is stored: the
 * new analysis is compared with the one it replaced (detectDelta) and what is
 * new becomes signals of the matching Network company. No provider, no model,
 * no extra fetch — it only reuses what the governed Phase 3 run already read.
 * A first analysis is a baseline (no signals); an analysis of a company that
 * is not in the Network creates nothing.
 */
import { websiteDomain } from "@/lib/search/query";
import { detectDelta, type DeltaInput } from "@/lib/signals/model";
import type { TargetProfile } from "@/lib/intelligence/types";
import { listNetworkCompanies } from "@/lib/server/repositories/network-memory";
import { sourceIdsByUrl, storeSignalCandidates } from "@/lib/server/repositories/signals";
import type { Db } from "@/lib/server/supabase/types";

export async function recordResearchSignals(db: Db, organizationId: string, previous: DeltaInput["previous"], next: TargetProfile): Promise<{ created: number; seenAgain: number }> {
  const candidates = detectDelta({ previous, next });
  if (candidates.length === 0) return { created: 0, seenAgain: 0 };
  const company = (await listNetworkCompanies(db, organizationId)).find((c) => !c.isOwnCompany && c.website && websiteDomain(c.website) === next.domain);
  if (!company) return { created: 0, seenAgain: 0 };
  const ids = await sourceIdsByUrl(
    db,
    organizationId,
    candidates.map((c) => c.sourceUrl),
  );
  // A research signal must point at its evidence-store source; one whose source row is missing is dropped, not stored unsourced.
  const sourced = candidates.flatMap((c) => {
    const sourceId = ids.get(c.sourceUrl);
    return sourceId ? [{ ...c, sourceId }] : [];
  });
  return storeSignalCandidates(db, organizationId, company.id, sourced);
}
