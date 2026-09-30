/**
 * Supabase Auth behaviour the app relies on, against the real development
 * project. No confirmation emails are sent: users are created through the
 * admin API, and the confirmation link is generated, not mailed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { signInWithPassword } from "@/lib/server/auth/flows";
import { getProfile } from "@/lib/server/repositories/tenancy";
import { admin, anonClient, cleanupTestData, createTestUser, testEmail } from "../support/supabase";

beforeAll(cleanupTestData);
afterAll(cleanupTestData);

describe("sign in", () => {
  test("a confirmed user signs in and the session identifies them", async () => {
    const user = await createTestUser("auth-ok");
    const { data } = await user.db.auth.getUser(user.accessToken);
    expect(data.user?.id).toBe(user.id);
  });

  test("the app's sign-in flow maps a wrong password to a message key", async () => {
    const user = await createTestUser("auth-wrong");
    expect(await signInWithPassword(anonClient().auth, { email: user.email, password: "definitely-wrong" })).toEqual({ ok: false, error: "auth.invalidCredentials" });
  });

  test("with Confirm Email on, an unconfirmed user cannot sign in", async () => {
    const user = await createTestUser("auth-unconfirmed", { confirmed: false });
    expect(await signInWithPassword(anonClient().auth, { email: user.email, password: user.password })).toEqual({ ok: false, error: "auth.emailNotConfirmed" });
  });
});

describe("sign up confirmation", () => {
  test("a sign-up confirmation token creates a session and confirms the email", async () => {
    const email = testEmail("auth-signup");
    const link = await admin.auth.admin.generateLink({ type: "signup", email, password: `pw-${crypto.randomUUID()}`, options: { data: { locale: "fr", display_name: "Nouvel utilisateur" } } });
    expect(link.error).toBeNull();
    const client = anonClient();
    const verified = await client.auth.verifyOtp({ type: "signup", token_hash: link.data.properties?.hashed_token ?? "" });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.user.email_confirmed_at).toBeTruthy();
  });

  test("a new auth user gets a profile carrying the sign-up language", async () => {
    const user = await createTestUser("auth-profile", { locale: "fr" });
    expect(await getProfile(user.db, user.id)).toEqual({ id: user.id, displayName: "Test auth-profile", locale: "fr" });
  });
});

describe("sign out", () => {
  test("signing out revokes the refresh token", async () => {
    const user = await createTestUser("auth-signout");
    const session = (await user.db.auth.getSession()).data.session;
    expect(session).not.toBeNull();
    await user.db.auth.signOut({ scope: "local" });
    const refreshed = await anonClient().auth.refreshSession({ refresh_token: session?.refresh_token ?? "" });
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();
  });
});
