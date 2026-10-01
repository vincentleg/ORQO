/**
 * Real-Supabase helpers for integration tests. Users are created pre-confirmed
 * through the Auth admin API (no email is sent), signed in with the
 * publishable key exactly like the app, and deleted afterwards. The secret key
 * is used only here, for the Auth admin API, never by application code.
 * Privileged row setup/verification goes through the direct Postgres
 * connection: the service role is deliberately granted nothing on tenant
 * tables, so the Data API stays closed even to the secret key.
 *
 * SAFETY (after the Phase 5 incident): importing this module refuses to run
 * unless destructive tests are explicitly authorized for exactly this
 * Supabase project (see safety.ts). Every delete proves ownership in the
 * database first: only organizations created by THIS run's test users, with
 * no member outside them, and never a real preview organization.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadTestEnv } from "./env";
import { assertDestructiveTestsAllowed, assertNotProtectedProject, assertSyntheticTestOrgId, protectedProjectRefs, DEFAULT_TEST_PREVIEW_ORG, realPreviewOrgIds, TEST_ORG_NAME_PREFIX, UnsafeTestEnvironmentError } from "./safety";

const env = loadTestEnv();
assertDestructiveTestsAllowed(process.env);
// Phase 13: never the development project (real data) nor production, whatever the guard variable says.
assertNotProtectedProject(process.env, protectedProjectRefs());
const EMAIL_PREFIX = "orqo-p1-test-";
const EMAIL_DOMAIN = "example.com";
const run = crypto.randomUUID().slice(0, 8);
/** This process's test run id: every user it creates carries it in the email and in admin-only app_metadata. */
export const TEST_RUN = run;
/** SQL LIKE pattern matching only this run's test users (hex run id, no LIKE wildcards inside). */
const RUN_EMAIL_LIKE = `${EMAIL_PREFIX}${run}-%@${EMAIL_DOMAIN}`;

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
    // Admin-only marker: a signed-up user can never set app_metadata.
    app_metadata: { orqo_test_run: run },
  });
  if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.code ?? "unknown"}`);
  const db = anonClient();
  if (opts.confirmed === false) return { id: created.data.user.id, email, password, db, accessToken: "" };
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error(`signIn failed: ${signedIn.error?.code ?? "unknown"}`);
  return { id: created.data.user.id, email, password, db, accessToken: signedIn.data.session.access_token };
}

/** Deletes organizations created by this suite's test users, then the users (sweeps earlier interrupted runs too). */
/** Ids of THIS run's test users, proven in the database (auth.users email carries the unpredictable run id). */
export async function currentRunTestUserIds(exec: Bun.SQL = sql): Promise<string[]> {
  const rows = await exec`select id::text from auth.users where email like ${RUN_EMAIL_LIKE} and coalesce(raw_app_meta_data->>'orqo_test_run', ${run}) = ${run}`;
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Removes ONLY what this run created: organizations created by this run's
 * test users (and their cascaded rows), then those users. Aborts without
 * deleting anything if such an organization is a real preview organization
 * or has a member who is not one of this run's test users.
 */
export async function cleanupTestData(exec: Bun.SQL = sql): Promise<void> {
  const ids = await currentRunTestUserIds(exec);
  if (ids.length === 0) return;
  const users = uuidArray(ids);
  const preview = uuidArray([...realPreviewOrgIds()]);
  const unsafe = await exec`
    select o.id from public.organizations o
    where o.created_by = any(${users}::uuid[])
      and (o.id = any(${preview}::uuid[])
           or exists (select 1 from public.organization_memberships m where m.organization_id = o.id and not (m.user_id = any(${users}::uuid[]))))`;
  if (unsafe.length > 0) throw new UnsafeTestEnvironmentError(`Cleanup aborted: ${unsafe.length} test-created organization(s) are preview-configured or have non-test members. Nothing was deleted.`);
  await exec`
    delete from public.organizations o
    where o.created_by = any(${users}::uuid[])
      and not (o.id = any(${preview}::uuid[]))
      and not exists (select 1 from public.organization_memberships m where m.organization_id = o.id and not (m.user_id = any(${users}::uuid[])))`;
  if (exec !== sql) return;
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser failed: ${error.code ?? "unknown"}`);
  }
}

/**
 * Deletes one organization only if the database proves this run owns it:
 * created by one of this run's test users, no member outside them, not a real
 * preview organization, and (when required) named with the test marker.
 * Missing → "absent". Anything unproven → throws, nothing deleted.
 */
export async function deleteOrganizationIfTestOwned(exec: Bun.SQL, organizationId: string, opts: { requireMarker?: boolean; realPreview?: ReadonlySet<string> } = {}): Promise<"absent" | "deleted"> {
  const id = organizationId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new UnsafeTestEnvironmentError("Refusing: not an organization id.");
  if ((opts.realPreview ?? realPreviewOrgIds()).has(id)) throw new UnsafeTestEnvironmentError("Refusing: real preview organization.");
  const rows = await exec`
    select o.name,
           exists (select 1 from auth.users u where u.id = o.created_by and u.email like ${RUN_EMAIL_LIKE}) as owned,
           exists (select 1 from public.organization_memberships m left join auth.users u on u.id = m.user_id
                   where m.organization_id = o.id and (u.email is null or u.email not like ${RUN_EMAIL_LIKE})) as foreign_member
    from public.organizations o where o.id = ${id}`;
  if (rows.length === 0) return "absent";
  const r = rows[0] as { name: string; owned: boolean; foreign_member: boolean };
  if (!r.owned || r.foreign_member || (opts.requireMarker && !r.name.startsWith(TEST_ORG_NAME_PREFIX))) throw new UnsafeTestEnvironmentError("Refusing: test ownership of this organization is not proven. Nothing was deleted.");
  const deleted = await exec`
    delete from public.organizations o
    where o.id = ${id}
      and exists (select 1 from auth.users u where u.id = o.created_by and u.email like ${RUN_EMAIL_LIKE})
      and not exists (select 1 from public.organization_memberships m left join auth.users u on u.id = m.user_id
                      where m.organization_id = o.id and (u.email is null or u.email not like ${RUN_EMAIL_LIKE}))
    returning o.id`;
  if (deleted.length !== 1) throw new UnsafeTestEnvironmentError("Refusing: ownership changed during the check. Nothing was deleted.");
  return "deleted";
}

/**
 * The synthetic organization a suite uses as the server's preview org (the
 * test server is started with ORQO_AGENT_PREVIEW_ORGS=<this id>). The id comes
 * from TEST_PREVIEW_ORG (reserved 7e570000- namespace) and can never be a real
 * preview organization. A leftover is removed only if this run proves it owns
 * it; anything else aborts.
 */
export function testPreviewOrgId(): string {
  return assertSyntheticTestOrgId(process.env.TEST_PREVIEW_ORG ?? DEFAULT_TEST_PREVIEW_ORG, realPreviewOrgIds());
}

export async function createSyntheticPreviewOrg(owner: TestUser, label: string): Promise<string> {
  const id = testPreviewOrgId();
  await deleteOrganizationIfTestOwned(sql, id, { requireMarker: true });
  await sql`insert into public.organizations (id, name, created_by) values (${id}, ${`${TEST_ORG_NAME_PREFIX}${run}] ${label}`.slice(0, 120)}, ${owner.id})`;
  await addMember(id, owner.id, "owner");
  return id;
}

/** Adds an existing user to an organization with a role (owner connection: stands in for the future invitation flow). */
export async function addMember(organizationId: string, userId: string, role: "owner" | "admin" | "member" | "viewer"): Promise<void> {
  await sql`insert into public.organization_memberships (organization_id, user_id, role) values (${organizationId}, ${userId}, ${role}::public.org_role)`;
}
