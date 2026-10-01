/**
 * Phase 11: canonical opportunity reads for Opportunity Intelligence. A
 * recording fake (no database): every query is organization-filtered, only
 * minimized columns are read, private evidence detail is stripped, and nothing
 * is written. Fictional ids only.
 */
import { describe, expect, test } from "bun:test";
import type { Db } from "@/lib/server/supabase/types";
import { listOpportunityRecords, OPPORTUNITY_RECORD_COLUMNS } from "./opportunities";

const ORG = "0a000000-0000-4000-8000-00000000000a";
const CO = "00000000-0000-4000-8000-000000000002";
const OWN = "00000000-0000-4000-8000-000000000001";
const OPP = "00000000-0000-4000-8000-000000000060";

function recordingDb(rows: Record<string, unknown[]>) {
  const queries: { table: string; op: string; columns: string; filters: [string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      const q = { table, op: "select", columns: "", filters: [] as [string, unknown][] };
      queries.push(q);
      const chain: Record<string, unknown> = {
        select: (c: string) => ((q.columns = c), chain),
        insert: () => ((q.op = "insert"), chain),
        update: () => ((q.op = "update"), chain),
        delete: () => ((q.op = "delete"), chain),
        eq: (col: string, v: unknown) => (q.filters.push([col, v]), chain),
        in: (col: string, v: unknown) => (q.filters.push([col, v]), chain),
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
  };
  return { db: db as unknown as Db, queries };
}

describe("canonical opportunity records (read only)", () => {
  test("org-filtered, minimized, private detail stripped, participants resolved, no write", async () => {
    const { db, queries } = recordingDb({
      opportunity_participants: [{ opportunity_id: OPP }],
      opportunities: [
        {
          id: OPP,
          title: "Fictional bundle",
          stage: "meeting",
          kind: "reciprocal",
          why_exists: "w",
          why_now: "",
          structure: "s",
          evidence: [{ id: "e1", claim: "Public claim", privateDetail: "PRIVATE-DETAIL", visibility: "public", epistemic: "fact", sourceId: "x", companyId: CO }, { broken: true }],
          assumptions: [],
          unknowns: ["u"],
          questions: ["q"],
          missing_capabilities: [],
          critic: { verdict: "weak" },
          opportunity_participants: [
            { company_id: CO, role: "partner", contributions: ["B"], position: 1 },
            { company_id: OWN, role: "vendor", contributions: ["A"], position: 0 },
          ],
        },
      ],
      companies: [
        { id: OWN, name: "Own (fictional)", is_own_company: true },
        { id: CO, name: "Partner (fictional)", is_own_company: false },
      ],
    });
    const [r] = await listOpportunityRecords(db, ORG, CO);
    for (const q of queries) {
      expect(q.op).toBe("select");
      expect(q.filters).toContainEqual(["organization_id", ORG]);
    }
    expect(queries.find((q) => q.table === "opportunities")!.columns).toBe(OPPORTUNITY_RECORD_COLUMNS);
    for (const col of ["trigger", "delta", "stage_history", "created_by"]) expect(OPPORTUNITY_RECORD_COLUMNS).not.toContain(col);
    expect(JSON.stringify(r)).not.toContain("PRIVATE-DETAIL");
    expect(r.evidence.length).toBe(1);
    expect(r.criticVerdict).toBe("weak");
    expect(r.participants.map((p) => p.name)).toEqual(["Own (fictional)", "Partner (fictional)"]);
    expect(r.stage).toBe("meeting");
  });

  test("arbitrary or empty input reads nothing further", async () => {
    const { db, queries } = recordingDb({});
    expect(await listOpportunityRecords(db, ORG, "not-a-uuid")).toEqual([]);
    expect(queries.length).toBe(0);
    expect(await listOpportunityRecords(db, ORG, CO)).toEqual([]);
    expect(queries.length).toBe(1);
  });
});
