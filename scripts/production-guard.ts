/**
 * Phase 13 Stage G: target guard for the ORQO PRODUCTION database (pure: no
 * file, no network, never returns or prints a full credential).
 *
 * The production operator tooling (scripts/production-db.ts) reads ONLY
 * `.env.orqo-production`. This guard decides whether those values identify
 * exactly one production project, distinct from every known development and
 * test project, before any connection is opened.
 */
import { projectRef } from "../tests/support/safety";

export class ProductionGuardError extends Error {}

export const PRODUCTION_REQUIRED = ["ORQO_ENVIRONMENT", "ORQO_PRODUCTION_PROJECT", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_DB_URL"] as const;

export interface ProductionTarget {
  dbUrl: string;
  /** Masked ref for display and confirmation (last 4 characters). */
  maskedRef: string;
  confirmCode: string;
}

const refsOf = (v: Record<string, string>): (string | null)[] => [projectRef(v.NEXT_PUBLIC_SUPABASE_URL ?? ""), projectRef(v.SUPABASE_DB_URL ?? ""), (v.ORQO_DESTRUCTIVE_TESTS_PROJECT ?? "").trim().toLowerCase() || null];

export function planProductionTarget(input: {
  /** Values of .env.orqo-production. */
  prod: Record<string, string>;
  /** Values of other known environments (development .env.local, test .env.test.local): refusals only. */
  others: Record<string, string>[];
}): ProductionTarget {
  const { prod } = input;
  const missing = PRODUCTION_REQUIRED.filter((k) => !prod[k]);
  if (missing.length > 0) throw new ProductionGuardError(`.env.orqo-production is missing: ${missing.join(", ")}.`);
  if (prod.ORQO_ENVIRONMENT.trim().toLowerCase() !== "production") throw new ProductionGuardError("ORQO_ENVIRONMENT must be 'production'.");
  if (prod.ORQO_DESTRUCTIVE_TESTS_PROJECT) throw new ProductionGuardError("A production file must never carry ORQO_DESTRUCTIVE_TESTS_PROJECT.");

  const declared = prod.ORQO_PRODUCTION_PROJECT.trim().toLowerCase();
  const api = projectRef(prod.NEXT_PUBLIC_SUPABASE_URL);
  const db = projectRef(prod.SUPABASE_DB_URL);
  if (!api || !db || api === "local" || db === "local") throw new ProductionGuardError("Cannot identify the Supabase project of the production URLs.");
  if (api !== db) throw new ProductionGuardError("The production API URL and database URL point to different projects.");
  if (api !== declared) throw new ProductionGuardError("The production URLs do not match ORQO_PRODUCTION_PROJECT.");

  const known = new Set(input.others.flatMap(refsOf).filter((x): x is string => Boolean(x)));
  if (known.has(api)) throw new ProductionGuardError("The production project is a known development or test project.");
  for (const o of input.others) for (const k of ["SUPABASE_DB_URL", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) if (o[k] && o[k] === prod[k]) throw new ProductionGuardError(`${k} is identical to a development or test value.`);

  const tail = api.slice(-4);
  return { dbUrl: prod.SUPABASE_DB_URL, maskedRef: `****${tail}`, confirmCode: tail };
}
