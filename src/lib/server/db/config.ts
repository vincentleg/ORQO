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
  return url;
}
