/** Small, dependency-free helpers shared by the harness: JSONL, hashing, canonical JSON, text matching. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { foldText } from "@/lib/intelligence/concepts";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Key-sorted JSON, so equal content always hashes the same. */
export function canonicalJson(v: unknown): string {
  const canon = (x: unknown): unknown => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, y]) => [k, canon(y)])) : x);
  return JSON.stringify(canon(v));
}

export function readJsonl(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`${path}:${i + 1}: invalid JSON`);
      }
    });
}

export function writeText(path: string, text: string): void {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function writeJsonl(path: string, rows: readonly unknown[]): void {
  writeText(path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export const writeJson = (path: string, v: unknown) => writeText(path, JSON.stringify(v, null, 2) + "\n");

/** ORQO's folding (case, accents, whitespace) plus hyphen/slash/underscore → space, for phrase matching. */
export const norm = (s: string) => foldText(s).replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-term match (both boundaries): for forbidden terms. */
export const containsTerm = (haystack: string, term: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(norm(term))}($|[^a-z0-9])`).test(norm(haystack));

/** Word-start match (prefix allowed: "distribut" matches "distributor"): for key terms. */
export const containsPrefix = (haystack: string, term: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(norm(term))}`).test(norm(haystack));

/** Every string value in a JSON value (for scanning an output for forbidden content). */
export function allStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(allStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(allStrings);
  return [];
}

export function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}
