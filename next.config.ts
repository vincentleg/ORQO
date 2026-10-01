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

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return LEGACY_DEMO_PATHS.map((source) => ({ source, destination: `/demo${source}`, permanent: false }));
  },
};

export default nextConfig;
