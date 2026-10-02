import { cspReportEvents } from "@/lib/server/csp-report";
import { recordOperation } from "@/lib/server/observability";

/**
 * Phase 13: receives Content-Security-Policy-Report-Only violation reports (legacy `report-uri` and Reporting API
 * `report-to` formats). Unauthenticated by nature (browsers send reports without credentials), so it stores
 * nothing, keeps only the violated directive and the blocked ORIGIN (or a keyword such as "inline"), never the
 * page URL, path, query or sample, and is capped per process to bound log volume. Always 204.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024;
const MAX_PER_MINUTE = 60;
let windowStart = 0;
let count = 0;

export async function POST(request: Request) {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    count = 0;
  }
  if (count >= MAX_PER_MINUTE || Number(request.headers.get("content-length") ?? "0") > MAX_BYTES) return new Response(null, { status: 204 });
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return new Response(null, { status: 204 });
    for (const e of cspReportEvents(JSON.parse(text))) {
      if (count++ >= MAX_PER_MINUTE) break;
      recordOperation({ operation: "csp.report_only_violation", outcome: "denied", errorCategory: e.directive, target: e.blocked });
    }
  } catch {
    // Malformed reports are ignored.
  }
  return new Response(null, { status: 204 });
}
