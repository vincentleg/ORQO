import "server-only";
/**
 * Recovery (Nov 2026): accounts, sessions and throttling on ORQO's own PostgreSQL, replacing Supabase Auth.
 *
 * - Accounts live in auth.users (created by the compatibility migration). The existing trigger
 *   private.handle_new_user creates the profile from raw_user_meta_data, exactly as with Supabase.
 * - Sessions are opaque 256-bit random tokens. The browser keeps the token in an httpOnly cookie; the database
 *   keeps only its SHA-256, so a database read cannot be turned into a session.
 * - Throttling counts attempts per hashed key and fixed window (no raw IP or email stored).
 *
 * These tables are not readable by the application roles (anon / authenticated): this module uses the owner
 * connection, and it is the ONLY module that does so. It never touches tenant data.
 */
import { createHash, randomBytes } from "node:crypto";
import { pool } from "@/lib/server/db/client";
import { dummyHash, hashPassword, verifyPassword } from "./password";

export { SESSION_COOKIE } from "./session-cookie";
export const SESSION_TTL_DAYS = 30;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SessionUser {
  id: string;
  email: string;
}

export async function findUserByEmail(email: string): Promise<{ id: string; passwordHash: string } | null> {
  const { rows } = await pool().query<{ id: string; encrypted_password: string }>("select id, encrypted_password from auth.users where email = $1", [normalizeEmail(email)]);
  return rows[0] ? { id: rows[0].id, passwordHash: rows[0].encrypted_password } : null;
}

/** Verifies credentials. Unknown emails cost the same time as a wrong password. */
export async function authenticate(email: string, password: string): Promise<string | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    await verifyPassword(password, await dummyHash());
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  await pool().query("update auth.users set last_sign_in_at = now(), updated_at = now() where id = $1", [user.id]);
  return user.id;
}

/** Creates an account; `null` when the email is already registered. */
export async function createAccount(input: { email: string; password: string; displayName?: string; locale: string }): Promise<string | null> {
  const hash = await hashPassword(input.password);
  const meta = { locale: input.locale, ...(input.displayName && { display_name: input.displayName }) };
  const { rows } = await pool().query<{ id: string }>(
    "insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3::jsonb) on conflict (email) do nothing returning id",
    [normalizeEmail(input.email), hash, JSON.stringify(meta)],
  );
  return rows[0]?.id ?? null;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await pool().query("insert into auth.sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [sha256(token), userId, expiresAt]);
  // Housekeeping, bounded: this user's expired sessions.
  await pool().query("delete from auth.sessions where user_id = $1 and expires_at < now()", [userId]).catch(() => undefined);
  return { token, expiresAt };
}

/** The user of a session token, or null (unknown, expired or malformed). */
export async function resolveSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || !TOKEN.test(token)) return null;
  const { rows } = await pool().query<{ id: string; email: string }>(
    "select u.id, u.email from auth.sessions s join auth.users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()",
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(token: string | undefined | null): Promise<void> {
  if (!token || !TOKEN.test(token)) return;
  await pool().query("delete from auth.sessions where token_hash = $1", [sha256(token)]);
}

/**
 * Counts one attempt for (bucket, key) in the current fixed window. Returns false when the limit is exceeded.
 * Keys are hashed before storage.
 */
export async function consumeRateLimit(bucket: string, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await pool().query<{ attempts: number }>(
    `insert into auth.rate_limits (bucket, key_hash, window_start, attempts)
     values ($1, $2, to_timestamp(floor(extract(epoch from now()) / $3) * $3), 1)
     on conflict (bucket, key_hash, window_start) do update set attempts = auth.rate_limits.attempts + 1
     returning attempts`,
    [bucket, sha256(key), windowSeconds],
  );
  if (Math.random() < 0.02) await pool().query("delete from auth.rate_limits where window_start < now() - interval '2 days'").catch(() => undefined);
  return (rows[0]?.attempts ?? 0) <= limit;
}
