/** Organization roles for pure policy code (mirrors src/lib/server/tenancy/roles.ts and the `org_role` enum). */
export const ROLES = ["viewer", "member", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export function roleAtLeastPure(role: Role, min: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(min);
}
