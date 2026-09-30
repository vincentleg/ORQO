import { z } from "zod";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { AppError, fromDbError, parseInput } from "@/lib/server/errors";
import type { Db } from "@/lib/server/supabase/types";
import { ORG_ROLES, roleAtLeast, type OrgRole } from "@/lib/server/tenancy/roles";

const LocaleSchema = z.custom<Locale>(isLocale);
const RoleSchema = z.enum(ORG_ROLES);

const MembershipWithOrg = z.object({
  role: RoleSchema,
  organizations: z.object({ id: z.uuid(), name: z.string(), default_locale: LocaleSchema }),
});

export interface OrganizationMembership {
  organizationId: string;
  name: string;
  defaultLocale: Locale;
  role: OrgRole;
}

export const NewOrganizationInput = z.object({
  name: z.string().trim().min(1).max(120),
  defaultLocale: LocaleSchema.default("en"),
});

export async function listMyOrganizations(db: Db, userId: string): Promise<OrganizationMembership[]> {
  const { data, error } = await db
    .from("organization_memberships")
    .select("role, organizations!inner(id, name, default_locale)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw fromDbError(error);
  return z
    .array(MembershipWithOrg)
    .parse(data)
    .map((m) => ({ organizationId: m.organizations.id, name: m.organizations.name, defaultLocale: m.organizations.default_locale, role: m.role }));
}

/**
 * The caller's membership in `organizationId`, or not_found. Membership (read
 * under RLS as the caller) is the only proof of access: an organization id
 * from the browser is just a lookup key. Non-members get the same answer as
 * for a nonexistent organization.
 */
export async function requireMembership(db: Db, userId: string, organizationId: string, minRole: OrgRole = "viewer"): Promise<OrganizationMembership> {
  if (!z.uuid().safeParse(organizationId).success) throw new AppError("not_found", "Organization not found.");
  const { data, error } = await db
    .from("organization_memberships")
    .select("role, organizations!inner(id, name, default_locale)")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new AppError("not_found", "Organization not found.");
  const m = MembershipWithOrg.parse(data);
  if (!roleAtLeast(m.role, minRole)) throw new AppError("forbidden", "Your role does not allow this action.");
  return { organizationId: m.organizations.id, name: m.organizations.name, defaultLocale: m.organizations.default_locale, role: m.role };
}

export async function createOrganization(db: Db, input: z.input<typeof NewOrganizationInput>): Promise<string> {
  const { name, defaultLocale } = parseInput(NewOrganizationInput, input);
  const { data, error } = await db.rpc("create_organization", { p_name: name, p_default_locale: defaultLocale });
  if (error) throw fromDbError(error);
  return z.uuid().parse(data);
}

export async function setMemberRole(db: Db, organizationId: string, userId: string, role: OrgRole): Promise<void> {
  const { error } = await db.rpc("set_member_role", { p_organization_id: organizationId, p_user_id: userId, p_role: role });
  if (error) throw fromDbError(error, "Membership not found.");
}

const MemberRow = z.object({ user_id: z.uuid(), role: RoleSchema });
const ProfileRow = z.object({ id: z.uuid(), display_name: z.string().nullable(), locale: LocaleSchema });

export interface Member {
  userId: string;
  role: OrgRole;
  displayName: string | null;
}

export async function listMembers(db: Db, organizationId: string): Promise<Member[]> {
  const { data, error } = await db.from("organization_memberships").select("user_id, role").eq("organization_id", organizationId).order("created_at");
  if (error) throw fromDbError(error);
  const members = z.array(MemberRow).parse(data);
  if (members.length === 0) return [];
  const profiles = await db.from("profiles").select("id, display_name, locale").in("id", members.map((m) => m.user_id));
  if (profiles.error) throw fromDbError(profiles.error);
  const names = new Map(z.array(ProfileRow).parse(profiles.data).map((p) => [p.id, p.display_name]));
  return members.map((m) => ({ userId: m.user_id, role: m.role, displayName: names.get(m.user_id) ?? null }));
}

export interface Profile {
  id: string;
  displayName: string | null;
  locale: Locale;
}

export async function getProfile(db: Db, userId: string): Promise<Profile | null> {
  const { data, error } = await db.from("profiles").select("id, display_name, locale").eq("id", userId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) return null;
  const p = ProfileRow.parse(data);
  return { id: p.id, displayName: p.display_name, locale: p.locale };
}

export const ProfileUpdate = z
  .object({ displayName: z.string().trim().min(1).max(120).optional(), locale: LocaleSchema.optional() })
  .refine((v) => v.displayName !== undefined || v.locale !== undefined, "Nothing to update.");

export async function updateProfile(db: Db, userId: string, input: z.input<typeof ProfileUpdate>): Promise<Profile> {
  const patch = parseInput(ProfileUpdate, input);
  const { data, error } = await db
    .from("profiles")
    .update({ ...(patch.displayName !== undefined && { display_name: patch.displayName }), ...(patch.locale !== undefined && { locale: patch.locale }) })
    .eq("id", userId)
    .select("id, display_name, locale")
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new AppError("not_found", "Profile not found.");
  const p = ProfileRow.parse(data);
  return { id: p.id, displayName: p.display_name, locale: p.locale };
}
