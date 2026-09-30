import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/server/auth/flows";
import { createSupabaseServerClient } from "@/lib/server/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Email-confirmation landing for Supabase's default template (PKCE): exchanges
 * the one-time `code` for a session. The code verifier cookie only exists in the
 * browser that signed up, so links opened elsewhere fall back to /login.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "/onboarding");
  if (code) {
    const db = await createSupabaseServerClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=confirm", url.origin));
}
