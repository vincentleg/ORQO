/**
 * Phase 16A in a headless browser, against the isolated server and ORQO Test:
 * - an existing supplier: the "No credible new opportunity" result, the relationship question (answered once);
 * - an incremental opportunity: Track, Opportunities list and detail, status change;
 * - FR/EN, desktop / laptop / mobile (no horizontal overflow, tap targets), keyboard focus, axe (WCAG A/AA);
 * - no console errors, no research run, no request outside the app.
 * Fixtures are fictional and stored directly (no website is fetched, no provider is called).
 *
 *   bun scripts/isolated-test.ts e2e:opportunities
 */
import { chromium, type Page } from "playwright";
import { createCompany } from "@/lib/server/repositories/companies";
import { createOrganization } from "@/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { APPLIANCE_INTEGRATOR, fixtureProfile, SERVER_MAKER, SERVER_MAKER_OUTSOURCING } from "@/lib/understanding/fixtures";
import { cleanupTestData, createTestUser, sql } from "../tests/support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = ".screenshots";
const errors: string[] = [];
const outside = new Set<string>();

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/p16-${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}

async function expectPath(page: Page, path: string) {
  await page.waitForURL((u) => u.pathname === path, { timeout: 15_000 });
}

function fail(message: string): never {
  throw new Error(message);
}

/** WCAG 2 A/AA with axe-core on the page content (the shell is redesigned in Phase 16B); serious and critical violations fail. */
async function axe(page: Page, label: string) {
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const result = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
  const bad = result.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (bad.length) fail(`axe (${label}): ${JSON.stringify(bad)}`);
  console.log(`  axe ${label}: ${result.length === 0 ? "no violations" : `${result.length} minor/moderate (${result.map((v) => v.id).join(", ")})`}`);
}

async function noOverflow(page: Page, label: string) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  if (scroll > width + 1) fail(`${label}: horizontal overflow (${scroll}px > ${width}px)`);
}

/** Phase 16A controls must be comfortable to tap. */
async function tapTargets(page: Page, label: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="track-opportunity"], [data-testid="relationship-question"] button, [data-testid="relationship-question"] label, [data-testid="status-form"] button, [data-testid="status-form"] select, [data-testid="opportunity-row"]')]
      .map((el) => ({ h: el.getBoundingClientRect().height, text: (el.textContent ?? "").trim().slice(0, 40) }))
      .filter((x) => x.h > 0 && x.h < 40),
  );
  if (small.length) fail(`${label}: small tap targets ${JSON.stringify(small)}`);
}

async function research(db: Parameters<typeof startResearchRun>[0], org: string, fx: { profile: typeof SERVER_MAKER.profile }) {
  const runId = await startResearchRun(db, org, "basic", fx.profile.domain, fx.profile.domain);
  await saveIntelligence(db, org, runId, "basic", fx.profile, []);
  await finishRun(db, org, runId, { ok: true, domain: fx.profile.domain, counters: {} });
}

await cleanupTestData();
const user = await createTestUser("e2e-p16");
const org = await createOrganization(user.db, { name: "E2E Arvenor" });
await createCompany(user.db, org, { name: "Arvenor Systems", website: "https://arvenor.example", isOwnCompany: true });
const positive = (await createCompany(user.db, org, { name: "Kestrel Compute", website: "https://kestrel.example" })).id;
const negative = (await createCompany(user.db, org, { name: "Kestrel Storage", website: "https://kestrel-storage.example" })).id;
const SUPPLIER = fixtureProfile("Kestrel Storage", "kestrel-storage.example", SERVER_MAKER.profile.claims.map((c) => [c.field, c.statement.replaceAll("Kestrel Compute", "Kestrel Storage"), c.epistemic] as [typeof c.field, string, typeof c.epistemic]));
await research(user.db, org, APPLIANCE_INTEGRATOR);
await research(user.db, org, SERVER_MAKER_OUTSOURCING);
await research(user.db, org, SUPPLIER);
const runs = async () => Number((await sql`select count(*)::int as n from public.research_runs where organization_id = ${org}`)[0].n);
const runsBefore = await runs();

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(BASE).origin && !["data:", "blob:"].includes(u.protocol)) outside.add(u.host);
  });

  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectPath(page, "/workspace");

  // 1 · An existing supplier: a confident, explained negative result.
  await page.goto(`${BASE}/workspace/network/${negative}`);
  await page.getByTestId("dossier-negative").waitFor();
  if ((await page.getByTestId("dossier-verdict").getAttribute("data-verdict")) !== "no_credible_opportunity") fail("verdict should be no_credible_opportunity");
  await page.getByTestId("dossier-negative").getByRole("heading", { name: "No credible new opportunity" }).waitFor();
  await page.getByTestId("dossier-relationship").getByText("Kestrel Storage supplies Arvenor Systems", { exact: false }).waitFor();
  await page.getByTestId("negative-change").getByText("What would change this").waitFor();
  if ((await page.getByTestId("track-opportunity").count()) !== 0) fail("Nothing is trackable without a credible opportunity");
  if ((await page.getByTestId("dossier-considered").count()) !== 1) fail("Considered ideas should be listed (collapsed)");
  if (await page.getByTestId("dossier-considered").getAttribute("open")) fail("Considered ideas must be collapsed");
  if (!(await page.getByTestId("earlier-analysis").count())) fail("Phase 11 briefs should be kept under 'Earlier analysis'");
  await shot(page, "01-negative-desktop");
  await axe(page, "negative company");

  // 2 · The relationship question: answered once, then never asked again.
  const q = page.getByTestId("relationship-question");
  await q.getByText("How does Kestrel Storage work with Arvenor Systems today?").waitFor();
  await q.getByText("They supply us, or we use their products").click();
  await q.getByRole("button", { name: "Save answer" }).click();
  // The page refreshes from the server: the stated relationship replaces the question at once.
  await page.getByTestId("dossier-relationship").getByText("Stated by you").waitFor();
  await page.getByTestId("relationship-question").waitFor({ state: "detached" });
  await page.reload();
  await page.getByTestId("dossier-relationship").getByText("Stated by you").waitFor();
  if ((await page.getByTestId("relationship-question").count()) !== 0) fail("The relationship question must not be asked again");

  // 3 · An incremental opportunity: Track it.
  await page.goto(`${BASE}/workspace/network/${positive}`);
  if ((await page.getByTestId("dossier-verdict").getAttribute("data-verdict")) !== "opportunity") fail("verdict should be opportunity");
  await page.getByTestId("scenario-incremental").first().getByText("Why this is new").waitFor();
  const track = page.getByTestId("track-opportunity").first();
  await track.focus();
  const ring = await track.evaluate((el) => getComputedStyle(el).boxShadow + getComputedStyle(el).outlineStyle);
  if (!/rgb|solid|auto/.test(ring)) fail(`Keyboard focus must be visible on Track (${ring})`);
  await page.keyboard.press("Enter");
  await page.getByTestId("tracked").waitFor();
  await shot(page, "02-tracked-desktop");
  await axe(page, "positive company");
  await page.getByTestId("tracked").getByRole("link", { name: "Open in Opportunities" }).click();
  await page.waitForURL(/\/workspace\/opportunities\/[0-9a-f-]{36}$/);
  const detailUrl = page.url();

  // 4 · The opportunity: seven questions, live re-assessment, status.
  for (const h of ["What is the opportunity?", "Why could this work?", "What could kill it?", "What evidence do we have?", "What don't we know?", "What should we investigate next?", "Which companies are involved?"]) await page.getByRole("heading", { name: h }).waitFor();
  if ((await page.getByTestId("opportunity-now").getAttribute("data-now")) !== "same") fail("The tracked opportunity should still be credible");
  if (/\{|\}|"verdict"|null/.test(await page.locator("main").innerText())) fail("No raw engine object may leak into the page");
  await page.getByLabel("Status").selectOption("validated");
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByText("Status updated.").waitFor();
  await page.reload();
  await page.getByTestId("opportunity-title").waitFor();
  if ((await page.getByLabel("Status").inputValue()) !== "validated") fail("Status should persist");
  await shot(page, "03-detail-desktop");
  await axe(page, "opportunity detail");

  // 5 · The list and the temporary navigation entry.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "Opportunities", exact: true }).click();
  await expectPath(page, "/workspace/opportunities");
  if ((await nav.getByRole("link", { name: "Opportunities", exact: true }).getAttribute("aria-current")) !== "page") fail("Opportunities should be the current page");
  if ((await page.getByTestId("opportunity-row").count()) !== 1) fail("One tracked opportunity expected");
  await page.getByTestId("opportunity-row").getByText("Validated").waitFor();
  await shot(page, "04-list-desktop");
  await axe(page, "opportunities list");

  // 6 · Laptop and mobile.
  for (const [label, viewport] of [["laptop", { width: 1280, height: 800 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    for (const [name, url] of [["negative", `${BASE}/workspace/network/${negative}`], ["positive", `${BASE}/workspace/network/${positive}`], ["list", `${BASE}/workspace/opportunities`], ["detail", detailUrl]] as const) {
      await page.goto(url);
      await page.locator("main").waitFor();
      await noOverflow(page, `${label} ${name}`);
      await tapTargets(page, `${label} ${name}`);
      if (label === "mobile") await shot(page, `05-${label}-${name}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // 7 · French.
  await page.goto(`${BASE}/workspace/opportunities`);
  await page.getByRole("button", { name: "Français" }).click();
  await page.getByRole("heading", { level: 1, name: "Opportunités" }).waitFor();
  await page.getByTestId("opportunity-row").getByText("Validée").waitFor();
  await page.goto(detailUrl);
  await page.getByRole("heading", { name: "Qu'est-ce qui pourrait la tuer ?" }).waitFor();
  await page.goto(`${BASE}/workspace/network/${negative}`);
  await page.getByTestId("dossier-negative").getByRole("heading", { name: "Pas de nouvelle opportunité crédible" }).waitFor();
  await page.getByTestId("dossier-relationship").getByText("Indiqué par vous").waitFor();
  await shot(page, "06-negative-french");
  await axe(page, "negative company (fr)");
  await page.getByRole("button", { name: "English" }).click();
  await page.getByTestId("dossier-negative").getByRole("heading", { name: "No credible new opportunity" }).waitFor();

  // 8 · Empty state (a second, empty workspace is not needed: closing does not remove; the list keeps memory).
  if ((await runs()) !== runsBefore) fail("Phase 16A pages must not start any research");
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
console.log("\nPhase 16A flow passed: no console errors, no research run, no request outside the app.");
