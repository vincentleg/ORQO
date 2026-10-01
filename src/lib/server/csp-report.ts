/** Phase 13: sanitizes CSP violation reports to a directive and a blocked ORIGIN/keyword. Pure. */
function blockedOrigin(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "unknown";
  if (/^(inline|eval|wasm-eval|trusted-types-[a-z-]+|data|blob|self)$/i.test(raw)) return raw.toLowerCase();
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ws:" || u.protocol === "wss:" ? u.origin : u.protocol.replace(":", "");
  } catch {
    return "unknown";
  }
}

const directiveOf = (raw: unknown): string => (typeof raw === "string" && /^[a-z-]{1,40}$/.test(raw.split(" ")[0]) ? raw.split(" ")[0] : "unknown");

export function cspReportEvents(body: unknown): { directive: string; blocked: string }[] {
  const items = Array.isArray(body) ? body.map((r) => (r && typeof r === "object" ? (r as { body?: unknown }).body : null)) : [body && typeof body === "object" ? (body as Record<string, unknown>)["csp-report"] : null];
  return items.slice(0, 10).flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const x = r as Record<string, unknown>;
    return [{ directive: directiveOf(x.effectiveDirective ?? x["effective-directive"] ?? x["violated-directive"]), blocked: blockedOrigin(x.blockedURL ?? x["blocked-uri"]) }];
  });
}
