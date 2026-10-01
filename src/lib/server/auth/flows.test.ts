import { describe, expect, test } from "bun:test";
import { safeNextPath, signInWithPassword, signUpWithPassword } from "./flows";

type SignIn = Parameters<typeof signInWithPassword>[0];
type SignUp = Parameters<typeof signUpWithPassword>[0];

function fakeSignIn(result: { user?: { id: string }; error?: { code: string; status?: number } }): SignIn {
  return {
    signInWithPassword: async () =>
      ({ data: { user: result.user ?? null, session: null }, error: result.error ?? null }) as unknown as Awaited<ReturnType<SignIn["signInWithPassword"]>>,
  };
}

function fakeSignUp(result: { user?: { id: string }; session?: object; error?: { code: string; status?: number } }, calls: unknown[] = []): SignUp {
  return {
    signUp: async (args) => {
      calls.push(args);
      return { data: { user: result.user ?? null, session: result.session ?? null }, error: result.error ?? null } as unknown as Awaited<ReturnType<SignUp["signUp"]>>;
    },
  };
}

describe("sign in", () => {
  test("valid credentials sign the user in", async () => {
    expect(await signInWithPassword(fakeSignIn({ user: { id: "u1" } }), { email: "a@example.com", password: "pw" })).toEqual({ ok: true, kind: "signed-in", userId: "u1" });
  });

  test("provider errors become message keys, not provider text", async () => {
    const r = await signInWithPassword(fakeSignIn({ error: { code: "invalid_credentials" } }), { email: "a@example.com", password: "pw" });
    expect(r).toEqual({ ok: false, error: "auth.invalidCredentials" });
    expect(await signInWithPassword(fakeSignIn({ error: { code: "email_not_confirmed" } }), { email: "a@example.com", password: "pw" })).toEqual({ ok: false, error: "auth.emailNotConfirmed" });
    expect(await signInWithPassword(fakeSignIn({ error: { code: "over_request_rate_limit", status: 429 } }), { email: "a@example.com", password: "pw" })).toEqual({ ok: false, error: "auth.rateLimited" });
  });

  test("malformed input never reaches the provider", async () => {
    expect(await signInWithPassword(fakeSignIn({ user: { id: "u1" } }), { email: "not-an-email", password: "pw" })).toEqual({ ok: false, error: "auth.invalidInput" });
  });
});

describe("sign up", () => {
  test("with email confirmation on, sign-up asks the user to check their inbox and passes locale metadata", async () => {
    const calls: unknown[] = [];
    const r = await signUpWithPassword(fakeSignUp({ user: { id: "u2" } }, calls), { email: "b@example.com", password: "long-enough", displayName: "Bea", locale: "fr" }, "http://localhost:3000/auth/callback");
    expect(r).toEqual({ ok: true, kind: "confirmation-required", email: "b@example.com" });
    expect(calls).toEqual([{ email: "b@example.com", password: "long-enough", options: { emailRedirectTo: "http://localhost:3000/auth/callback", data: { locale: "fr", display_name: "Bea" } } }]);
  });

  test("short passwords and unsupported locales are rejected before calling the provider", async () => {
    const calls: unknown[] = [];
    expect(await signUpWithPassword(fakeSignUp({}, calls), { email: "b@example.com", password: "short", locale: "en" }, "x")).toEqual({ ok: false, error: "auth.invalidInput" });
    expect(await signUpWithPassword(fakeSignUp({}, calls), { email: "b@example.com", password: "long-enough", locale: "de" }, "x")).toEqual({ ok: false, error: "auth.invalidInput" });
    expect(calls).toHaveLength(0);
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
