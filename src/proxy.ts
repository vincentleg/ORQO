import { NextResponse, type NextRequest } from "next/server";
import { SupabaseNotConfiguredError } from "@/lib/server/supabase/config";
import { refreshSession } from "@/lib/server/supabase/proxy";

const PROTECTED = ["/workspace", "/onboarding"];

/**
 * Refreshes the Supabase session for production routes and sends signed-out
 * visitors of protected pages to /login. This is a convenience redirect, not
 * the security boundary: pages, actions and route handlers each verify the
 * user, and RLS enforces tenancy in the database. The demo (/demo) never
 * passes through here.
 */
export async function proxy(request: NextRequest) {
  try {
    const { response, signedIn } = await refreshSession(request);
    const path = request.nextUrl.pathname;
    if (!signedIn && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(path)}`;
      return NextResponse.redirect(url);
    }
    return response;
  } catch (e) {
    // Fail open: every protected page and route re-verifies the user itself.
    if (!(e instanceof SupabaseNotConfiguredError)) console.error("[orqo] session refresh failed", e instanceof Error ? e.name : typeof e);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/", "/login", "/signup", "/onboarding/:path*", "/workspace/:path*", "/auth/:path*", "/api/:path*"],
};
