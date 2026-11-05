import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Former Supabase email-confirmation landing. Recovery (Nov 2026): accounts are managed by ORQO itself and no
 * confirmation email is sent, so any old link simply leads to sign-in.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin));
}
