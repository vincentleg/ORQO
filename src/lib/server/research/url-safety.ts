/**
 * SSRF protection for server-side fetching. A URL is fetched only when:
 * - the scheme is http(s), with no credentials and a default port;
 * - the host is a public DNS name (no IP literals, localhost, internal or
 *   special-use names);
 * - every address it resolves to is a public unicast address (no loopback,
 *   private, link-local/cloud-metadata, CGNAT, multicast or reserved ranges).
 * Each redirect hop is re-validated by the fetcher.
 *
 * Residual risk (documented): the check resolves DNS before the request, and
 * the HTTP client resolves again, so a hostile DNS server could rebind between
 * the two. Mitigated by re-checking every hop and by never exposing responses
 * other than parsed page text; a pinned-address transport is future work.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export class UnsafeUrlError extends Error {}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa", ".arpa", ".test", ".invalid", ".onion"];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPublicV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return !V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPublicV6(ip: string): boolean {
  const a = ip.toLowerCase().split("%")[0];
  if (a === "::" || a === "::1") return false;
  // IPv4-mapped / translated forms: judge the embedded IPv4 address.
  const mapped = a.match(/^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicV4(mapped[1]);
  if (/^::ffff:/.test(a) || /^64:ff9b:/.test(a)) return false;
  const first = parseInt(a.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (a.startsWith("2001:db8") || a.startsWith("2001:0db8")) return false; // documentation
  if (a.startsWith("100::")) return false; // discard
  return (first & 0xe000) === 0x2000; // only global unicast 2000::/3
}

export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPublicV4(ip);
  if (v === 6) return isPublicV6(ip);
  return false;
}

/** Validates a URL's shape (no DNS). Returns the parsed URL. */
export function assertSafeUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError("Non-default ports are not allowed.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || isIP(host)) throw new UnsafeUrlError("IP addresses are not allowed.");
  if (!host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new UnsafeUrlError("Internal host names are not allowed.");
  if (!/^[a-z0-9.-]+$/.test(host)) throw new UnsafeUrlError("Invalid host name.");
  return url;
}

/** Full check: shape plus DNS resolution to public addresses only. */
export async function assertSafeUrl(raw: string, resolve: Resolver = systemResolver): Promise<URL> {
  const url = assertSafeUrlShape(raw);
  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new UnsafeUrlError("Host does not resolve.");
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new UnsafeUrlError("Host resolves to a non-public address.");
  return url;
}
