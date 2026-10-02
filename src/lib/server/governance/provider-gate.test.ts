/**
 * Phase 17A provider gate, with FAKE transports and an in-memory ledger standing in for the database
 * functions (the real functions are exercised by tests/db/governance.test.ts). The transport counter proves
 * that every denied case is refused before any provider could be reached.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { buildAuthority, type AuthorityContract } from "@/lib/governance/authority";
import { resolveEntitlementFrom } from "@/lib/governance/entitlement";
import { TripwireError } from "@/lib/governance/tripwire";
import { ProviderCallError } from "@/lib/server/research/providers";
import type { Db } from "@/lib/server/supabase/types";
import { governedModelCall, governedSearch, ProviderDeniedError, setTransportsForTests, type GovernedCallContext } from "./provider-gate";
import type { ProviderTransports } from "./transports";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const USER = "00000000-0000-4000-8000-0000000000c3";
const RUN = "00000000-0000-4000-8000-0000000000d4";
const SAVED = { ...process.env };

interface Row { id: string; amount: number; status: "reserved" | "settled" | "released"; settled: number | null; outcome?: string; known?: boolean }
let ledger: Row[];
let audits: { tripwire: string; detail: string | null }[];
let usage: Record<string, unknown>[];
let calls: { provider: string; reservationStatus: string | undefined }[];
let script: ((attempt: number) => { cost: number | null } | "fail")[];

function fakeDb(): Db {
  const rpc = async (name: string, a: Record<string, unknown>) => {
    if (name === "reserve_provider_spend") {
      const existing = ledger.find((r) => r.id === a.p_idempotency_key);
      if (existing) return { data: { id: existing.id, reused: true }, error: null };
      const committed = ledger.reduce((s, r) => s + (r.status === "reserved" ? r.amount : (r.settled ?? 0)), 0);
      if (committed + Number(a.p_amount_usd) > Number(a.p_ceiling_usd) + 1e-12) return { data: null, error: { code: "54001", message: "ceiling" } };
      // The idempotency key (a UUID) doubles as the reservation id in this fake.
      const id = String(a.p_idempotency_key);
      ledger.push({ id, amount: Number(a.p_amount_usd), status: "reserved", settled: null });
      return { data: { id, reused: false }, error: null };
    }
    if (name === "settle_provider_spend") {
      const r = ledger.find((x) => x.id === a.p_reservation_id)!;
      r.status = a.p_outcome === "not_sent" ? "released" : "settled";
      r.settled = a.p_outcome === "not_sent" ? 0 : a.p_cost_usd === null ? r.amount : Number(a.p_cost_usd);
      r.outcome = String(a.p_outcome);
      r.known = a.p_cost_usd !== null;
      return { data: null, error: null };
    }
    if (name === "record_governance_event") {
      audits.push({ tripwire: String(a.p_tripwire), detail: (a.p_detail as string) ?? null });
      return { data: null, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  return { rpc, from: () => ({ insert: async (row: Record<string, unknown>) => (usage.push(row), { error: null }) }) } as unknown as Db;
}

const fake: ProviderTransports = {
  async openrouter(permit, req) {
    const attempt = calls.filter((c) => c.provider === "openrouter").length;
    calls.push({ provider: "openrouter", reservationStatus: ledger.find((r) => r.id === permit.reservationId)?.status });
    const s = (script[attempt] ?? (() => ({ cost: 0.001 })))(attempt);
    if (s === "fail") throw Object.assign(new Error("fake failure"), { usage: { promptTokens: 10, completionTokens: 0, costUsd: null } });
    return { data: req.schema.parse({ ok: true }), model: req.model, usage: { promptTokens: 100, completionTokens: 20, costUsd: s.cost } };
  },
  async brave(permit) {
    calls.push({ provider: "brave", reservationStatus: ledger.find((r) => r.id === permit.reservationId)?.status });
    return { hits: [{ title: "A", url: "https://a.example", snippet: "s" }] };
  },
};

const internalEnv = { ORQO_INTERNAL_ORGS: ORG, ORQO_INTERNAL_BUDGET_USD: "1", OPENROUTER_API_KEY: "sk-or-v1-FAKE", BRAVE_API_KEY: "FAKE", ORQO_PROVIDERS_KILL_SWITCH: "", ORQO_LIVE_AI: "" };
const authority = (over: Partial<AuthorityContract> = {}): AuthorityContract => ({
  ...buildAuthority({ principal: { organizationId: ORG, userId: USER }, entitlement: resolveEntitlementFrom(ORG, "free", internalEnv), agent: AGENT_REGISTRY.research, capability: "company_research", autonomy: 2, envelope: { maxCostUsd: 0.5 }, ids: { missionId: null, runId: RUN } }),
  ...over,
});
const ctx = (a: AuthorityContract | null = authority(), org = ORG): GovernedCallContext => ({ db: fakeDb(), organizationId: org, userId: USER, authority: a, agentRunId: RUN, researchRunId: null });
const model = (c: GovernedCallContext, task: "extraction" | "business_reasoning" | "critique" = "extraction", key = crypto.randomUUID()) => governedModelCall(c, { task, name: "t", schema: z.object({ ok: z.boolean() }), messages: [], timeoutMs: 1000, idempotencyKey: key });

let restore: () => void;
beforeEach(() => {
  Object.assign(process.env, internalEnv);
  delete process.env.ORQO_MODEL_EXTRACTION;
  delete process.env.ORQO_DISCOVERY_MODEL;
  delete process.env.OPENROUTER_MODEL;
  ledger = [];
  audits = [];
  usage = [];
  calls = [];
  script = [];
  restore = setTransportsForTests(fake);
});
afterEach(() => restore());
afterAll(() => {
  for (const k of Object.keys(process.env)) if (!(k in SAVED)) delete process.env[k];
  Object.assign(process.env, SAVED);
});

describe("denied before any provider (transport never reached)", () => {
  test("Free: no paid entitlement", async () => {
    process.env.ORQO_INTERNAL_ORGS = "";
    await expect(model(ctx())).rejects.toMatchObject({ denial: "not_entitled" });
    expect(calls).toEqual([]);
    expect(ledger).toEqual([]);
  });

  test("Internal without a valid ceiling", async () => {
    process.env.ORQO_INTERNAL_BUDGET_USD = "not-a-number";
    await expect(model(ctx())).rejects.toMatchObject({ denial: "not_entitled" });
    expect(calls).toEqual([]);
  });

  test("missing authority → tripwire, audited", async () => {
    await expect(model(ctx(null))).rejects.toBeInstanceOf(TripwireError);
    expect(audits.map((a) => a.tripwire)).toEqual(["missing_authority"]);
    expect(calls).toEqual([]);
  });

  test("an authority from another organization → tripwire", async () => {
    await expect(model(ctx(authority({ organizationId: OTHER })))).rejects.toMatchObject({ tripwire: "cross_organization" });
    expect(calls).toEqual([]);
  });

  test("provider or task outside the authority → tripwire", async () => {
    await expect(model(ctx(), "critique")).rejects.toMatchObject({ tripwire: "provider_outside_authority" });
    await expect(governedSearch(ctx(authority({ providers: { openrouter: authority().providers.openrouter, brave: false } })), { query: "q", count: 3, timeoutMs: 1000, idempotencyKey: "k" })).rejects.toMatchObject({ tripwire: "provider_outside_authority" });
    await expect(governedSearch(ctx(authority({ network: "official_sites" })), { query: "q", count: 3, timeoutMs: 1000, idempotencyKey: "k2" })).rejects.toMatchObject({ tripwire: "unauthorized_network" });
    await expect(model(ctx(authority({ limits: { ...authority().limits, maxCostUsd: 0 } })))).rejects.toMatchObject({ tripwire: "cost_limit" });
    expect(calls).toEqual([]);
    expect(audits.map((a) => a.tripwire)).toEqual(["provider_outside_authority", "provider_outside_authority", "unauthorized_network", "cost_limit"]);
  });

  test("kill switch", async () => {
    process.env.ORQO_PROVIDERS_KILL_SWITCH = "on";
    await expect(model(ctx())).rejects.toMatchObject({ denial: "kill_switch" });
    await expect(governedSearch(ctx(), { query: "q", count: 3, timeoutMs: 1000, idempotencyKey: "k" })).rejects.toMatchObject({ denial: "kill_switch" });
    expect(calls).toEqual([]);
    expect(ledger).toEqual([]);
  });

  test("credentials absent", async () => {
    process.env.OPENROUTER_API_KEY = "";
    await expect(model(ctx())).rejects.toMatchObject({ denial: "not_configured" });
    expect(calls).toEqual([]);
  });

  test("insufficient budget: refused at reservation, never sent", async () => {
    process.env.ORQO_INTERNAL_BUDGET_USD = "0.001";
    await expect(model(ctx())).rejects.toMatchObject({ denial: "budget_exhausted" });
    expect(calls).toEqual([]);
    expect(ledger).toEqual([]);
  });
});

describe("reserve → send → settle", () => {
  test("the reservation exists before the transport runs; reported cost settles it; usage links to it", async () => {
    const r = await model(ctx());
    expect(r.data).toEqual({ ok: true });
    expect(calls).toEqual([{ provider: "openrouter", reservationStatus: "reserved" }]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ status: "settled", settled: 0.001, outcome: "succeeded", known: true });
    expect(usage[0]).toMatchObject({ organization_id: ORG, agent_run_id: RUN, reservation_id: ledger[0].id, provider: "openrouter", succeeded: true });
    expect(typeof usage[0].duration_ms).toBe("number");
  });

  test("unknown cost is settled at the full reservation, never as zero", async () => {
    script = [() => ({ cost: null })];
    await model(ctx());
    expect(ledger[0].settled).toBe(ledger[0].amount);
    expect(ledger[0].known).toBe(false);
    await governedSearch(ctx(), { query: "q", count: 3, timeoutMs: 1000, idempotencyKey: "s1" });
    expect(ledger[1]).toMatchObject({ status: "settled", known: false });
    expect(ledger[1].settled).toBe(ledger[1].amount);
  });

  test("a provider failure is accounted for, then ONE fallback, each with its own reservation", async () => {
    process.env.ORQO_DISCOVERY_MODEL = "fallback/model";
    process.env.ORQO_MODEL_EXTRACTION = "primary/model";
    script = [() => "fail", () => ({ cost: 0.002 })];
    const r = await model(ctx());
    expect(r.data).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(ledger.map((x) => [x.outcome, x.settled === x.amount])).toEqual([["failed", true], ["succeeded", false]]);
    expect(usage.map((u) => u.succeeded)).toEqual([false, true]);
  });

  test("retries are bounded: two failures, two calls, then a failure (no chain)", async () => {
    process.env.ORQO_DISCOVERY_MODEL = "fallback/model";
    process.env.ORQO_MODEL_EXTRACTION = "primary/model";
    script = [() => "fail", () => "fail", () => ({ cost: 0.001 })];
    await expect(model(ctx())).rejects.toBeInstanceOf(ProviderCallError);
    expect(calls).toHaveLength(2);
    expect(ledger.every((x) => x.status === "settled" && x.settled === x.amount)).toBe(true);
  });

  test("exact limit: a call that fits exactly is allowed; the next one is refused", async () => {
    // Ceiling = exactly one extraction reservation.
    const { selectModel } = await import("@/lib/governance/model-policy");
    process.env.ORQO_INTERNAL_BUDGET_USD = String(selectModel("extraction", { maxTier: "standard", env: {} })!.primary.reservationUsd);
    script = [() => ({ cost: null })];
    await model(ctx());
    await expect(model(ctx())).rejects.toMatchObject({ denial: "budget_exhausted" });
    expect(calls).toHaveLength(1);
  });

  test("the same logical call is never sent twice (retry, double submit)", async () => {
    await model(ctx(), "extraction", "same-key");
    await expect(model(ctx(), "extraction", "same-key")).rejects.toMatchObject({ code: "conflict" });
    expect(ledger).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe("Internal bypasses nothing", () => {
  test("Internal is still refused by kill switch, budget and authority", async () => {
    process.env.ORQO_PROVIDERS_KILL_SWITCH = "on";
    await expect(model(ctx())).rejects.toBeInstanceOf(ProviderDeniedError);
    process.env.ORQO_PROVIDERS_KILL_SWITCH = "";
    process.env.ORQO_INTERNAL_BUDGET_USD = "0.0001";
    await expect(model(ctx())).rejects.toMatchObject({ denial: "budget_exhausted" });
    process.env.ORQO_INTERNAL_BUDGET_USD = "1";
    await expect(model(ctx(authority({ tools: ["official_site_research"], providers: { openrouter: null, brave: false } })))).rejects.toBeInstanceOf(TripwireError);
    expect(calls).toEqual([]);
  });
});
