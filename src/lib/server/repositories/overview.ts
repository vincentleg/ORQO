import { fromDbError } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";

export interface WorkspaceCounts {
  companies: number;
  relationships: number;
  opportunities: number;
}

async function count(db: Db, table: "companies" | "relationships" | "opportunities", organizationId: string): Promise<number> {
  const { count: n, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  if (error) throw fromDbError(error);
  return n ?? 0;
}

/** Real record counts for the dashboard (RLS-scoped; the org filter is a second layer). */
export async function countWorkspaceRecords(db: Db, organizationId: string): Promise<WorkspaceCounts> {
  const [companies, relationships, opportunities] = await Promise.all([
    count(db, "companies", organizationId),
    count(db, "relationships", organizationId),
    count(db, "opportunities", organizationId),
  ]);
  return { companies, relationships, opportunities };
}
