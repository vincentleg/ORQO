/**
 * Regression tests for the database-side ownership guard (Phase 5 incident).
 * Only NEW synthetic fixtures are used. "Real-like" organizations are created
 * inside transactions that are always rolled back, so nothing outside this
 * run is ever touched and nothing real is ever deleted.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { DEFAULT_TEST_PREVIEW_ORG, TEST_ORG_NAME_PREFIX, UnsafeTestEnvironmentError } from "../support/safety";
import { cleanupTestData, createSyntheticPreviewOrg, createTestUser, currentRunTestUserIds, deleteOrganizationIfTestOwned, sql, TEST_RUN, type TestUser } from "../support/supabase";

class Rollback extends Error {}
/** Runs fn in a transaction that is ALWAYS rolled back. */
async function inRolledBackTx(fn: (tx: Bun.SQL) => Promise<void>): Promise<void> {
  await sql.begin(async (tx) => {
    await fn(tx as unknown as Bun.SQL);
    throw new Rollback();
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}
const exists = async (exec: Bun.SQL, id: string) => (await exec`select count(*)::int n from public.organizations where id = ${id}`)[0].n === 1;

let T: TestUser;
beforeAll(async () => {
  await cleanupTestData();
  T = await createTestUser("safety");
});
afterAll(cleanupTestData);

describe("deleteOrganizationIfTestOwned", () => {
  test("a real / non-test organization is never deleted (no test creator), even with a test-looking name", async () => {
    await inRolledBackTx(async (tx) => {
      const id = crypto.randomUUID();
      await tx`insert into public.organizations (id, name, created_by) values (${id}, 'Real Customer Workspace', null)`;
      await expect(deleteOrganizationIfTestOwned(tx, id, { realPreview: new Set() })).rejects.toBeInstanceOf(UnsafeTestEnvironmentError);
      expect(await exists(tx, id)).toBe(true);
      const marked = crypto.randomUUID();
      await tx`insert into public.organizations (id, name, created_by) values (${marked}, ${`${TEST_ORG_NAME_PREFIX}${TEST_RUN}] forged`}, null)`;
      await expect(deleteOrganizationIfTestOwned(tx, marked, { requireMarker: true, realPreview: new Set() })).rejects.toBeInstanceOf(UnsafeTestEnvironmentError);
      expect(await exists(tx, marked)).toBe(true);
    });
  });

  test("a test-created organization with a member outside this run is not deleted", async () => {
    await inRolledBackTx(async (tx) => {
      const id = crypto.randomUUID();
      await tx`insert into public.organizations (id, name, created_by) values (${id}, 'Shared', ${T.id})`;
      // A membership whose user is not one of this run's test users (orphan stand-in for a real person).
      await tx`set local session_replication_role = replica`;
      await tx`insert into public.organization_memberships (organization_id, user_id, role) values (${id}, ${crypto.randomUUID()}, 'member')`;
      await tx`set local session_replication_role = origin`;
      await expect(deleteOrganizationIfTestOwned(tx, id, { realPreview: new Set() })).rejects.toBeInstanceOf(UnsafeTestEnvironmentError);
      expect(await exists(tx, id)).toBe(true);
      // The shared cleanup aborts as a whole, deleting nothing.
      await expect(cleanupTestData(tx)).rejects.toBeInstanceOf(UnsafeTestEnvironmentError);
      expect(await exists(tx, id)).toBe(true);
    });
  });

  test("a preview-authorized organization is never a cleanup target, even when test-created", async () => {
    await inRolledBackTx(async (tx) => {
      const id = crypto.randomUUID();
      await tx`insert into public.organizations (id, name, created_by) values (${id}, ${`${TEST_ORG_NAME_PREFIX}${TEST_RUN}] preview`}, ${T.id})`;
      await expect(deleteOrganizationIfTestOwned(tx, id, { realPreview: new Set([id]) })).rejects.toThrow(/real preview/);
      expect(await exists(tx, id)).toBe(true);
    });
  });

  test("missing or invalid ownership aborts safely; an absent id is a no-op", async () => {
    await expect(deleteOrganizationIfTestOwned(sql, "not-a-uuid")).rejects.toBeInstanceOf(UnsafeTestEnvironmentError);
    expect(await deleteOrganizationIfTestOwned(sql, crypto.randomUUID(), { realPreview: new Set() })).toBe("absent");
  });

  test("a synthetic organization created by this run is cleaned up", async () => {
    const id = await createSyntheticPreviewOrg(T, "Safety");
    expect(id).toBe(DEFAULT_TEST_PREVIEW_ORG);
    expect(await deleteOrganizationIfTestOwned(sql, id, { requireMarker: true })).toBe("deleted");
    expect(await exists(sql, id)).toBe(false);
  });
});

describe("cleanupTestData", () => {
  test("removes only this run's organizations and users", async () => {
    const org = await createOrganization(T.db, { name: "Safety cleanup" });
    expect(await currentRunTestUserIds()).toContain(T.id);
    await cleanupTestData();
    expect(await exists(sql, org)).toBe(false);
    expect(await currentRunTestUserIds()).toEqual([]);
    // Recreate the user so afterAll has nothing unexpected to do.
    T = await createTestUser("safety-2");
  });
});
