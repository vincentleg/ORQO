/**
 * Walks the Phase 5 Discover UI in a headless browser against a running
 * server started with ORQO_AGENT_PREVIEW_ORGS=<TEST_PREVIEW_ORG> (a SYNTHETIC 7e570000- id; never a real preview org) and NO
 * provider keys: the mission form (web source truthfully unavailable), a
 * discover_companies mission over the workspace-knowledge source (fictional
 * stored research — no web fetch, no provider; labeled as not live web
 * discovery), real progress steps, qualified and rejected companies,
 * evidence, Why now, Add to Network (no duplicate), the Network marker, the
 * Prospecting Agent page, the run page, French, the locked Free state, and
 * a Search regression.
 *
 *   TEST_PREVIEW_ORG=7e570000-… bun run e2e:discover   (BASE_URL defaults to http://localhost:3100)
 */
import { chromium, type Page } from "playwright";
import { INJECTED, PEER_FIXTURE, SERVICES_OWN, STRONG, TIMED } from "../src/lib/discovery/fixtures";
import type { TargetProfile } from "../src/lib/intelligence/types";
import { createCompany, updateOwnCompanyProfile } from "../src/lib/server/repositories/companies";
import { createOrganization } from "../src/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "../src/lib/server/research/repository";
import { cleanupTestData, createSyntheticPreviewOrg, createTestUser, sql, testPreviewOrgId, type TestUser } from "../tests/support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = ".screenshots";
// Synthetic fixture org (validated: reserved namespace, never a real preview org).
const ORG = testPreviewOrgId();
const errors: string[] = [];

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/discover-${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

function check(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

async function signIn(page: Page, user: TestUser) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname === "/workspace", { timeout: 15_000 });
}

await cleanupTestData();
const owner = await createTestUser("e2e-discover");
const free = await createTestUser("e2e-discover-free");

// Preview workspace: own profile, four analyses already stored (fictional fixtures), one of them in the Network.
await createSyntheticPreviewOrg(owner, "Discover Preview");
await createCompany(owner.db, ORG, { name: "Own Co", website: "https://own.example", isOwnCompany: true });
await updateOwnCompanyProfile(owner.db, ORG, { ...SERVICES_OWN, name: "Atelier Services", website: "https://own.example", markets: ["Europe"] });
for (const p of [STRONG, TIMED, PEER_FIXTURE, INJECTED] as TargetProfile[]) {
  const rr = await startResearchRun(owner.db, ORG, "basic", p.domain, p.domain);
  await saveIntelligence(owner.db, ORG, rr, "basic", p, []);
  await finishRun(owner.db, ORG, rr, { ok: true, domain: p.domain, counters: {} });
}
await createCompany(owner.db, ORG, { name: "Strong Systems", website: "https://strong.example" });
await createOrganization(free.db, { name: "Free Workspace" });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, owner);

  // Mission form. Without provider keys the web source is disabled and says why.
  await page.goto(`${BASE}/workspace/discover`);
  await page.getByRole("heading", { name: "What kind of business are you looking for?" }).waitFor();
  const web = page.getByTestId("discover-form").locator('select[name="source"] option[value="web_search"]');
  check(await web.evaluate((o) => (o as HTMLOptionElement).disabled), "web source must be disabled without a provider");
  check(/not configured|not included/.test((await web.textContent()) ?? ""), "web source must explain why it is unavailable");
  await page.getByTestId("discover-source-note").getByText("not live web discovery").waitFor();
  check((await page.getByTestId("discover-history").count()) === 0, "no history yet");
  await shot(page, "01-form");

  // Mission → real steps → result on the Discover page.
  await page.locator('[data-intent="customers"]').click();
  await page.getByTestId("start-discovery").click();
  await page.getByTestId("discover-progress").waitFor();
  await page.waitForURL(/\/workspace\/discover\?run=[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.getByTestId("discovery-result").waitFor();
  await page.getByTestId("discover-source").getByText("Not live web discovery").waitFor();
  const cards = page.getByTestId("discovered-company");
  check((await cards.count()) >= 2, "expected at least two qualified companies");
  const strong = page.locator('[data-domain="strong.example"]');
  await strong.getByTestId("in-network").waitFor();
  check((await strong.getByTestId("discover-add").count()) === 0, "a Network company has no Add button");
  await strong.getByTestId("why-now-unknown").waitFor();
  const timed = page.locator('[data-testid="discovered-company"][data-domain="timed.example"]');
  await timed.getByTestId("why-now").getByText("2026", { exact: false }).waitFor();
  check((await timed.getByTestId("discover-evidence").locator("li").count()) > 0, "evidence must be shown");
  check((await cards.first().getAttribute("data-domain")) === "timed.example", "dated timing should rank first among equals");
  await page.getByTestId("discover-next-action").getByText("Start with", { exact: false }).waitFor();
  await shot(page, "02-result");

  await page.getByTestId("discovery-plan").locator("summary").click();
  await page.getByTestId("discover-rejected").locator("summary").click();
  await page.getByTestId("discover-rejected").locator('[data-reason]').first().waitFor();
  check((await page.getByTestId("discover-rejected").getByText("peer.example").count()) === 1, "the false positive must be rejected with a reason");
  await shot(page, "03-plan-and-rejections");

  // Add to Network: human choice, provenance, never duplicated.
  await timed.getByTestId("discover-add").click();
  await timed.getByTestId("discover-added").getByText("Added to your Network").waitFor();
  await shot(page, "04-added-to-network");
  const runId = new URL(page.url()).searchParams.get("run");
  const rows = await sql`select external_ref from public.companies where organization_id = ${ORG} and website = 'https://timed.example'`;
  check(rows.length === 1 && rows[0].external_ref === `discover:${runId}:timed.example`, "one Network row with Discover provenance");
  await page.reload();
  await page.locator('[data-domain="timed.example"]').getByTestId("discover-add").click();
  await page.locator('[data-domain="timed.example"]').getByText("Already in your Network").waitFor();
  check((await sql`select count(*)::int as n from public.companies where organization_id = ${ORG} and website = 'https://timed.example'`)[0].n === 1, "no duplicate company");
  await page.getByTestId("discover-history").locator("li").first().waitFor();
  await shot(page, "05-history");

  // Prospecting Agent page: executable in preview, same mission entry point, recent run.
  await page.goto(`${BASE}/workspace/agents/prospecting`);
  // Phase 9 detail page: responsibilities instead of capability labels. Executable in preview = neither locked
  // nor planned, and the Discover mission form (asserted next) is the entry point.
  await page.getByTestId("agent-definition").getByTestId("agent-responsibilities").waitFor();
  check((await page.getByTestId("agent-locked-note").count()) === 0 && (await page.getByTestId("agent-planned-note").count()) === 0, "prospecting agent executable in preview");
  await page.getByTestId("discover-form").waitFor();
  check((await page.getByTestId("agent-runs").locator("tbody tr").count()) === 1, "one prospecting run");
  await shot(page, "06-prospecting-agent");
  await page.getByTestId("agent-runs").getByRole("link", { name: "View →" }).click();
  await page.getByTestId("discovery-result").waitFor();
  await page.getByTestId("run-steps").locator('[data-step="apply_critic"][data-state="completed"]').waitFor();
  await shot(page, "07-run");

  // Search regression: the stored analysis still opens from Discover's link target.
  await page.goto(`${BASE}/workspace?q=strong.example`);
  await page.getByText("What they do").first().waitFor();
  await shot(page, "08-search-regression");

  // French.
  await page.goto(`${BASE}/workspace/settings`);
  await page.getByRole("combobox", { name: "Language" }).selectOption("fr");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { name: "Paramètres" }).waitFor();
  await page.goto(`${BASE}/workspace/discover`);
  await page.getByRole("heading", { name: "Quel type d'affaires recherchez-vous ?" }).waitFor();
  await page.getByText("Entreprises à étudier").waitFor();
  await page.getByText("Pourquoi elle a été trouvée").first().waitFor();
  await shot(page, "09-fr");

  // Free workspace: locked, no mission entry point, Search pointed to instead.
  const freePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  freePage.on("pageerror", (e) => errors.push(e.message));
  await signIn(freePage, free);
  await freePage.goto(`${BASE}/workspace/discover`);
  await freePage.getByTestId("discover-locked").getByText("Available with Pro").waitFor();
  check((await freePage.getByTestId("discover-form").count()) === 0, "Free must not see the discover form");
  await shot(freePage, "10-free-locked");
  await freePage.goto(`${BASE}/workspace/agents`);
  check((await freePage.locator('[data-agent="prospecting"]').getAttribute("data-access")) === "locked", "Prospecting Agent locked on Free");
} finally {
  await browser.close();
  await cleanupTestData();
  await sql.end();
}

if (errors.length > 0) {
  console.error("Console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("Discover E2E passed.");
