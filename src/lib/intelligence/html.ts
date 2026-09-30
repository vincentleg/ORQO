/**
 * Minimal, dependency-free HTML reader for company web pages. It extracts only
 * what company analysis needs (metadata, JSON-LD, headings, links, readable
 * text) and treats every byte as untrusted data: nothing is executed or
 * rendered, and output lengths are capped.
 */

export interface PageLink {
  href: string;
  text: string;
}

export interface PageDocument {
  url: string;
  title: string;
  lang: string | null;
  meta: Record<string, string>;
  /** Parsed JSON-LD objects (flattened @graph), capped. */
  jsonLd: Record<string, unknown>[];
  headings: string[];
  links: PageLink[];
  /** Readable text, whitespace-collapsed and capped. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", copy: "©", reg: "®", trade: "™" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Control, zero-width and line/paragraph separator characters.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029\\uFEFF]", "g");

/** Removes control characters and collapses whitespace. */
export function cleanText(s: string, max = 10_000): string {
  return decodeEntities(s)
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function flattenJsonLd(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (out.length >= 20 || depth > 3 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) flattenJsonLd(v, out, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) flattenJsonLd(obj["@graph"], out, depth + 1);
  if (obj["@type"]) out.push(obj);
}

export interface ParseLimits {
  maxTextChars: number;
  maxLinks: number;
}

export function parseHtml(html: string, url: string, limits: ParseLimits = { maxTextChars: 40_000, maxLinks: 300 }): PageDocument {
  const jsonLd: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].length > 200_000) continue;
    try {
      flattenJsonLd(JSON.parse(m[1]), jsonLd);
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }

  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|object|canvas)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const title = cleanText(stripTags(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""), 300);
  const lang = attr(body.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang")?.slice(0, 20) ?? null;

  const meta: Record<string, string> = {};
  for (const m of body.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name"))?.toLowerCase();
    const content = attr(m[0], "content");
    if (key && content && /^(description|og:description|og:site_name|og:title|twitter:description|application-name)$/.test(key)) meta[key] ??= cleanText(content, 1000);
  }

  const headings: string[] = [];
  for (const m of body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const text = cleanText(stripTags(m[2]), 200);
    if (text && !headings.includes(text)) headings.push(text);
    if (headings.length >= 40) break;
  }

  const links: PageLink[] = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attr(`<a ${m[1]}>`, "href");
    if (!href) continue;
    const text = cleanText(stripTags(m[2]), 120);
    let abs: string;
    try {
      abs = new URL(href, url).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs)) continue;
    links.push({ href: abs, text });
    if (links.length >= limits.maxLinks) break;
  }

  // Readable text excludes interactive/form content (country pickers, CTAs, input labels).
  const readable = body.replace(/<head\b[\s\S]*?<\/head\s*>/i, " ").replace(/<(form|select|datalist|textarea|button|label)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const text = cleanText(stripTags(readable.replace(/<\/(p|div|li|h[1-6]|section|article|br|tr)\s*>/gi, ". ").replace(/<br\s*\/?>/gi, ". ").replace(/<\/(a|button|option)\s*>/gi, " | ")), limits.maxTextChars)
    .replace(/(\.\s*){2,}/g, ". ")
    .trim();

  return { url, title, lang, meta, jsonLd, headings, links, text };
}

/** Splits readable text into sentences of useful length. */
export function sentences(text: string, max = 400): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s[•·|]\s/)
    .map((s) => s.trim().replace(/^[.|\s]+/, ""))
    .filter((s) => s.length >= 25 && s.length <= 500 && /\p{L}{3}/u.test(s))
    .slice(0, max);
}
