import "server-only";
import { cookies } from "next/headers";
import { AppError } from "@/lib/server/errors";
import { userDb } from "@/lib/server/db/client";
import { DatabaseNotConfiguredError } from "@/lib/server/db/config";
import type { Db } from "@/lib/server/supabase/types";
import { resolveSession, SESSION_COOKIE } from "./accounts";

export interface AuthContext {
  /** Acts as the user; RLS applies to every query. */
  db: Db;
  user: { id: string; email?: string };
}

/**
 * Resolves the signed-in user from the session cookie, or from an `Authorization: Bearer <session token>`
 * header for API clients. Recovery (Nov 2026): the session is verified against ORQO's own session store on
 * every call (no unverified cookie payload is trusted). A database outage surfaces as `unavailable`, never as
 * "signed out", so pages can say what is wrong.
 */
export async function getAuthContext(request?: Request): Promise<AuthContext | null> {
  try {
    const bearer = request?.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const token = bearer ?? (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const user = await resolveSession(token);
    if (!user) return null;
    return { db: userDb(user.id), user: { id: user.id, email: user.email } };
  } catch (e) {
    if (e instanceof DatabaseNotConfiguredError) throw new AppError("unavailable", "Accounts are not available on this deployment.");
    if (e instanceof AppError) throw e;
    throw new AppError("unavailable", "Accounts are temporarily unavailable.");
  }
}

export async function requireAuth(request?: Request): Promise<AuthContext> {
  const ctx = await getAuthContext(request);
  if (!ctx) throw new AppError("unauthenticated", "Sign in required.");
  return ctx;
}
