import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/server/auth/flows";
import { createSupabaseServerClient } from "@/lib/server/supabase/server";

export const dynamic = "force-dynamic";

const TYPES: readonly EmailOtpType[] = ["signup", "email", "invite", "magiclink", "recovery", "email_change"];

function isOtpType(v: string | null): v is EmailOtpType {
  return v !== null && (TYPES as readonly string[]).includes(v);
}

/**
 * Email-confirmation landing for a `token_hash` link
 * (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`). Works
 * from any browser, unlike the PKCE code flow. Needs the Supabase email
 * template to be changed to use it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeNextPath(url.searchParams.get("next"), "/onboarding");
  if (tokenHash && isOtpType(type)) {
    const db = await createSupabaseServerClient();
    const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=confirm", url.origin));
}
