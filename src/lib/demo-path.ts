/** The browser-local hackathon demo lives under this prefix, isolated from the production app. */
export const DEMO_BASE = "/demo";

/** Maps an in-demo path ("/", "/network?x=1") to its URL under the demo prefix. */
export function demoHref(path: string): string {
  return path === "/" ? DEMO_BASE : `${DEMO_BASE}${path}`;
}

/** Inverse of `demoHref` for pathnames; returns "/" for the demo root. */
export function demoPathOf(pathname: string): string {
  if (pathname === DEMO_BASE) return "/";
  return pathname.startsWith(`${DEMO_BASE}/`) ? pathname.slice(DEMO_BASE.length) : pathname;
}
