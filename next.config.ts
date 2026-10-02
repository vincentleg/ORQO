import type { NextConfig } from "next";

/** Pre-Phase-1 demo URLs, now served under /demo. Temporary: these paths become production spaces in Phase 2. */
const LEGACY_DEMO_PATHS = ["/network", "/signals", "/opportunities/:path*", "/opportunities", "/agent/:path*", "/agent", "/connect/:path*", "/connect"];

/**
 * Application-level security headers (Phase 12). Deliberately limited to directives that cannot break Next.js,
 * Supabase or the product: no script/style CSP (that needs per-request nonces and hosting configuration, Phase 13),
 * and no HSTS (it belongs to the HTTPS deployment, Phase 13).
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // Clickjacking: never framed (both the legacy header and the CSP directive).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const DEV = process.env.NODE_ENV !== "production";

/**
 * Phase 13: the candidate production CSP, in REPORT-ONLY mode (it blocks nothing). Derived from the real frontend:
 * Next.js inline bootstrap scripts and React style attributes need 'unsafe-inline' (no nonces yet), fonts are
 * self-hosted by next/font, the browser never calls Supabase or a provider directly (connect-src 'self'), and no
 * third-party script, frame or image origin is used. Dev adds what Next's dev server needs (eval, HMR socket).
 * Violations are reported to /api/csp-report via report-uri (sanitized, rate-capped). Enforcement is a later, reviewed step;
 * the enforced anti-framing policy above is unchanged.
 */
export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${DEV ? " ws: wss:" : ""}`,
  "media-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // report-uri only: verified end to end in Chromium. With `report-to` present Chromium ignores report-uri and its
  // Reporting API delivery could not be verified locally, so it is not used yet (the endpoint accepts both formats).
  "report-uri /api/csp-report",
].join("; ");

export const REPORTING_HEADERS: { key: string; value: string }[] = [{ key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY }];

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS, ...REPORTING_HEADERS] }];
  },
  async redirects() {
    return LEGACY_DEMO_PATHS.map((source) => ({ source, destination: `/demo${source}`, permanent: false }));
  },
};

export default nextConfig;
