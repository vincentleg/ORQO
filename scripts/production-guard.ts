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

/** Recovery (Nov 2026): production is a PostgreSQL (Neon) DATABASE_URL; ORQO_PRODUCTION_PROJECT is its endpoint id. */
export const PRODUCTION_REQUIRED = ["ORQO_ENVIRONMENT", "ORQO_PRODUCTION_PROJECT", "DATABASE_URL"] as const;

export interface ProductionTarget {
  dbUrl: string;
  /** Masked ref for display and confirmation (last 4 characters). */
  maskedRef: string;
  confirmCode: string;
}

const refsOf = (v: Record<string, string>): (string | null)[] => [projectRef(v.DATABASE_URL ?? ""), projectRef(v.NEXT_PUBLIC_SUPABASE_URL ?? ""), projectRef(v.SUPABASE_DB_URL ?? ""), (v.ORQO_DESTRUCTIVE_TESTS_PROJECT ?? "").trim().toLowerCase() || null];

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
  const api = projectRef(prod.DATABASE_URL);
  if (!api || api.startsWith("local")) throw new ProductionGuardError("Cannot identify the production database (DATABASE_URL), or it is a local database.");
  if (api !== declared) throw new ProductionGuardError("The production DATABASE_URL does not match ORQO_PRODUCTION_PROJECT.");

  const known = new Set(input.others.flatMap(refsOf).filter((x): x is string => Boolean(x)));
  if (known.has(api)) throw new ProductionGuardError("The production project is a known development or test project.");
  for (const o of input.others) for (const k of ["DATABASE_URL"]) if (o[k] && o[k] === prod[k]) throw new ProductionGuardError(`${k} is identical to a development or test value.`);

  const tail = api.slice(-4);
  // Operator work (migrations, inspection) uses the DIRECT connection when provided (Neon: no -pooler), which must
  // be the same endpoint as DATABASE_URL.
  if (prod.DATABASE_URL_UNPOOLED && projectRef(prod.DATABASE_URL_UNPOOLED) !== api) throw new ProductionGuardError("DATABASE_URL_UNPOOLED is not the same database as DATABASE_URL.");
  return { dbUrl: prod.DATABASE_URL_UNPOOLED || prod.DATABASE_URL, maskedRef: `****${tail}`, confirmCode: tail };
}
