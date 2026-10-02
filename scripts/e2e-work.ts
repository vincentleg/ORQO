/**
 * Phase 16B in a headless browser, against the isolated server and ORQO Test:
 * - Work: the CEO input and a briefing built from stored records only (credible opportunities only);
 * - ORQO CEO: typed intents in EN/FR, clarification, honest future capabilities, product objects;
 * - Companies: lookup, remembered companies, the canonical company page, compatibility redirects;
 * - navigation: Work / Companies / Opportunities / Events, everything else under More;
 * - desktop / laptop / mobile, keyboard focus, axe WCAG A/AA on whole pages (shell included);
 * - no console error, no research run, no request outside the app.
 * Fictional fixtures stored directly: no website is fetched, no provider is called.
 *
 *   bun scripts/isolated-test.ts e2e:work
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

function fail(message: string): never {
  throw new Error(message);
}
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/p16b-${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}
async function expectPath(page: Page, path: string) {
  await page.waitForURL((u) => u.pathname === path, { timeout: 15_000 });
}
async function axe(page: Page, label: string) {
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const result = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
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
async function ask(page: Page, text: string, kind: string) {
  await page.goto(`${BASE}/workspace`);
  await page.getByLabel(/Tell ORQO what you want to achieve|Dites à ORQO ce que vous voulez accomplir/).first().fill(text);
  await page.keyboard.press("Enter");
  await page.getByTestId("ceo-answer").waitFor();
  const got = await page.getByTestId("ceo-answer").getAttribute("data-kind");
  if (got !== kind) fail(`"${text}" → ${got}, expected ${kind}`);
  return page.getByTestId("ceo-answer");
}
async function research(db: Parameters<typeof startResearchRun>[0], org: string, fx: { profile: typeof SERVER_MAKER.profile }) {
  const runId = await startResearchRun(db, org, "basic", fx.profile.domain, fx.profile.domain);
  await saveIntelligence(db, org, runId, "basic", fx.profile, []);
  await finishRun(db, org, runId, { ok: true, domain: fx.profile.domain, counters: {} });
}

await cleanupTestData();
const user = await createTestUser("e2e-p16b");
const org = await createOrganization(user.db, { name: "E2E Arvenor Work" });
await createCompany(user.db, org, { name: "Arvenor Systems", website: "https://arvenor.example", isOwnCompany: true });
const positive = (await createCompany(user.db, org, { name: "Kestrel Compute", website: "https://kestrel.example" })).id;
const negative = (await createCompany(user.db, org, { name: "Kestrel Storage", website: "https://kestrel-storage.example" })).id;
const SUPPLIER = fixtureProfile("Kestrel Storage", "kestrel-storage.example", SERVER_MAKER.profile.claims.map((c) => [c.field, c.statement.replaceAll("Kestrel Compute", "Kestrel Storage"), c.epistemic] as [typeof c.field, string, typeof c.epistemic]));
await research(user.db, org, APPLIANCE_INTEGRATOR);
await research(user.db, org, SERVER_MAKER_OUTSOURCING);
await research(user.db, org, SUPPLIER);
const runs = async () => Number((await sql`select count(*)::int as n from public.research_runs where organization_id = ${org}`)[0].n);
const agentRuns = async () => Number((await sql`select count(*)::int as n from public.agent_runs where organization_id = ${org}`)[0].n);
const before = { research: await runs(), agents: await agentRuns() };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
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

  // 1 · Work: the CEO and a briefing from stored records only.
  await page.getByRole("heading", { level: 1, name: "What should your team work on?" }).waitFor();
  await page.getByTestId("work-basis").waitFor();
  const top = page.getByTestId("work-top-item");
  if ((await top.count()) !== 1) fail(`Work should prioritize exactly the one credible opportunity (got ${await top.count()})`);
  if (!(await top.first().innerText()).includes("Kestrel Compute")) fail("The credible opportunity is with Kestrel Compute");
  if ((await page.getByTestId("work-top").innerText()).includes("Kestrel Storage")) fail("A no-credible-opportunity company must never be a priority");
  await page.getByTestId("work-question").getByText("How does Kestrel Compute work with Arvenor Systems today?").waitFor();
  if ((await page.getByTestId("work-continue-item").count()) !== 2) fail("Continue working should list both companies");
  await page.getByTestId("work-memory").getByText("1 of them show no credible new opportunity", { exact: false }).waitFor();
  await shot(page, "01-work-desktop");
  await axe(page, "work");
  if ((await runs()) !== before.research) fail("Loading Work must not start research");

  // Primary navigation: four destinations; everything else under More.
  const nav = page.getByRole("navigation", { name: "Main navigation" }).first();
  const labels = await nav.getByRole("link").allInnerTexts();
  if (labels.map((x) => x.trim()).join("|") !== "Work|Companies|Opportunities|Events") fail(`Primary navigation: ${labels.join("|")}`);
  if ((await nav.getByRole("link", { name: "Work" }).getAttribute("aria-current")) !== "page") fail("Work should be current");
  const more = page.getByRole("navigation", { name: "More" }).first();
  for (const l of ["Your company", "Find companies", "Signals", "Agents", "Overview", "Plans", "Settings"]) await more.getByRole("link", { name: l, exact: true }).waitFor();

  // 2 · ORQO CEO: typed intents answered with product objects.
  let a = await ask(page, "What could we do with Kestrel Compute?", "company");
  await a.getByTestId("ceo-headline").getByText("The most credible opportunity with Kestrel Compute", { exact: false }).waitFor();
  await a.getByTestId("dossier").waitFor();
  await shot(page, "02-ceo-opportunity");
  await axe(page, "ceo opportunity");
  // Track from the CEO answer.
  await a.getByTestId("track-opportunity").first().click();
  await page.getByTestId("tracked").waitFor();

  a = await ask(page, "Is Kestrel Storage actually interesting for us?", "company");
  await a.getByTestId("ceo-headline").getByText("I don't see a credible new opportunity with Kestrel Storage.").waitFor();
  await a.getByTestId("dossier-negative").waitFor();
  if ((await a.getByTestId("track-opportunity").count()) !== 0) fail("Nothing trackable without a credible opportunity");
  await shot(page, "03-ceo-negative");

  a = await ask(page, "Analyze Kestrel", "clarify");
  if ((await a.getByTestId("ceo-option").count()) !== 2) fail("One clarification with the two Kestrel companies");
  await a.getByTestId("ceo-option").filter({ hasText: "Kestrel Storage" }).click();
  await page.getByTestId("ceo-answer").and(page.locator('[data-kind="company"]')).waitFor();
  await shot(page, "04-ceo-clarified", false);

  a = await ask(page, "What should I work on today?", "priorities");
  if ((await a.getByTestId("work-top-item").count()) !== 1) fail("Priorities: credible opportunities only");
  await a.getByTestId("work-top-item").first().getByText("Tracked", { exact: false }).waitFor();
  a = await ask(page, "What should I investigate next?", "next_investigation");
  a = await ask(page, "Find companies that could help us enter Germany", "prospects");
  const href = await a.getByTestId("ceo-discover").getAttribute("href");
  if (!href?.startsWith("/workspace/discover?objective=")) fail("Prospects should carry the objective to Discover");
  a = await ask(page, "Send an email to Kestrel Compute", "future");
  if ((await a.getByTestId("ceo-future").getAttribute("data-capability")) !== "outreach") fail("Outreach is a future capability");
  a = await ask(page, "Compare Kestrel Compute and Kestrel Storage", "future");
  a = await ask(page, "Prepare me for my meeting with Kestrel Compute", "company");
  await a.getByTestId("ceo-limitation").waitFor();
  await a.getByTestId("ceo-report").waitFor();
  a = await ask(page, "What don't we know about Kestrel Storage?", "company");
  await a.getByTestId("ceo-missing").waitFor();
  a = await ask(page, "Explain this opportunity", "opportunity");
  await a.getByRole("heading", { name: "What could kill it?" }).waitFor();
  a = await ask(page, "Analyze Globex", "not_researched");
  await a.getByTestId("ceo-lookup").waitFor();
  a = await ask(page, "hello", "clarify");
  if ((await runs()) !== before.research || (await agentRuns()) !== before.agents) fail("The CEO must not start research or agents");

  // 3 · Companies: lookup, remembered companies, canonical page, compatibility.
  await nav.getByRole("link", { name: "Companies" }).click();
  await expectPath(page, "/workspace/companies");
  await page.getByRole("heading", { level: 1, name: "Companies" }).waitFor();
  if ((await page.getByTestId("company-item").count()) !== 2) fail("Both remembered companies listed");
  await page.getByTestId("company-item").filter({ hasText: "Kestrel Compute" }).getByText("Opportunity tracked").waitFor();
  await shot(page, "05-companies");
  await axe(page, "companies");
  await page.getByLabel("Company name or website").fill("kestrel.example");
  await page.getByRole("button", { name: "Look up" }).click();
  await page.getByTestId("search-result").waitFor();
  await page.getByTestId("dossier").waitFor();
  await page.goto(`${BASE}/workspace?q=kestrel.example`);
  await expectPath(page, "/workspace/companies");
  await page.goto(`${BASE}/workspace/network/${negative}`);
  await expectPath(page, `/workspace/companies/${negative}`);
  await page.getByTestId("company-memory").getByText("No new opportunity").waitFor();
  if ((await nav.getByRole("link", { name: "Companies" }).getAttribute("aria-current")) !== "page") fail("Companies should be current on a company page");
  await shot(page, "06-company");
  await axe(page, "company page");
  await page.goto(`${BASE}/workspace/companies/${positive}`);
  await page.getByTestId("company-memory").getByText("Opportunity tracked").waitFor();

  // 4 · Other destinations stay reachable.
  for (const [path, heading] of [["/workspace/opportunities", "Opportunities"], ["/workspace/events", "Events"], ["/workspace/agents", "Your AI business development team"], ["/workspace/intelligence", "Intelligence"], ["/workspace/dashboard", "Dashboard"]] as const) {
    await page.goto(`${BASE}${path}`);
    await page.getByRole("heading", { level: 1, name: heading }).waitFor();
  }
  await page.goto(`${BASE}/workspace/opportunities`);
  await axe(page, "opportunities");
  await page.goto(`${BASE}/workspace/events`);
  await axe(page, "events");

  // 5 · Keyboard: the CEO input and its button are reachable with visible focus.
  await page.goto(`${BASE}/workspace`);
  await page.getByLabel("Tell ORQO what you want to achieve").focus();
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => { const el = document.activeElement as HTMLElement; return `${el.textContent?.trim()}|${getComputedStyle(el).boxShadow}${getComputedStyle(el).outlineStyle}`; });
  if (!ring.startsWith("Ask ORQO|") || !/rgb|solid|auto/.test(ring)) fail(`Visible focus on the CEO button (${ring})`);

  // 6 · Laptop and mobile.
  for (const [label, viewport] of [["laptop", { width: 1280, height: 800 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    for (const [name, url] of [["work", "/workspace"], ["ceo", `/workspace?ask=${encodeURIComponent("What could we do with Kestrel Compute?")}`], ["companies", "/workspace/companies"], ["company", `/workspace/companies/${positive}`], ["opportunities", "/workspace/opportunities"], ["events", "/workspace/events"]] as const) {
      await page.goto(`${BASE}${url}`);
      await page.locator("main").waitFor();
      await noOverflow(page, `${label} ${name}`);
      if (label === "mobile") await shot(page, `07-mobile-${name}`, name !== "company");
    }
  }
  // Mobile: four primary destinations always visible, the rest under More.
  await page.goto(`${BASE}/workspace`);
  const mobileNav = page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true });
  if ((await mobileNav.getByRole("link").count()) !== 4) fail("Mobile: four primary destinations");
  await page.getByTestId("mobile-more").locator("summary").click();
  await page.getByTestId("mobile-more").getByRole("link", { name: "Agents" }).waitFor();
  await shot(page, "08-mobile-more", false);
  await axe(page, "mobile work with More open");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 7 · French.
  await page.goto(`${BASE}/workspace`);
  await page.getByRole("button", { name: "Français" }).first().click();
  await page.getByRole("heading", { level: 1, name: "Sur quoi votre équipe doit-elle travailler ?" }).waitFor();
  const frNav = await page.getByRole("navigation", { name: "Navigation principale" }).first().getByRole("link").allInnerTexts();
  if (frNav.map((x) => x.trim()).join("|") !== "Travail|Entreprises|Opportunités|Événements") fail(`FR navigation: ${frNav.join("|")}`);
  await axe(page, "work (fr)");
  a = await ask(page, "Que pourrions-nous faire avec Kestrel Storage ?", "company");
  await a.getByTestId("ceo-headline").getByText("Je ne vois pas de nouvelle opportunité crédible avec Kestrel Storage.").waitFor();
  await shot(page, "09-ceo-french");
  a = await ask(page, "Sur quoi dois-je travailler aujourd'hui ?", "priorities");
  await page.getByRole("button", { name: "English" }).first().click();
  await page.getByRole("heading", { level: 1, name: "What should your team work on?" }).waitFor();

  if ((await runs()) !== before.research || (await agentRuns()) !== before.agents) fail("Phase 16B pages must not start research or agents");
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
console.log("\nPhase 16B flow passed: no console errors, no research or agent run, no request outside the app.");
