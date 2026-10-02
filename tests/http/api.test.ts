/**
 * Server authorization over HTTP, against a running ORQO server
 * (BASE_URL, default http://localhost:3100) connected to the real Supabase
 * development project. API callers authenticate with `Authorization: Bearer`.
 *
 * Set ORQO_TEST_LIVE_AI=1 to also exercise one real OpenRouter call through the
 * demo's Live AI route (spends model credits).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildInitialWorld } from "@/lib/engine/world";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { importDemoRelationship, type ImportedFixture } from "../support/demo-fixture";
import { repositorySink } from "../support/repository-sink";
import { addMember, admin, cleanupTestData, createTestUser, testEmail, type TestUser } from "../support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
let A: TestUser;
let B: TestUser;
let V: TestUser;
let orgA: string;
let orgB: string;
let fixture: ImportedFixture;

function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  return fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual", body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
}

beforeAll(async () => {
  const up = await fetch(`${BASE}/api/status`).catch(() => null);
  if (!up?.ok) throw new Error(`ORQO server not reachable at ${BASE}; start it first (bun run build && bun run start -p 3100).`);
  await cleanupTestData();
  [A, B, V] = await Promise.all([createTestUser("http-a"), createTestUser("http-b"), createTestUser("http-viewer")]);
  orgA = await createOrganization(A.db, { name: "HTTP Org A" });
  orgB = await createOrganization(B.db, { name: "HTTP Org B" });
  await addMember(orgA, V.id, "viewer");
  fixture = await importDemoRelationship(repositorySink(A.db, orgA), "r-maya-lukas");
});
afterAll(cleanupTestData);

describe("unauthenticated requests are refused", () => {
  test.each([
    ["GET", "/api/v1/organizations"],
    ["POST", "/api/v1/organizations"],
    ["GET", "/api/v1/me"],
    ["GET", `/api/v1/organizations/${crypto.randomUUID()}/companies`],
    ["POST", `/api/v1/organizations/${crypto.randomUUID()}/relationships/${crypto.randomUUID()}/evaluate`],
  ])("%s %s → 401", async (method, path) => {
    const res = await call(path, { method, json: method === "POST" ? {} : undefined });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthenticated", message: "Sign in required." } });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  test.each([
    ["POST", "/api/discover"],
    ["GET", "/api/research?company=ORQO"],
    ["POST", "/api/graph"],
  ])("legacy cost-bearing route %s %s → 401", async (method, path) => {
    const res = await call(path, { method, json: method === "POST" ? { world: {} } : undefined });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in required." });
  });

  test("the Deal Intelligence Report is not served signed out: redirect to sign-in, no content", async () => {
    const res = await fetch(`${BASE}/workspace/report?q=gigaio.com`, { redirect: "manual" });
    expect([307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
    expect(await res.text()).not.toContain("deal-report");
  });

  test("an invalid bearer token is refused", async () => {
    expect((await call("/api/v1/organizations", { token: "not-a-real-token" })).status).toBe(401);
  });

  test("public endpoints stay public: graph health and service status", async () => {
    expect((await call("/api/graph")).status).toBe(200);
    const status = (await (await call("/api/status")).json()) as { ai: { available: boolean } };
    expect(status.ai.available).toBe(false);
  });
});

describe("organization-scoped access", () => {
  test("a user lists only their own organizations", async () => {
    const res = await call("/api/v1/organizations", { token: A.accessToken });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { organizations: { organizationId: string }[] }).organizations.map((o) => o.organizationId)).toEqual([orgA]);
  });

  test("a member can create a company in their organization", async () => {
    const res = await call(`/api/v1/organizations/${orgA}/companies`, { method: "POST", token: A.accessToken, json: { name: "Created over HTTP", website: "https://example.com" } });
    expect(res.status).toBe(201);
    const list = (await (await call(`/api/v1/organizations/${orgA}/companies`, { token: A.accessToken })).json()) as { companies: { name: string }[] };
    expect(list.companies.map((c) => c.name)).toContain("Created over HTTP");
  });

  test("another organization's id in the URL is not proof of access: 404, nothing written", async () => {
    const res = await call(`/api/v1/organizations/${orgB}/companies`, { method: "POST", token: A.accessToken, json: { name: "Injected into B" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Organization not found." } });
    const bList = (await (await call(`/api/v1/organizations/${orgB}/companies`, { token: B.accessToken })).json()) as { companies: unknown[] };
    expect(bList.companies).toEqual([]);
  });

  test("a viewer can read but not write", async () => {
    expect((await call(`/api/v1/organizations/${orgA}/companies`, { token: V.accessToken })).status).toBe(200);
    const res = await call(`/api/v1/organizations/${orgA}/companies`, { method: "POST", token: V.accessToken, json: { name: "Viewer write" } });
    expect(res.status).toBe(403);
  });

  test("invalid and oversized bodies are rejected with 400", async () => {
    expect((await call(`/api/v1/organizations/${orgA}/companies`, { method: "POST", token: A.accessToken, json: { name: "" } })).status).toBe(400);
    expect((await call(`/api/v1/organizations/${orgA}/companies`, { method: "POST", token: A.accessToken, json: { name: "x", website: "javascript:alert(1)" } })).status).toBe(400);
    expect((await call(`/api/v1/organizations/${orgA}/companies`, { method: "POST", token: A.accessToken, body: "{not json", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await call(`/api/v1/organizations/${orgA}/companies`, { method: "POST", token: A.accessToken, json: { name: "x".repeat(70_000) } })).status).toBe(400);
  });
});

describe("server-authoritative evaluation", () => {
  const path = () => `/api/v1/organizations/${orgA}/relationships/${fixture.relationshipId}/evaluate`;

  test("evaluation runs on database state and returns the discovered opportunity", async () => {
    const res = await call(path(), { method: "POST", token: A.accessToken, json: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string; opportunities: { title: string }[] };
    expect(body.outcome).toBe("opportunity");
    expect(body.opportunities.map((o) => o.title)).toEqual(["European Edge AI Appliance Partnership"]);
  });

  test("the server refuses client-supplied application state", async () => {
    const res = await call(path(), { method: "POST", token: A.accessToken, json: { world: buildInitialWorld() } });
    expect(res.status).toBe(400);
  });

  test("another tenant cannot evaluate the relationship", async () => {
    expect((await call(path(), { method: "POST", token: B.accessToken, json: {} })).status).toBe(404);
    expect((await call(`/api/v1/organizations/${orgB}/relationships/${fixture.relationshipId}/evaluate`, { method: "POST", token: B.accessToken, json: {} })).status).toBe(404);
  });

  test("a viewer cannot run an evaluation", async () => {
    expect((await call(path(), { method: "POST", token: V.accessToken, json: {} })).status).toBe(403);
  });
});

describe("profile", () => {
  test("the language preference is read and updated through the API", async () => {
    const res = await call("/api/v1/me", { method: "PATCH", token: A.accessToken, json: { locale: "fr" } });
    expect(res.status).toBe(200);
    expect(((await (await call("/api/v1/me", { token: A.accessToken })).json()) as { profile: { locale: string } }).profile.locale).toBe("fr");
    expect((await call("/api/v1/me", { method: "PATCH", token: A.accessToken, json: { locale: "de" } })).status).toBe(400);
  });
});

describe("email confirmation route", () => {
  test("a valid token_hash signs the user in and continues to onboarding", async () => {
    const link = await admin.auth.admin.generateLink({ type: "signup", email: testEmail("http-confirm"), password: `pw-${crypto.randomUUID()}` });
    const token = link.data.properties?.hashed_token ?? "";
    const res = await call(`/auth/confirm?token_hash=${encodeURIComponent(token)}&type=signup`);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/onboarding");
    expect(res.headers.getSetCookie().some((c) => /^sb-[^=]+-auth-token/.test(c))).toBe(true);
  });

  test("an invalid token is rejected without a session", async () => {
    const res = await call("/auth/confirm?token_hash=bogus&type=signup");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?error=confirm");
    expect(res.headers.getSetCookie().some((c) => /^sb-[^=]+-auth-token=[^;]+/.test(c) && !/Max-Age=0/i.test(c))).toBe(false);
  });

  test("redirect targets are same-site only", async () => {
    const res = await call("/auth/confirm?token_hash=bogus&type=signup&next=//evil.example");
    expect(new URL(res.headers.get("location") ?? "").host).toBe(new URL(BASE).host);
  });
});

describe.if(process.env.ORQO_TEST_LIVE_AI === "1")("live AI (opt-in, real OpenRouter call)", () => {
  test("signed-in users can still run the demo's Live AI discovery", async () => {
    const status = (await (await call("/api/status", { token: A.accessToken })).json()) as { ai: { available: boolean } };
    expect(status.ai.available).toBe(true);
    const res = await call("/api/discover", { method: "POST", token: A.accessToken, json: { world: buildInitialWorld(), relationshipId: "r-maya-lukas" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { engine: string }).engine).toMatch(/^openrouter:/);
  }, 90_000);
});
