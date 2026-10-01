/**
 * Canonical application URL and cookie security (Phase 13).
 *
 * ORQO_SITE_URL is the public origin users reach the app at (e.g. the HTTPS
 * production domain). It is used for links that leave the request context —
 * the sign-up confirmation email — so those links never depend on
 * caller-supplied Origin/Host headers. It is not a secret.
 *
 * - Production (NODE_ENV=production): ORQO_SITE_URL is required. It must be
 *   https, except for a loopback host (a local production build). If it is
 *   missing or invalid, sign-up is refused with a controlled error rather
 *   than producing a link to an attacker-chosen or localhost origin.
 * - Development/test: when unset, a loopback request origin is used, otherwise
 *   http://localhost:3000.
 */
import { AppError } from "./errors";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class SiteUrlError extends AppError {
  constructor() {
    super("unavailable", "Sign-up is not available on this deployment.");
  }
}

/** The configured origin, validated; null when unset or invalid. */
export function configuredSiteOrigin(env: NodeJS.ProcessEnv = process.env): URL | null {
  const raw = env.ORQO_SITE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  return url;
}

/** Origin (scheme://host[:port], no trailing slash) for absolute links such as the sign-up confirmation. */
export function siteOrigin(opts: { env?: NodeJS.ProcessEnv; requestOrigin?: string | null } = {}): string {
  const env = opts.env ?? process.env;
  const configured = configuredSiteOrigin(env);
  if (configured) return configured.origin;
  if (env.NODE_ENV === "production") throw new SiteUrlError();
  // Development only: trust a loopback request origin, nothing else.
  try {
    const r = opts.requestOrigin ? new URL(opts.requestOrigin) : null;
    if (r && LOOPBACK.has(r.hostname) && (r.protocol === "http:" || r.protocol === "https:")) return r.origin;
  } catch {
    // fall through
  }
  return "http://localhost:3000";
}

/**
 * Whether cookies must carry the Secure attribute: in production, unless the configured site is a
 * loopback http origin (a local production build). Missing configuration in production means Secure
 * (fail safe: a misconfigured HTTPS deployment never sends session cookies in clear).
 */
export function secureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return false;
  const configured = configuredSiteOrigin(env);
  return !(configured && configured.protocol === "http:");
}
