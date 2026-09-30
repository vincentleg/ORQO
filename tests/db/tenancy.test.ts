import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@/lib/server/errors";
import { createCompany, listCompanies } from "@/lib/server/repositories/companies";
import { createOrganization, listMembers, listMyOrganizations, requireMembership, setMemberRole } from "@/lib/server/repositories/tenancy";
import { addMember, anonClient, cleanupTestData, createTestUser, type TestUser } from "../support/supabase";

let owner: TestUser;
let other: TestUser;
let orgId: string;

beforeAll(async () => {
  await cleanupTestData();
  owner = await createTestUser("ten-owner");
  other = await createTestUser("ten-other");
  orgId = await createOrganization(owner.db, { name: "Tenancy Test Org", defaultLocale: "fr" });
});
afterAll(cleanupTestData);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof AppError ? e.code : "unexpected";
  }
}

describe("organization creation", () => {
  test("the creator becomes owner, and the organization is visible only to its members", async () => {
    expect(await listMyOrganizations(owner.db, owner.id)).toEqual([{ organizationId: orgId, name: "Tenancy Test Org", defaultLocale: "fr", role: "owner" }]);
    expect(await listMyOrganizations(other.db, other.id)).toEqual([]);
  });

  test("creation is audited as organization.created and membership.created by the user", async () => {
    const { data } = await owner.db.from("audit_events").select("action, actor_type, actor_id, target_table").eq("organization_id", orgId).order("id");
    expect(data).toEqual([
      { action: "organization.created", actor_type: "user", actor_id: owner.id, target_table: "organizations" },
      { action: "membership.created", actor_type: "user", actor_id: owner.id, target_table: "organization_memberships" },
    ]);
  });

  test("organizations and memberships cannot be written directly, only through the RPCs", async () => {
    const org = await other.db.from("organizations").insert({ name: "Sneaky" }).select();
    expect(org.error?.code).toBe("42501");
    const joined = await other.db.from("organization_memberships").insert({ organization_id: orgId, user_id: other.id, role: "owner" }).select();
    expect(joined.error?.code).toBe("42501");
    expect(await listMyOrganizations(other.db, other.id)).toEqual([]);
  });

  test("the anonymous role can neither create nor read organizations", async () => {
    const anon = anonClient();
    expect((await anon.rpc("create_organization", { p_name: "Anon Org" })).error).not.toBeNull();
    const read = await anon.from("organizations").select("id");
    expect(read.data ?? []).toEqual([]);
  });

  test("organization names are validated", async () => {
    expect(await codeOf(createOrganization(owner.db, { name: "   " }))).toBe("invalid_input");
    expect((await owner.db.rpc("create_organization", { p_name: " " })).error?.code).toBe("23514");
  });
});

describe("membership roles", () => {
  let member: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    member = await createTestUser("ten-member");
    outsider = await createTestUser("ten-outsider");
    await addMember(orgId, member.id, "member");
  });

  test("a member cannot promote themselves", async () => {
    expect(await codeOf(setMemberRole(member.db, orgId, member.id, "owner"))).toBe("forbidden");
    expect(await codeOf(setMemberRole(member.db, orgId, member.id, "admin"))).toBe("forbidden");
    expect((await requireMembership(member.db, member.id, orgId)).role).toBe("member");
  });

  test("a member cannot change their role with a direct UPDATE either", async () => {
    const r = await member.db.from("organization_memberships").update({ role: "owner" }).eq("organization_id", orgId).eq("user_id", member.id).select();
    expect(r.error?.code).toBe("42501");
    expect((await requireMembership(member.db, member.id, orgId)).role).toBe("member");
  });

  test("an owner promotes a member to admin, and the change is audited with the previous role", async () => {
    await setMemberRole(owner.db, orgId, member.id, "admin");
    expect((await requireMembership(member.db, member.id, orgId)).role).toBe("admin");
    const { data } = await owner.db.from("audit_events").select("action, metadata").eq("organization_id", orgId).eq("action", "membership.role_changed");
    expect(data).toEqual([{ action: "membership.role_changed", metadata: { changed: ["role"], role: "admin", previous_role: "member", user_id: member.id } }]);
  });

  test("an admin cannot grant or revoke the owner role", async () => {
    expect(await codeOf(setMemberRole(member.db, orgId, member.id, "owner"))).toBe("forbidden");
    expect(await codeOf(setMemberRole(member.db, orgId, owner.id, "member"))).toBe("forbidden");
    expect((await requireMembership(owner.db, owner.id, orgId)).role).toBe("owner");
  });

  test("an owner cannot change their own role (the organization always keeps an owner)", async () => {
    expect(await codeOf(setMemberRole(owner.db, orgId, owner.id, "viewer"))).toBe("forbidden");
  });

  test("a non-member gets the same answer as an unprivileged member: no organization enumeration", async () => {
    expect(await codeOf(setMemberRole(outsider.db, orgId, member.id, "viewer"))).toBe("forbidden");
    expect(await codeOf(setMemberRole(outsider.db, crypto.randomUUID(), member.id, "viewer"))).toBe("forbidden");
    expect(await codeOf(requireMembership(outsider.db, outsider.id, orgId))).toBe("not_found");
  });

  test("a viewer can read the workspace but cannot write to it", async () => {
    await createCompany(owner.db, orgId, { name: "Visible Co" });
    await setMemberRole(owner.db, orgId, member.id, "viewer");
    expect((await listCompanies(member.db, orgId)).map((c) => c.name)).toContain("Visible Co");
    expect(await codeOf(createCompany(member.db, orgId, { name: "Viewer Co" }))).toBe("forbidden");
    expect(await codeOf(requireMembership(member.db, member.id, orgId, "member"))).toBe("forbidden");
  });

  test("audit events are visible to owners/admins only", async () => {
    const asViewer = await member.db.from("audit_events").select("id").eq("organization_id", orgId);
    expect(asViewer.data).toEqual([]);
    const asOutsider = await outsider.db.from("audit_events").select("id").eq("organization_id", orgId);
    expect(asOutsider.data).toEqual([]);
  });

  test("members see each other's display names; outsiders see no profiles of the organization", async () => {
    expect((await listMembers(owner.db, orgId)).map((m) => m.displayName).sort()).toEqual(["Test ten-member", "Test ten-owner"]);
    const { data } = await outsider.db.from("profiles").select("id").in("id", [owner.id, member.id]);
    expect(data).toEqual([]);
  });

  test("users cannot edit someone else's profile", async () => {
    const r = await outsider.db.from("profiles").update({ display_name: "Hijacked" }).eq("id", owner.id).select();
    expect(r.data).toEqual([]);
    expect((await listMembers(owner.db, orgId)).find((m) => m.userId === owner.id)?.displayName).toBe("Test ten-owner");
  });
});
