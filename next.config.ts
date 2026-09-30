import type { NextConfig } from "next";

/** Pre-Phase-1 demo URLs, now served under /demo. Temporary: these paths become production spaces in Phase 2. */
const LEGACY_DEMO_PATHS = ["/network", "/signals", "/opportunities/:path*", "/opportunities", "/agent/:path*", "/agent", "/connect/:path*", "/connect"];

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return LEGACY_DEMO_PATHS.map((source) => ({ source, destination: `/demo${source}`, permanent: false }));
  },
};

export default nextConfig;
