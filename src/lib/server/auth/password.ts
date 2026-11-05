/**
 * Recovery (Nov 2026): password hashing with scrypt (node:crypto), replacing Supabase Auth's bcrypt.
 * Format: scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>. Parameters are stored per hash so they can be raised
 * later without invalidating existing passwords. Verification is constant-time.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 1 << 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
/** 128 * N * r bytes are needed; the default maxmem (32 MiB) is exactly too small for N=2^15, r=8. */
const MAXMEM = 128 * N * R * 2;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length < 8 || expected.length < 32) return false;
  const actual = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash of a random password: used to spend the same time when an email is unknown (no account enumeration by timing). */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummy;
}
