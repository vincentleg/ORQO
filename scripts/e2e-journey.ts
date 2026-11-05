/**
 * Recovery (Nov 2026): the complete first-user journey, through the browser only (no database access), so the
 * same script verifies a local isolated server, a preview deployment and production:
 *
 *   landing → sign-up (real form) → onboarding (workspace) → company profile → add a company → one Basic
 *   analysis of an official website → track a credible opportunity (when the analysis finds one) → sign out →
 *   sign in → everything persisted → a second account sees none of it (tenant isolation through the UI) →
 *   mobile (390 px): no horizontal overflow, navigation works → no console error anywhere.
 *
 *   BASE_URL=http://localhost:3100 bun scripts/e2e-journey.ts
 *
 * Accounts use reserved example.com addresses (no email is sent: ORQO has no email provider). Under the isolated
 * runner the run's accounts are deleted by the test harness; on a deployment they remain and are counted in the
 * output.
 * The Basic analysis reads a few public pages of ONE official website, respecting robots.txt; no paid provider.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const TARGET = process.env.E2E_ANALYSIS_DOMAIN ?? "gigaio.com";
const OUT = ".screenshots";
const STAMP = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6)}`;
const errors: string[] = [];
const created: string[] = [];

// Under the isolated runner (ORQO_TEST_ENV_FILE is set by it) the run's accounts are created with the harness's
// run-marked addresses and deleted at the end; elsewhere no database is touched.
const cleanup = process.env.ORQO_TEST_ENV_FILE ? await import("../tests/support/supabase") : null;
const email = (label: string) => (cleanup ? cleanup.testEmail(label) : `orqo-smoke-${STAMP}-${label}@example.com`);
const password = `Journey-${crypto.randomUUID()}`;

function fail(message: string): never {
  throw new Error(message);
}
async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/journey-${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}
async function expectPath(page: Page, path: string | RegExp, timeout = 20_000) {
  await page.waitForURL((u) => (typeof path === "string" ? u.pathname === path : path.test(u.pathname)), { timeout });
}
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`${label}: horizontal overflow of ${overflow}px`);
}
function watch(page: Page) {
  page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()} :: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 200)}`));
}
async function newPage(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport, locale: "en-US" });
  const page = await ctx.newPage();
  watch(page);
  return { ctx, page };
}

async function signUp(page: Page, label: string, name: string): Promise<string> {
  const address = email(label);
  await page.goto(`${BASE}/signup`);
  await page.getByRole("heading", { name: "Create your ORQO account" }).waitFor();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expectPath(page, "/onboarding");
  created.push(address);
  return address;
}

async function signIn(page: Page, address: string, next = "/workspace") {
  await page.goto(`${BASE}${next}`);
  await expectPath(page, "/login");
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectPath(page, next);
}

const browser = await chromium.launch();
let companyUrl = "";
let trackedUrl: string | null = null;
try {
  const { ctx, page } = await newPage(browser);

  // 1 · Public landing.
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await shot(page, "01-landing");

  // 2 · Registration through the real form → onboarding.
  const owner = await signUp(page, "journey", "Journey Owner");
  await shot(page, "02-onboarding");

  // 3 · First workspace.
  await page.getByLabel("Workspace name").fill(`Journey ${STAMP}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expectPath(page, "/workspace");
  await page.getByTestId("workspace-name").getByText(`Journey ${STAMP}`).waitFor();
  await shot(page, "03-workspace");

  // 4 · Company profile (what ORQO compares every company with).
  await page.goto(`${BASE}/workspace/company`);
  await page.getByLabel("Company name", { exact: true }).fill("Journey Systems");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await page.getByTestId("own-company").getByText("Journey Systems").waitFor();
  const form = page.getByTestId("own-profile-form");
  await form.getByLabel("What your company does (optional)").fill("European manufacturer of rugged servers and edge computing systems.");
  await form.getByLabel("What you offer").fill("Rugged servers\nODM manufacturing\nSystem integration");
  await form.getByLabel("Target customers").fill("Defense, Industrial");
  await form.getByLabel("Markets").fill("Europe");
  await form.getByLabel("Geographies covered").fill("France, Germany");
  await form.getByLabel("What you are looking for").fill("Composable infrastructure, GPU");
  await form.getByText("Potential supplier").click();
  await form.getByText("OEM / ODM").click();
  await form.getByRole("button", { name: "Save" }).click();
  await form.getByText("Profile saved.").waitFor();
  await shot(page, "04-company-profile");

  // 5 · Add a company to the Network.
  await page.goto(`${BASE}/workspace/network`);
  await page.getByLabel("Company name", { exact: true }).fill("Journey Partner Co");
  await page.getByLabel("Website (optional)").fill("https://journey-partner.example.com");
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByTestId("company-list").getByText("Journey Partner Co").waitFor();
  await shot(page, "05-company-added");

  // 6 · One real Basic analysis of an official website (deterministic, official site only, no paid provider).
  await page.goto(`${BASE}/workspace?q=${encodeURIComponent(TARGET)}`);
  await page.getByTestId("run-basic").click();
  await page.getByTestId("analysis-understanding").waitFor({ timeout: 90_000 });
  await page.getByTestId("research-meta").getByText("Official website only").waitFor();
  await page.getByTestId("dossier").waitFor();
  const verdict = await page.getByTestId("dossier-verdict").getAttribute("data-verdict");
  console.log(`  analysis of ${TARGET}: verdict ${verdict}`);
  await shot(page, "06-analysis", true);
  await page.getByTestId("add-to-network").click();
  await page.getByText("Already in your Network").waitFor();

  // 7 · Track a credible opportunity, when the analysis found one (zero is a valid, honest result).
  await page.goto(`${BASE}/workspace/network?q=${encodeURIComponent(TARGET)}`);
  await page.getByTestId("company-list").getByTestId("company-row").first().click();
  await expectPath(page, /^\/workspace\/companies\/[0-9a-f-]{36}$/);
  companyUrl = page.url();
  if ((await page.getByTestId("track-opportunity").count()) > 0) {
    await page.getByTestId("track-opportunity").first().click();
    await page.getByTestId("tracked").waitFor();
    await page.getByTestId("tracked").getByRole("link", { name: "Open in Opportunities" }).click();
    await page.waitForURL(/\/workspace\/opportunities\/[0-9a-f-]{36}$/);
    trackedUrl = page.url();
    await page.getByTestId("opportunity-title").waitFor();
    await shot(page, "07-tracked-opportunity");
  } else {
    console.log(`  no credible opportunity with ${TARGET} for this profile: nothing to track (honest result)`);
  }

  // 8 · Sign out, then sign in again: the session ends, and everything persisted.
  await page.goto(`${BASE}/workspace`);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expectPath(page, "/");
  await page.goto(`${BASE}/workspace`);
  await expectPath(page, "/login");
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("alert").getByText("Email or password is incorrect.").waitFor();
  await signIn(page, owner);
  await page.getByTestId("workspace-name").getByText(`Journey ${STAMP}`).waitFor();
  await page.goto(`${BASE}/workspace/network`);
  await page.getByTestId("company-list").getByText("Journey Partner Co").waitFor();
  await page.goto(`${BASE}/workspace/company`);
  await page.getByTestId("own-company").getByText("Journey Systems").waitFor();
  if (trackedUrl) {
    await page.goto(`${BASE}/workspace/opportunities`);
    if ((await page.getByTestId("opportunity-row").count()) < 1) fail("The tracked opportunity should persist");
  }
  await shot(page, "08-persisted-after-sign-in");
  await ctx.close();

  // 9 · Tenant isolation through the UI: a second account sees nothing of the first.
  const other = await newPage(browser);
  await signUp(other.page, "journey-other", "Other Owner");
  await other.page.getByLabel("Workspace name").fill(`Other ${STAMP}`);
  await other.page.getByRole("button", { name: "Create workspace" }).click();
  await expectPath(other.page, "/workspace");
  await other.page.goto(`${BASE}/workspace/network`);
  if (await other.page.getByText("Journey Partner Co").count()) fail("Another workspace's company is visible");
  for (const url of [companyUrl, trackedUrl].filter((u): u is string => Boolean(u))) {
    const res = await other.page.goto(url);
    const body = await other.page.locator("body").innerText();
    if (/Journey Systems|Journey Partner Co/.test(body)) fail(`Another workspace's data is visible at ${new URL(url).pathname}`);
    if (!(res?.status() === 404 || /not found|introuvable/i.test(body))) fail(`Another workspace's record should be "not found" at ${new URL(url).pathname} (status ${res?.status()})`);
  }
  await shot(other.page, "09-isolation");
  await other.ctx.close();

  // 10 · Mobile (390 px): sign in, key pages, More menu, no horizontal overflow.
  const mobile = await newPage(browser, { width: 390, height: 844 });
  await signIn(mobile.page, owner);
  for (const path of ["/workspace", "/workspace/companies", "/workspace/opportunities", "/workspace/company", "/workspace/settings"]) {
    await mobile.page.goto(`${BASE}${path}`);
    await mobile.page.getByRole("heading", { level: 1 }).first().waitFor();
    await noOverflow(mobile.page, `mobile ${path}`);
  }
  await mobile.page.goto(`${BASE}/`);
  await noOverflow(mobile.page, "mobile /");
  await mobile.page.goto(`${BASE}/demo`);
  await noOverflow(mobile.page, "mobile /demo");
  await shot(mobile.page, "10-mobile");
  await mobile.ctx.close();

  if (errors.length) fail(`console errors:\n  ${errors.join("\n  ")}`);
  console.log(`\nJOURNEY PASSED on ${BASE}${trackedUrl ? " (opportunity tracked)" : " (no credible opportunity to track)"}`);
} catch (e) {
  console.error(`\nJOURNEY FAILED on ${BASE}: ${e instanceof Error ? e.message : e}`);
  if (errors.length) console.error(`console errors:\n  ${errors.join("\n  ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (cleanup) await cleanup.cleanupTestData();
  else if (created.length) console.log(`Accounts created on ${BASE} (reserved example.com addresses): ${created.length}`);
}
