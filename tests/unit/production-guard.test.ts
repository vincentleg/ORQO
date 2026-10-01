/**
 * Phase 13 Stage G: the production database guard identifies exactly one
 * production project and refuses everything ambiguous or known. Fictional refs.
 */
import { describe, expect, test } from "bun:test";
import { planProductionTarget, ProductionGuardError } from "../../scripts/production-guard";

const PROD = {
  ORQO_ENVIRONMENT: "production",
  ORQO_PRODUCTION_PROJECT: "prodprojref222",
  NEXT_PUBLIC_SUPABASE_URL: "https://prodprojref222.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_PRODFAKE",
  SUPABASE_DB_URL: "postgresql://postgres.prodprojref222:PRODPASS@aws-0-eu.pooler.supabase.com:5432/postgres",
};
const DEV = { NEXT_PUBLIC_SUPABASE_URL: "https://devprojref000.supabase.co", SUPABASE_DB_URL: "postgresql://postgres.devprojref000:DEVPASS@aws-0-eu.pooler.supabase.com:5432/postgres" };
const TEST = { NEXT_PUBLIC_SUPABASE_URL: "https://testprojref111.supabase.co", ORQO_DESTRUCTIVE_TESTS_PROJECT: "testprojref111" };
const plan = (prod: Record<string, string>, others: Record<string, string>[] = [DEV, TEST]) => planProductionTarget({ prod, others });

describe("production database guard", () => {
  test("accepts one consistent production project and only exposes a masked ref", () => {
    const t = plan(PROD);
    expect(t.maskedRef).toBe("****f222");
    expect(t.confirmCode).toBe("f222");
    expect(t.dbUrl).toBe(PROD.SUPABASE_DB_URL);
  });

  test("refuses missing identity metadata or a non-production label", () => {
    for (const k of ["ORQO_ENVIRONMENT", "ORQO_PRODUCTION_PROJECT", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_DB_URL"]) {
      const p: Record<string, string> = { ...PROD };
      delete p[k];
      expect(() => plan(p)).toThrow(ProductionGuardError);
    }
    expect(() => plan({ ...PROD, ORQO_ENVIRONMENT: "development" })).toThrow("must be 'production'");
    expect(() => plan({ ...PROD, ORQO_DESTRUCTIVE_TESTS_PROJECT: "prodprojref222" })).toThrow("never carry");
  });

  test("refuses mismatched URLs or a declared ref that differs", () => {
    expect(() => plan({ ...PROD, SUPABASE_DB_URL: DEV.SUPABASE_DB_URL })).toThrow();
    expect(() => plan({ ...PROD, ORQO_PRODUCTION_PROJECT: "otherref999" })).toThrow("do not match");
    expect(() => plan({ ...PROD, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", SUPABASE_DB_URL: "postgresql://postgres:x@localhost:5432/postgres", ORQO_PRODUCTION_PROJECT: "local" })).toThrow("Cannot identify");
  });

  test("refuses known development and test projects, and reused credentials", () => {
    const asDev = { ...PROD, ORQO_PRODUCTION_PROJECT: "devprojref000", NEXT_PUBLIC_SUPABASE_URL: DEV.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_DB_URL: DEV.SUPABASE_DB_URL };
    expect(() => plan(asDev)).toThrow();
    const asTest = { ...PROD, ORQO_PRODUCTION_PROJECT: "testprojref111", NEXT_PUBLIC_SUPABASE_URL: TEST.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_DB_URL: "postgresql://postgres.testprojref111:X@aws-0-eu.pooler.supabase.com:5432/postgres" };
    expect(() => plan(asTest)).toThrow("known development or test project");
    expect(() => plan(PROD, [{ ...DEV, SUPABASE_SECRET_KEY: PROD.SUPABASE_SECRET_KEY }])).toThrow("identical");
  });
});
