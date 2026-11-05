/**
 * Phase 13 Stage G (ported to PostgreSQL/Neon in the Nov 2026 recovery): the production database guard
 * identifies exactly one production database and refuses everything ambiguous or known. Fictional endpoints.
 */
import { describe, expect, test } from "bun:test";
import { planProductionTarget, ProductionGuardError } from "../../scripts/production-guard";

const PROD = {
  ORQO_ENVIRONMENT: "production",
  ORQO_PRODUCTION_PROJECT: "ep-prod-endpoint-a222",
  DATABASE_URL: "postgresql://neondb_owner:PRODPASS@ep-prod-endpoint-a222-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
};
const DEV = { DATABASE_URL: "postgresql://neondb_owner:DEVPASS@ep-dev-endpoint-b000.us-east-1.aws.neon.tech/neondb?sslmode=require" };
const TEST = { DATABASE_URL: "postgresql://neondb_owner:TESTPASS@ep-test-endpoint-c111-pooler.us-east-1.aws.neon.tech/neondb", ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-test-endpoint-c111" };
const plan = (prod: Record<string, string>, others: Record<string, string>[] = [DEV, TEST]) => planProductionTarget({ prod, others });

describe("production database guard", () => {
  test("accepts one consistent production database and only exposes a masked ref", () => {
    const t = plan(PROD);
    expect(t.maskedRef).toBe("****a222");
    expect(t.confirmCode).toBe("a222");
    expect(t.dbUrl).toBe(PROD.DATABASE_URL);
    // The direct (non-pooled) host of the same endpoint is the same database.
    expect(plan({ ...PROD, DATABASE_URL: PROD.DATABASE_URL.replace("-pooler", "") }).confirmCode).toBe("a222");
    // Operator tooling prefers the direct URL of the same endpoint; another endpoint is refused.
    const direct = PROD.DATABASE_URL.replace("-pooler", "");
    expect(plan({ ...PROD, DATABASE_URL_UNPOOLED: direct }).dbUrl).toBe(direct);
    expect(() => plan({ ...PROD, DATABASE_URL_UNPOOLED: DEV.DATABASE_URL })).toThrow("not the same database");
  });

  test("refuses missing identity metadata or a non-production label", () => {
    for (const k of ["ORQO_ENVIRONMENT", "ORQO_PRODUCTION_PROJECT", "DATABASE_URL"]) {
      const p: Record<string, string> = { ...PROD };
      delete p[k];
      expect(() => plan(p)).toThrow(ProductionGuardError);
    }
    expect(() => plan({ ...PROD, ORQO_ENVIRONMENT: "development" })).toThrow("must be 'production'");
    expect(() => plan({ ...PROD, ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-prod-endpoint-a222" })).toThrow("never carry");
  });

  test("refuses a declared ref that differs, an unidentifiable or a local database", () => {
    expect(() => plan({ ...PROD, ORQO_PRODUCTION_PROJECT: "ep-other-999" })).toThrow("does not match");
    expect(() => plan({ ...PROD, DATABASE_URL: "postgresql://u:p@db.example.net/x" })).toThrow("Cannot identify");
    expect(() => plan({ ...PROD, DATABASE_URL: "postgresql://u:p@localhost:5432/orqo", ORQO_PRODUCTION_PROJECT: "local-5432-orqo" })).toThrow("Cannot identify");
  });

  test("refuses known development and test databases, and reused credentials", () => {
    expect(() => plan({ ...PROD, ORQO_PRODUCTION_PROJECT: "ep-dev-endpoint-b000", DATABASE_URL: DEV.DATABASE_URL })).toThrow("known development or test project");
    expect(() => plan({ ...PROD, ORQO_PRODUCTION_PROJECT: "ep-test-endpoint-c111", DATABASE_URL: TEST.DATABASE_URL })).toThrow("known development or test project");
    // A test file that merely AUTHORIZES the production endpoint marks it as a test database: refused.
    expect(() => plan(PROD, [{ ORQO_DESTRUCTIVE_TESTS_PROJECT: "ep-prod-endpoint-a222" }])).toThrow("known development or test project");
    expect(() => plan(PROD, [{ DATABASE_URL: PROD.DATABASE_URL.replace("ep-prod-endpoint-a222", "ep-x") }, { DATABASE_URL: PROD.DATABASE_URL }])).toThrow();
  });
});
