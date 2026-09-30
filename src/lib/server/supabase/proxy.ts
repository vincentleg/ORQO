import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublicConfig } from "./config";

/**
 * Refreshes the Supabase session cookie before routes render (Server
 * Components cannot write cookies). Returns the response to continue with and
 * whether a user is signed in. This is a convenience gate for page redirects
 * only; every page, action and route handler re-checks auth itself.
 */
export async function refreshSession(request: NextRequest): Promise<{ response: NextResponse; signedIn: boolean }> {
  const { url, publishableKey } = supabasePublicConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  return { response, signedIn: Boolean(data?.claims?.sub) };
}
