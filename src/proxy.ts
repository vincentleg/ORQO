import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/auth/session-cookie";

const PROTECTED = ["/workspace", "/onboarding"];

/**
 * Sends visitors without a session cookie away from protected pages to /login. This is a convenience redirect,
 * not the security boundary: pages, actions and route handlers each verify the session against the database,
 * and RLS enforces tenancy in the database. Recovery (Nov 2026): no network call here (the old Supabase session
 * refresh made every page depend on an external service); the demo (/demo) never passes through here.
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!request.cookies.get(SESSION_COOKIE)?.value && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/onboarding/:path*", "/workspace/:path*"],
};
