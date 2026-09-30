import { z } from "zod";

/**
 * Public Supabase settings. The publishable key is designed to be public and is
 * safe with RLS. The secret key (SUPABASE_SECRET_KEY) is deliberately NOT read
 * by the application: nothing at runtime needs to bypass RLS. Only the test
 * suite and operator scripts use it.
 */
const PublicConfig = z.object({
  url: z.url().transform((u) => u.replace(/\/+$/, "")),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/),
});

export type SupabasePublicConfig = z.infer<typeof PublicConfig>;

export class SupabaseNotConfiguredError extends Error {}

export function supabasePublicConfig(): SupabasePublicConfig {
  const parsed = PublicConfig.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!parsed.success) {
    throw new SupabaseNotConfiguredError("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  return parsed.data;
}
