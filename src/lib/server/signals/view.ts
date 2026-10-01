import "server-only";
/**
 * Read model for Intelligence (Phase 7): stored public signals + the
 * organization's own profile + private relationship memory, combined at read
 * time by the pure, deterministic assessSignal / reevaluate. Nothing is
 * written and no provider or model is called.
 */
import type { OwnCompanyContext } from "@/lib/intelligence/types";
import type { ContactView } from "@/lib/network/model";
import type { SignalView } from "@/lib/signals/model";
import { assessSignal, reevaluate, type Reevaluation, type RelationshipMemory, type SignalAssessment } from "@/lib/signals/relevance";
import { getOwnCompanyProfile, toOwnContext } from "@/lib/server/repositories/companies";
import { listNetworkCompanies, type NetworkCompany } from "@/lib/server/repositories/network-memory";
import { listSignals, relationshipMemories } from "@/lib/server/repositories/signals";
import type { Db } from "@/lib/server/supabase/types";

export interface AssessedSignal {
  signal: SignalView;
  assessment: SignalAssessment;
  reevaluation: Reevaluation;
  company: NetworkCompany;
}

export interface SignalsView {
  own: OwnCompanyContext | null;
  ownName: string | null;
  items: AssessedSignal[];
  companies: Map<string, NetworkCompany>;
  memories: Map<string, RelationshipMemory>;
}

export async function loadSignalsView(db: Db, organizationId: string, opts: { companyId?: string } = {}): Promise<SignalsView> {
  const [signals, companies, ownRow] = await Promise.all([listSignals(db, organizationId, { companyId: opts.companyId }), listNetworkCompanies(db, organizationId), getOwnCompanyProfile(db, organizationId)]);
  const own = ownRow ? toOwnContext(ownRow) : null;
  const byId = new Map(companies.filter((c) => !c.isOwnCompany).map((c) => [c.id, c]));
  const memories = await relationshipMemories(db, organizationId, [...new Set(signals.map((s) => s.companyId))]);
  const items = signals.flatMap((signal) => {
    const company = byId.get(signal.companyId);
    if (!company) return [];
    const memory = memories.get(signal.companyId) ?? null;
    const assessment = assessSignal(signal, own, memory);
    return [{ signal, assessment, reevaluation: reevaluate(signal, assessment, memory), company }];
  });
  return { own, ownName: ownRow?.name ?? null, items, companies: byId, memories };
}

export type { ContactView };
