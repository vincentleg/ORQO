import type { SupabaseClient } from "@supabase/supabase-js";

/** A Supabase client acting as a specific signed-in user; every query it makes is subject to RLS. */
export type Db = SupabaseClient;
