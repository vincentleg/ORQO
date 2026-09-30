/**
 * Real-Supabase helpers for integration tests. Users are created pre-confirmed
 * through the Auth admin API (no email is sent), signed in with the
 * publishable key exactly like the app, and deleted afterwards. The secret key
 * is used only here, for the Auth admin API, never by application code.
 * Privileged row setup/verification goes through the direct Postgres
 * connection: the service role is deliberately granted nothing on tenant
 * tables, so the Data API stays closed even to the secret key.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadTestEnv } from "./env";

const env = loadTestEnv();
const EMAIL_PREFIX = "orqo-p1-test-";
const EMAIL_DOMAIN = "example.com";
const run = crypto.randomUUID().slice(0, 8);

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Auth admin API client (create/confirm/delete test users). */
export const admin: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, clientOptions);

/** Direct database connection as the table owner (bypasses RLS). Setup and verification only. */
export const sql = new Bun.SQL(env.SUPABASE_DB_URL, { max: 2, connectionTimeout: 15 });

/** Postgres array literal for uuid parameters (Bun.SQL does not serialise JS arrays). */
export function uuidArray(ids: string[]): string {
  if (!ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw new Error("not a uuid list");
  return `{${ids.join(",")}}`;
}

/** Unauthenticated client with the publishable key (the anon role). */
export function anonClient(): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, clientOptions);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** Signed-in client: every query runs as this user under RLS. */
  db: SupabaseClient;
  accessToken: string;
}

export function testEmail(label: string): string {
  return `${EMAIL_PREFIX}${run}-${label}@${EMAIL_DOMAIN}`;
}

export async function createTestUser(label: string, opts: { confirmed?: boolean; locale?: "en" | "fr" } = {}): Promise<TestUser> {
  const email = testEmail(label);
  const password = `pw-${crypto.randomUUID()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: opts.confirmed ?? true,
    user_metadata: { display_name: `Test ${label}`, locale: opts.locale ?? "en" },
  });
  if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.code ?? "unknown"}`);
  const db = anonClient();
  if (opts.confirmed === false) return { id: created.data.user.id, email, password, db, accessToken: "" };
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error(`signIn failed: ${signedIn.error?.code ?? "unknown"}`);
  return { id: created.data.user.id, email, password, db, accessToken: signedIn.data.session.access_token };
}

/** Deletes organizations created by this suite's test users, then the users (sweeps earlier interrupted runs too). */
export async function cleanupTestData(): Promise<void> {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.code ?? "unknown"}`);
    ids.push(...data.users.filter((u) => u.email?.startsWith(EMAIL_PREFIX) && u.email.endsWith(`@${EMAIL_DOMAIN}`)).map((u) => u.id));
    if (data.users.length < 200) break;
  }
  if (ids.length === 0) return;
  await sql`delete from public.organizations where created_by = any(${uuidArray(ids)}::uuid[])`;
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser failed: ${error.code ?? "unknown"}`);
  }
}

/** Adds an existing user to an organization with a role (owner connection: stands in for the future invitation flow). */
export async function addMember(organizationId: string, userId: string, role: "owner" | "admin" | "member" | "viewer"): Promise<void> {
  await sql`insert into public.organization_memberships (organization_id, user_id, role) values (${organizationId}, ${userId}, ${role}::public.org_role)`;
}
