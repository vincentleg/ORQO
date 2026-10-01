import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabasePublicConfig } from "./config";
import type { Db } from "./types";
import { secureCookies } from "@/lib/server/site";

/**
 * Request-scoped client for Server Components, Server Actions and Route
 * Handlers. Acts as the signed-in user, so every query is subject to RLS.
 */
export async function createSupabaseServerClient(): Promise<Db> {
  const { url, publishableKey } = supabasePublicConfig();
  const store = await cookies();
  return createServerClient(url, publishableKey, {
    // Phase 13: session cookies are Secure on HTTPS production deployments; Supabase's other defaults are kept.
    cookieOptions: { secure: secureCookies() },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; src/proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/** Client acting with a caller-supplied access token (Authorization: Bearer). Still subject to RLS. */
export function createSupabaseTokenClient(accessToken: string): Db {
  const { url, publishableKey } = supabasePublicConfig();
  return createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
