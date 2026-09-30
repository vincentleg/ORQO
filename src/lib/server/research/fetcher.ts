/**
 * Official-site / public-page retrieval with SSRF checks on every hop, manual
 * bounded redirects, content-type and size limits, timeouts and robots.txt.
 * No credentials, cookies or ORQO headers other than the User-Agent are sent.
 */
import { USER_AGENT, type ResearchLimits } from "./config";
import { assertSafeUrl, systemResolver, UnsafeUrlError, type Resolver } from "./url-safety";

export type FetchFailure = "blocked_url" | "unreachable" | "timeout" | "http_status" | "not_html" | "too_many_redirects";

export class FetchError extends Error {
  constructor(
    readonly reason: FetchFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  truncated: boolean;
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface PageFetcher {
  fetchPage(url: string, opts?: { accept?: "html" | "text"; timeoutMs?: number }): Promise<FetchedPage>;
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) return { text: "", bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (bytes + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - bytes));
      bytes = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  const buf = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), bytes, truncated };
}

export function createPageFetcher(opts: { limits: Pick<ResearchLimits, "maxRedirects" | "maxBytesPerPage" | "fetchTimeoutMs">; fetchImpl?: FetchImpl; resolve?: Resolver }): PageFetcher {
  const doFetch: FetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const resolve = opts.resolve ?? systemResolver;
  return {
    async fetchPage(start, { accept = "html", timeoutMs } = {}) {
      let current = start;
      const signal = AbortSignal.timeout(Math.max(1, Math.min(timeoutMs ?? opts.limits.fetchTimeoutMs, opts.limits.fetchTimeoutMs)));
      for (let hop = 0; hop <= opts.limits.maxRedirects; hop++) {
        try {
          await assertSafeUrl(current, resolve);
        } catch (e) {
          if (e instanceof UnsafeUrlError && e.message === "Host does not resolve.") throw new FetchError("unreachable", e.message);
          throw new FetchError("blocked_url", e instanceof Error ? e.message : "Blocked URL.");
        }
        let res: Response;
        try {
          res = await doFetch(current, {
            method: "GET",
            redirect: "manual",
            signal,
            credentials: "omit",
            headers: { "user-agent": USER_AGENT, accept: accept === "html" ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" : "text/plain,*/*;q=0.1", "accept-language": "en,fr;q=0.8" },
          });
        } catch (e) {
          if (signal.aborted || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))) throw new FetchError("timeout", "The site did not respond in time.");
          throw new FetchError("unreachable", "The site could not be reached.");
        }
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          await res.body?.cancel().catch(() => undefined);
          if (!location) throw new FetchError("http_status", `Redirect without location (${res.status}).`);
          current = new URL(location, current).toString();
          continue;
        }
        if (res.status !== 200) {
          await res.body?.cancel().catch(() => undefined);
          throw new FetchError("http_status", `HTTP ${res.status}`);
        }
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        const ok = accept === "html" ? /text\/html|application\/xhtml\+xml/.test(contentType) : /text\/plain/.test(contentType) || contentType === "";
        if (!ok) {
          await res.body?.cancel().catch(() => undefined);
          throw new FetchError("not_html", `Unsupported content type.`);
        }
        const declared = Number(res.headers.get("content-length") ?? "0");
        if (declared > opts.limits.maxBytesPerPage * 4) {
          await res.body?.cancel().catch(() => undefined);
          throw new FetchError("not_html", "Page too large.");
        }
        try {
          const { text, bytes, truncated } = await readCapped(res, opts.limits.maxBytesPerPage);
          return { url: current, status: res.status, contentType, body: text, bytes, truncated };
        } catch {
          if (signal.aborted) throw new FetchError("timeout", "The site did not respond in time.");
          throw new FetchError("unreachable", "The page could not be read.");
        }
      }
      throw new FetchError("too_many_redirects", "Too many redirects.");
    },
  };
}

/** robots.txt rules for our user agent (or `*`). Longest match wins; Allow beats Disallow on ties. */
export interface RobotsRules {
  isAllowed(path: string): boolean;
}

export function parseRobots(text: string, agent = "orqo-research"): RobotsRules {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/).slice(0, 2000)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value || key === "allow") current.rules.push({ allow: key === "allow", path: value });
    } else lastWasAgent = false;
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules).filter((r) => r.path);
  const toRe = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
  return {
    isAllowed(path: string) {
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        if (!toRe(r.path).test(path)) continue;
        if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) best = { allow: r.allow, len: r.path.length };
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true };
