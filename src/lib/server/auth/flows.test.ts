import { describe, expect, test } from "bun:test";
import { safeNextPath, signInWithPassword, signUpPolicy, signUpWithPassword, type AuthBackend } from "./flows";

/** In-memory account store with an attempt counter (the real one is tested against PostgreSQL in tests/db/auth.test.ts). */
function fakeBackend(opts: { users?: Record<string, { id: string; password: string }>; deny?: string[] } = {}) {
  const users = { ...(opts.users ?? {}) };
  const calls: { op: string; args: unknown[] }[] = [];
  const backend: AuthBackend = {
    authenticate: async (email, password) => {
      calls.push({ op: "authenticate", args: [email] });
      const u = users[email];
      return u && u.password === password ? u.id : null;
    },
    createAccount: async (input) => {
      calls.push({ op: "createAccount", args: [input] });
      if (users[input.email]) return null;
      users[input.email] = { id: `id-${input.email}`, password: input.password };
      return users[input.email].id;
    },
    allow: async (bucket) => {
      calls.push({ op: "allow", args: [bucket] });
      return !(opts.deny ?? []).includes(bucket);
    },
  };
  return { backend, calls };
}

describe("sign in", () => {
  test("valid credentials sign the user in (email is case-insensitive)", async () => {
    const { backend } = fakeBackend({ users: { "a@example.com": { id: "u1", password: "pw" } } });
    expect(await signInWithPassword(backend, { email: "a@example.com", password: "pw" }, "c")).toEqual({ ok: true, kind: "signed-in", userId: "u1" });
    expect(await signInWithPassword(backend, { email: "A@Example.com", password: "pw" }, "c")).toEqual({ ok: true, kind: "signed-in", userId: "u1" });
  });

  test("a wrong password or unknown email is one message key", async () => {
    const { backend } = fakeBackend({ users: { "a@example.com": { id: "u1", password: "pw" } } });
    expect(await signInWithPassword(backend, { email: "a@example.com", password: "nope" }, "c")).toEqual({ ok: false, error: "auth.invalidCredentials" });
    expect(await signInWithPassword(backend, { email: "b@example.com", password: "pw" }, "c")).toEqual({ ok: false, error: "auth.invalidCredentials" });
  });

  test("throttled clients or emails are refused before the password is checked", async () => {
    for (const bucket of ["sign_in_client", "sign_in_email"]) {
      const { backend, calls } = fakeBackend({ users: { "a@example.com": { id: "u1", password: "pw" } }, deny: [bucket] });
      expect(await signInWithPassword(backend, { email: "a@example.com", password: "pw" }, "c")).toEqual({ ok: false, error: "auth.rateLimited" });
      expect(calls.some((c) => c.op === "authenticate")).toBe(false);
    }
  });

  test("malformed input never reaches the backend", async () => {
    const { backend, calls } = fakeBackend();
    expect(await signInWithPassword(backend, { email: "not-an-email", password: "pw" }, "c")).toEqual({ ok: false, error: "auth.invalidInput" });
    expect(calls).toHaveLength(0);
  });
});

describe("sign up", () => {
  test("creates the account with locale and name, and signs in", async () => {
    const { backend, calls } = fakeBackend();
    const r = await signUpWithPassword(backend, { email: "B@example.com", password: "long-enough", displayName: "Bea", locale: "fr" }, "c", {});
    expect(r).toEqual({ ok: true, kind: "signed-in", userId: "id-b@example.com" });
    expect(calls.find((c) => c.op === "createAccount")?.args).toEqual([{ email: "b@example.com", password: "long-enough", displayName: "Bea", locale: "fr" }]);
  });

  test("short passwords and unsupported locales are rejected before calling the backend", async () => {
    const { backend, calls } = fakeBackend();
    expect(await signUpWithPassword(backend, { email: "b@example.com", password: "short", locale: "en" }, "c", {})).toEqual({ ok: false, error: "auth.invalidInput" });
    expect(await signUpWithPassword(backend, { email: "b@example.com", password: "long-enough", locale: "de" }, "c", {})).toEqual({ ok: false, error: "auth.invalidInput" });
    expect(calls).toHaveLength(0);
  });

  test("an existing email: same password signs in, another gets a neutral refusal", async () => {
    const { backend } = fakeBackend({ users: { "b@example.com": { id: "u2", password: "long-enough" } } });
    expect(await signUpWithPassword(backend, { email: "b@example.com", password: "long-enough", locale: "en" }, "c", {})).toEqual({ ok: true, kind: "signed-in", userId: "u2" });
    expect(await signUpWithPassword(backend, { email: "b@example.com", password: "different-1", locale: "en" }, "c", {})).toEqual({ ok: false, error: "auth.emailUnavailable" });
  });

  test("closed sign-up, per-client and global daily caps refuse new accounts", async () => {
    const input = { email: "c@example.com", password: "long-enough", locale: "en" };
    expect(await signUpWithPassword(fakeBackend().backend, input, "c", { ORQO_SIGNUP: "closed" })).toEqual({ ok: false, error: "auth.signUpClosed" });
    for (const bucket of ["sign_up_client", "sign_up_global"]) {
      const { backend, calls } = fakeBackend({ deny: [bucket] });
      expect(await signUpWithPassword(backend, input, "c", {})).toEqual({ ok: false, error: "auth.rateLimited" });
      expect(calls.some((c) => c.op === "createAccount")).toBe(false);
    }
    expect(signUpPolicy({ ORQO_SIGNUP_DAILY_CAP: "7" })).toEqual({ open: true, dailyCap: 7 });
    expect(signUpPolicy({ ORQO_SIGNUP_DAILY_CAP: "nonsense" })).toEqual({ open: true, dailyCap: 50 });
  });
});

describe("redirect targets", () => {
  test("only same-site relative paths are accepted", () => {
    expect(safeNextPath("/workspace?x=1")).toBe("/workspace?x=1");
    expect(safeNextPath("//evil.example")).toBe("/workspace");
    expect(safeNextPath("https://evil.example")).toBe("/workspace");
    expect(safeNextPath("/\\evil.example")).toBe("/workspace");
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
  });

  test("Phase 12: control characters and whitespace cannot smuggle a protocol-relative redirect", () => {
    // URL parsers strip TAB/CR/LF: "/\t/evil.example" would resolve to https://evil.example/.
    for (const evil of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\t\t/evil.example", "/ /evil.example", "/\u0000/evil.example", "/\u00a0/evil.example", "/\u2028/evil.example", "/\ufeff/evil.example", "/%09/evil.example".replace("%09", "\t")]) {
      expect(safeNextPath(evil)).toBe("/workspace");
    }
    expect(safeNextPath(`/${"a".repeat(3000)}`)).toBe("/workspace");
    // Percent-encoded sequences stay a same-site path (they are not decoded into a host).
    expect(new URL(safeNextPath("/%2F%2Fevil.example"), "https://app.example").host).toBe("app.example");
    // Legitimate paths with queries and fragments still pass.
    expect(safeNextPath("/workspace/network/0a000000-0000-4000-8000-00000000000a?view=graph#x")).toBe("/workspace/network/0a000000-0000-4000-8000-00000000000a?view=graph#x");
  });
});
