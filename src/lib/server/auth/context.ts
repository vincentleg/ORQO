import "server-only";
import { AppError } from "@/lib/server/errors";
import { SupabaseNotConfiguredError } from "@/lib/server/supabase/config";
import { createSupabaseServerClient, createSupabaseTokenClient } from "@/lib/server/supabase/server";
import type { Db } from "@/lib/server/supabase/types";

export interface AuthContext {
  /** Acts as the user; RLS applies to every query. */
  db: Db;
  user: { id: string; email?: string };
}

/**
 * Resolves the signed-in user from the session cookie, or from an
 * `Authorization: Bearer <access token>` header for API clients. Identity is
 * verified with the Supabase Auth server (`getUser`), not read from the
 * unverified cookie payload.
 */
export async function getAuthContext(request?: Request): Promise<AuthContext | null> {
  try {
    const bearer = request?.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const db = bearer ? createSupabaseTokenClient(bearer) : await createSupabaseServerClient();
    const { data, error } = await db.auth.getUser(bearer);
    if (error || !data.user) return null;
    return { db, user: { id: data.user.id, email: data.user.email } };
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) throw new AppError("unavailable", "Accounts are not available on this deployment.");
    throw e;
  }
}

export async function requireAuth(request?: Request): Promise<AuthContext> {
  const ctx = await getAuthContext(request);
  if (!ctx) throw new AppError("unauthenticated", "Sign in required.");
  return ctx;
}
