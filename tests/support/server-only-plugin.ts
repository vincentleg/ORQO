/**
 * Preload for E2E scripts run with plain `bun` (scripts/isolated-test.ts): `import "server-only"` is a Next.js
 * build-time marker; outside Next it must be a no-op so the test harness can use server modules (the database
 * client). Scoped to the isolated runner's script suites; Next's own bundler still enforces the marker.
 */
import { plugin } from "bun";

plugin({
  name: "orqo-server-only-noop",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});
