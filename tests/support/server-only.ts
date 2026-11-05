/**
 * Test preload: `import "server-only"` marks modules that must never reach a client bundle (Next.js enforces it
 * at build time). Under `bun test` the marker is a no-op, so server modules can be tested directly.
 */
import { mock } from "bun:test";

mock.module("server-only", () => ({}));
