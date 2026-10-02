/**
 * Phase 17A in a headless browser, against the isolated server (paid providers forced off; the synthetic
 * preview organization is Internal with a test-only ceiling):
 * - an Internal workspace sees its workforce budget (ceiling, committed, remaining, recent calls) in Settings;
 * - a normal workspace never sees it;
 * - wording: "ORQO remembers 1 company" (singular), and a company typed in lowercase is shown capitalized;
 * - axe WCAG A/AA, no console error, no request outside the app.
 * The spend rows are written through the real reservation functions (no provider is called).
 *
 *   bun scripts/isolated-test.ts e2e:governance
 */
import { chromium, type Page } from "playwright";
import { createCompany } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { reserveSpend, settleSpend } from "@/lib/server/governance/ledger";
import { startResearchRun } from "@/lib/server/research/repository";
import { cleanupTestData, createSyntheticPreviewOrg, createTestUser } from "../tests/support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = ".screenshots";
const errors: string[] = [];
const outside = new Set<string>();
const fail = (m: string): never => {
  throw new Error(m);
};

async function axe(page: Page, label: string) {
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const v = await page.evaluate(async () => (await (window as unknown as { axe: { run: (d: Document, o: unknown) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => ({ id: x.id, impact: x.impact })));
  const bad = v.filter((x) => x.impact === "serious" || x.impact === "critical");
  if (bad.length) fail(`axe ${label}: ${JSON.stringify(bad)}`);
  console.log(`  axe ${label}: ok`);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname === "/workspace", { timeout: 15_000 });
}

await cleanupTestData();
const [internalUser, normalUser] = await Promise.all([createTestUser("e2e-p17-internal"), createTestUser("e2e-p17-normal")]);
const internalOrg = await createSyntheticPreviewOrg(internalUser, "E2E Internal");
const normalOrg = await createOrganization(normalUser.db, { name: "E2E Normal" });
await createCompany(normalUser.db, normalOrg, { name: "Solo Partner", website: "https://solo-partner.example" });
// Two settled calls on the Internal workspace, written by the real ledger functions (no provider involved).
const run = await startResearchRun(internalUser.db, internalOrg, "deep", "fixture.example", "fixture.example");
for (const [cost, provider] of [[0.0021, "openrouter"], [null, "brave"]] as const) {
  const id = await reserveSpend(internalUser.db, { organizationId: internalOrg, agentRunId: null, researchRunId: run, provider, task: provider === "brave" ? "web_search" : "extraction", model: provider === "brave" ? null : "google/gemini-3.8-flash", amountUsd: provider === "brave" ? 0.01 : 0.02, ceilingUsd: 0.5, idempotencyKey: crypto.randomUUID() });
  await settleSpend(internalUser.db, internalOrg, id, "succeeded", cost);
}

const browser = await chromium.launch();
try {
  for (const [label, user, internal] of [["internal", internalUser, true], ["normal", normalUser, false]] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await context.newPage();
    page.on("console", (m) => m.type() === "error" && errors.push(`${label}: ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => errors.push(`${label}: ${e.message.slice(0, 160)}`));
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin !== new URL(BASE).origin && !["data:", "blob:"].includes(u.protocol)) outside.add(u.host);
    });
    await signIn(page, user.email, user.password);
    await page.goto(`${BASE}/workspace/settings`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    const card = page.getByTestId("internal-usage");
    if (internal) {
      await card.waitFor();
      await card.getByText("Internal workforce budget").waitFor();
      await card.getByText("$0.50").first().waitFor(); // the test-only ceiling
      await card.getByText("Paid providers are switched off on this deployment.").waitFor();
      const rows = await card.locator("li").count();
      if (rows !== 2) fail(`Internal: expected 2 recent calls, got ${rows}`);
      await card.getByText("brave · web_search").waitFor();
      // Committed = 0.0021 (reported) + 0.01 (unknown cost kept at the reservation).
      if ((await card.getByText("$0.0121").count()) !== 2) fail("committed and settled should both be $0.0121");
      await page.screenshot({ path: `${OUT}/p17a-internal-usage.png`, fullPage: true });
      await axe(page, "settings (internal)");
    } else {
      if ((await card.count()) !== 0) fail("A normal workspace must never see the Internal usage view");
      // Wording: one remembered company, singular.
      await page.goto(`${BASE}/workspace`);
      await page.getByTestId("work-memory").getByText("ORQO remembers 1 company and holds research on 0.").waitFor();
      // A company typed in lowercase is shown with sensible capitals.
      await page.goto(`${BASE}/workspace?ask=${encodeURIComponent("analyze globex")}`);
      await page.getByTestId("ceo-headline").getByText("ORQO hasn't researched Globex yet.").waitFor();
      await page.getByTestId("ceo-lookup").getByText("Look up Globex").waitFor();
      await axe(page, "work (normal)");
      // French singular.
      await page.goto(`${BASE}/workspace`);
      await page.getByRole("button", { name: "Français" }).first().click();
      await page.getByTestId("work-memory").getByText("ORQO retient 1 entreprise", { exact: false }).waitFor();
      await page.getByRole("button", { name: "English" }).first().click();
      await page.getByRole("heading", { level: 1, name: "What should your team work on?" }).waitFor();
    }
    console.log(`✓ ${label}`);
    await context.close();
  }
} finally {
  await browser.close();
  await cleanupTestData();
}

const allowed = [...outside].filter((h) => !/^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(h));
if (allowed.length) errors.push(`requests outside the app: ${allowed.join(", ")}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s):\n${[...new Set(errors)].join("\n")}`);
  process.exit(1);
}
console.log("\nPhase 17A governance flow passed: no console errors, no request outside the app.");
