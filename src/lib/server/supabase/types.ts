/**
 * The request-scoped database handle. Recovery (Nov 2026): it is no longer a Supabase client but the
 * PostgreSQL `Db` (src/lib/server/db/client.ts), which keeps the same query surface and acts as one user, so
 * every query is still subject to RLS.
 */
export type { Db } from "@/lib/server/db/client";
