/**
 * Account and session behaviour the app relies on, against the real (test) database. Recovery (Nov 2026):
 * ORQO's own accounts on PostgreSQL replace Supabase Auth; these tests exercise the real account store,
 * session store, throttling and the database trigger that creates profiles.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { signInWithPassword, signUpWithPassword, type AuthBackend } from "@/lib/server/auth/flows";
import { authenticate, consumeRateLimit, createAccount, createSession, deleteSession, resolveSession, sha256 } from "@/lib/server/auth/accounts";
import { getProfile, listMyOrganizations } from "@/lib/server/repositories/tenancy";
import { userDb } from "@/lib/server/db/client";
import { cleanupTestData, createTestUser, sql, testEmail } from "../support/supabase";

beforeAll(cleanupTestData);
afterAll(cleanupTestData);

const backend: AuthBackend = { authenticate, createAccount, allow: consumeRateLimit };
/** A unique client key per test, so throttling from one test never affects another. */
const client = () => `test-client-${crypto.randomUUID()}`;

describe("sign in", () => {
  test("a user's session identifies them", async () => {
    const user = await createTestUser("auth-ok");
    expect((await resolveSession(user.accessToken))?.id).toBe(user.id);
  });

  test("the app's sign-in flow signs in with the right password and maps a wrong one to a message key", async () => {
    const user = await createTestUser("auth-wrong");
    expect(await signInWithPassword(backend, { email: user.email, password: user.password }, client())).toEqual({ ok: true, kind: "signed-in", userId: user.id });
    expect(await signInWithPassword(backend, { email: user.email.toUpperCase(), password: user.password }, client())).toEqual({ ok: true, kind: "signed-in", userId: user.id });
    expect(await signInWithPassword(backend, { email: user.email, password: "definitely-wrong" }, client())).toEqual({ ok: false, error: "auth.invalidCredentials" });
    expect(await signInWithPassword(backend, { email: testEmail("nobody"), password: "whatever-123" }, client())).toEqual({ ok: false, error: "auth.invalidCredentials" });
  });

  test("repeated failures for one email are throttled", async () => {
    const user = await createTestUser("auth-throttle");
    let last;
    for (let i = 0; i < 11; i++) last = await signInWithPassword(backend, { email: user.email, password: "wrong-password" }, client());
    expect(last).toEqual({ ok: false, error: "auth.rateLimited" });
    // Throttled even with the right password until the window passes.
    expect(await signInWithPassword(backend, { email: user.email, password: user.password }, client())).toEqual({ ok: false, error: "auth.rateLimited" });
  });

  test("the database stores neither the password nor the session token in clear", async () => {
    const user = await createTestUser("auth-hashes");
    const [row] = await sql`select encrypted_password from auth.users where id = ${user.id}`;
    expect(row.encrypted_password).toStartWith("scrypt$");
    expect(row.encrypted_password).not.toContain(user.password);
    const sessions = await sql`select token_hash from auth.sessions where user_id = ${user.id}`;
    expect(sessions.map((s: { token_hash: string }) => s.token_hash)).toEqual([sha256(user.accessToken)]);
  });
});

describe("sign up", () => {
  test("sign-up creates the account and its profile (database trigger) with the chosen language and name", async () => {
    const email = testEmail("auth-signup");
    const r = await signUpWithPassword(backend, { email, password: "a-long-password", displayName: "Nouvel utilisateur", locale: "fr" }, client());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await getProfile(userDb(r.userId), r.userId)).toEqual({ id: r.userId, displayName: "Nouvel utilisateur", locale: "fr" });
    // A brand-new account belongs to no workspace yet (onboarding creates it).
    expect(await listMyOrganizations(userDb(r.userId), r.userId)).toEqual([]);
  });

  test("signing up again with the same email and password signs in; another password gets a neutral refusal", async () => {
    const user = await createTestUser("auth-dup");
    expect(await signUpWithPassword(backend, { email: user.email, password: user.password, locale: "en" }, client())).toEqual({ ok: true, kind: "signed-in", userId: user.id });
    expect(await signUpWithPassword(backend, { email: user.email, password: "another-password", locale: "en" }, client())).toEqual({ ok: false, error: "auth.emailUnavailable" });
    const [{ n }] = await sql`select count(*)::int as n from auth.users where email = ${user.email}`;
    expect(n).toBe(1);
  });

  test("sign-up is refused when closed by the operator", async () => {
    expect(await signUpWithPassword(backend, { email: testEmail("auth-closed"), password: "a-long-password", locale: "en" }, client(), { ORQO_SIGNUP: "closed" })).toEqual({ ok: false, error: "auth.signUpClosed" });
  });

  test("a new auth user gets a profile carrying the sign-up language", async () => {
    const user = await createTestUser("auth-profile", { locale: "fr" });
    expect(await getProfile(user.db, user.id)).toEqual({ id: user.id, displayName: "Test auth-profile", locale: "fr" });
  });
});

describe("sessions", () => {
  test("signing out revokes the session token", async () => {
    const user = await createTestUser("auth-signout");
    expect(await resolveSession(user.accessToken)).not.toBeNull();
    await deleteSession(user.accessToken);
    expect(await resolveSession(user.accessToken)).toBeNull();
  });

  test("an expired session is refused; malformed tokens are refused without a query", async () => {
    const user = await createTestUser("auth-expired");
    const { token } = await createSession(user.id);
    await sql`update auth.sessions set expires_at = now() - interval '1 second' where token_hash = ${sha256(token)}`;
    expect(await resolveSession(token)).toBeNull();
    for (const bad of ["", "short", "x".repeat(43) + "!", `${user.accessToken}a`]) expect(await resolveSession(bad)).toBeNull();
  });

  test("the application roles cannot read accounts or sessions", async () => {
    const user = await createTestUser("auth-private");
    for (const table of ["users", "sessions", "rate_limits"]) {
      const denied = await sql.begin(async (tx) => {
        await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claim.sub', ${user.id}, true)`;
        return tx.unsafe(`select * from auth.${table} limit 1`).then(
          () => "allowed",
          (e: { errno?: string; code?: string }) => e.errno ?? e.code ?? "error",
        );
      });
      expect(denied).toBe("42501");
    }
  });
});
