import { getAuthContext } from "@/lib/server/auth/context";
import { publicStatus } from "@/lib/server/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const signedIn = Boolean(await getAuthContext(request).catch(() => null));
  return Response.json(publicStatus({ signedIn }), { headers: { "cache-control": "private, no-store" } });
}
