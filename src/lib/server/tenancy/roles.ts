/** Organization roles in ascending privilege; mirrors the `org_role` enum in the database. */
export const ORG_ROLES = ["viewer", "member", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ORG_ROLES.indexOf(role) >= ORG_ROLES.indexOf(min);
}
