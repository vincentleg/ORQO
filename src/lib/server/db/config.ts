/**
 * Recovery (Nov 2026): database configuration. ORQO runs on any PostgreSQL 15+ (Neon in production) through
 * DATABASE_URL, a server-only secret. It is never sent to the browser and never logged.
 */
import "server-only";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("The database is not configured: set DATABASE_URL.");
  }
}

export function databaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new DatabaseNotConfiguredError();
  if (!/^postgres(ql)?:\/\//.test(url)) throw new DatabaseNotConfiguredError();
  return withVerifiedTls(url);
}

/**
 * TLS with full certificate verification. node-postgres currently treats sslmode=require/prefer/verify-ca as
 * verify-full and warns that this will change; ask for verify-full explicitly so the guarantee cannot silently
 * weaken (and the warning does not pollute error logs). Local connections without TLS are left as they are.
 */
export function withVerifiedTls(url: string): string {
  return url.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, "$1verify-full");
}
