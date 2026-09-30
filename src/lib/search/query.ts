/**
 * Parses what a user typed in Search into a target. Pure and deterministic:
 * nothing here calls a network, a model or a paid provider.
 */

export type SearchTarget = { kind: "website"; domain: string; url: string } | { kind: "name"; name: string };

export const SEARCH_QUERY_MAX = 200;

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Hostname without "www.", or null when the input is not a plausible website. */
export function websiteDomain(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  const hasScheme = /^https?:\/\//i.test(value);
  if (!hasScheme && !/^[^/]+\.[a-z]{2,63}(?:[/:?#]|$)/i.test(value)) return null;
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return DOMAIN.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function parseSearchQuery(raw: string | null | undefined): SearchTarget | null {
  const value = (raw ?? "").trim().slice(0, SEARCH_QUERY_MAX);
  if (!value) return null;
  const domain = websiteDomain(value);
  if (domain) return { kind: "website", domain, url: `https://${domain}` };
  const name = value.replace(/\s+/g, " ");
  return /[\p{L}\p{N}]/u.test(name) ? { kind: "name", name } : null;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Finds the target among companies the organization already knows (by website domain, then by name). */
export function findKnownCompany<T extends { name: string; website: string | null }>(target: SearchTarget, companies: readonly T[]): T | null {
  if (target.kind === "website") {
    return companies.find((c) => c.website !== null && websiteDomain(c.website) === target.domain) ?? null;
  }
  const wanted = normalizeName(target.name);
  return companies.find((c) => normalizeName(c.name) === wanted) ?? null;
}
