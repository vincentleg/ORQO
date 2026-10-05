/**
 * Phase 17C mission experience in a headless browser, against the isolated server (paid providers forced
 * off; the synthetic preview organization is Internal). Only stored research is used: nothing is fetched.
 * - Missions in the primary navigation; delegation with the keyboard (template radios, Start);
 * - the live mission is driven to completion by the page (execute slices), survives a reload mid-run, and
 *   ends on the ORQO Briefing with work cards and the free-authority line;
 * - busy: another agent run blocks the mission → "waiting" (bounded backoff), then it completes once freed;
 * - cancellation: confirmation with focus on the safe choice, then "Stopped" with what was finished;
 * - a French viewer follows a finished mission (no Stop, no execution);
 * - mobile width without horizontal overflow; axe WCAG A/AA; no console error; no request outside the app.
 *
 *   bun scripts/isolated-test.ts e2e:missions
 */
import { chromium, type Page } from "playwright";
import { GOLDEN_WORLD } from "@/lib/missions/golden";
import { cancelRun } from "@/lib/server/agents/repository";
import { createCompany, updateOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { finishRun, saveIntelligence, startResearchRun } from "@/lib/server/research/repository";
import { addMember, cleanupTestData, createSyntheticPreviewOrg, createTestUser, sql } from "../tests/support/supabase";

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
  await page.getByLabel(/^(Email|E-mail)$/).fill(email);
  await page.getByLabel(/^(Password|Mot de passe)$/).fill(password);
  await page.getByRole("button", { name: /^(Sign in|Se connecter)$/ }).click();
  await page.waitForURL((u) => u.pathname === "/workspace", { timeout: 15_000 });
}

async function noOverflow(page: Page, label: string) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (sw > w + 1) fail(`${label}: horizontal overflow (${sw} > ${w})`);
}

const phase = (page: Page) => page.getByTestId("mission-phase").getAttribute("data-phase");

/** Picks a template the way a person does: by clicking its card (the radio itself is visually hidden). */
async function pick(page: Page, id: string) {
  await page.getByTestId(`template-${id}`).click();
  if (!(await page.locator(`input[name="template"][value="${id}"]`).isChecked())) fail(`template ${id} should be selected`);
}

async function delegate(page: Page, id: string) {
  await page.goto(`${BASE}/workspace/missions`);
  await pick(page, id);
  await page.getByTestId("delegate-start").click();
  await page.waitForURL((u) => /^\/workspace\/missions\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 15_000 });
  return new URL(page.url()).pathname.split("/").pop() as string;
}

await cleanupTestData();
const [owner, viewer] = await Promise.all([createTestUser("e2e-p17c-owner"), createTestUser("e2e-p17c-viewer", { locale: "fr" })]);
const org = await createSyntheticPreviewOrg(owner, "E2E Missions");
await addMember(org, viewer.id, "viewer");
await createCompany(owner.db, org, { name: "Own Co", website: GOLDEN_WORLD.ownWebsite, isOwnCompany: true });
await updateOwnCompanyProfile(owner.db, org, { ...GOLDEN_WORLD.own, website: GOLDEN_WORLD.ownWebsite });
for (const p of GOLDEN_WORLD.stored) {
  const rr = await startResearchRun(owner.db, org, "basic", p.domain, p.domain);
  await saveIntelligence(owner.db, org, rr, "basic", p, []);
  await finishRun(owner.db, org, rr, { ok: true, domain: p.domain, counters: {} });
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`owner: ${m.text().slice(0, 160)}`));
  page.on("pageerror", (e) => errors.push(`owner: ${e.message.slice(0, 160)}`));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(BASE).origin && !["data:", "blob:"].includes(u.protocol)) outside.add(u.host);
  });
  await signIn(page, owner.email, owner.password);

  // 1. Entry: primary navigation, then delegation with the keyboard only.
  await page.getByRole("navigation", { name: "Main navigation" }).first().getByRole("link", { name: "Missions", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Missions" }).waitFor();
  await page.getByTestId("delegate-form").waitFor();
  await axe(page, "missions (delegate)");
  await page.getByRole("radio", { name: /^Find and research prospects/ }).focus();
  await page.keyboard.press("ArrowLeft");
  if (!(await page.getByRole("radio", { name: /^Find prospects/ }).isChecked())) fail("arrow keys should move between templates");
  await page.keyboard.press("ArrowRight");
  if (!(await page.getByRole("radio", { name: /^Find and research prospects/ }).isChecked())) fail("arrow keys should move back");
  await page.getByTestId("delegate-summary").getByText("rank the best candidates (potential customers), then research the top 2.").waitFor();
  await page.getByTestId("delegate-start").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => /^\/workspace\/missions\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 15_000 });
  const first = new URL(page.url()).pathname.split("/").pop() as string;

  // 2. Reload while the page drives the mission: it resumes where it is and finishes on the briefing.
  await page.getByTestId("mission-live").waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "ORQO Briefing" }).waitFor({ timeout: 90_000 });
  if ((await phase(page)) !== "completed") fail(`expected completed, got ${await phase(page)}`);
  if ((await page.getByTestId("prospect-card").count()) < 1) fail("prospect cards expected");
  if ((await page.getByTestId("prospect-research").count()) !== 2) fail("two researched prospects expected");
  await page.getByTestId("mission-authority").getByText("Free capabilities · $0 paid authority").waitFor();
  await page.getByTestId("mission-authority").getByText("No paid provider was used.").waitFor();
  if (await page.getByTestId("mission-cancel").count()) fail("no Stop on a finished mission");
  const steps = await sql`select count(*)::int as n from public.mission_steps where mission_id = ${first} and status = 'completed'`;
  if (steps[0].n !== 5) fail(`all 5 steps should be completed, got ${steps[0].n}`);
  await page.screenshot({ path: `${OUT}/p17c-briefing.png`, fullPage: true });
  await axe(page, "mission (briefing)");

  // 3. Busy: another agent run of the workspace is in progress → the mission waits (bounded backoff).
  const { data } = await owner.db.rpc("create_agent_mission", { p_organization_id: org, p_agent_id: "research", p_mission_type: "analyze_company", p_capability: "company_research", p_objective: "e2e blocking run", p_input: { target: { query: "x.example" } }, p_autonomy: 1, p_limits: {}, p_idempotency_key: crypto.randomUUID(), p_max_runs: 30, p_window_hours: 24, p_stale_after_seconds: 180 });
  const blocking = (data as { run_id: string }).run_id;
  await page.goto(`${BASE}/workspace/missions`);
  await pick(page, "research_company");
  await page.getByTestId("delegate-start").click();
  await page.getByTestId("delegate-error").getByText("Name a company or choose one from your Network.").waitFor();
  await page.getByLabel("Company website or name").fill("strong.example");
  await page.getByTestId("delegate-summary").getByText("research strong.example and assess the opportunity for your company.").waitFor();
  await page.getByTestId("delegate-start").click();
  await page.waitForURL((u) => /^\/workspace\/missions\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 15_000 });
  await page.getByTestId("mission-driver-note").getByText("Waiting for another task in your workspace to finish…").waitFor({ timeout: 20_000 });
  if ((await phase(page)) !== "researching" && (await phase(page)) !== "preparing") fail(`waiting mission phase: ${await phase(page)}`);
  await cancelRun(owner.db, org, blocking);
  await page.getByRole("heading", { name: "ORQO Briefing" }).waitFor({ timeout: 60_000 });
  console.log("  busy → waiting → completed: ok");

  // 4. Cancellation: confirmation (focus on the safe choice), then Stopped with what was finished.
  const { data: d2 } = await owner.db.rpc("create_agent_mission", { p_organization_id: org, p_agent_id: "research", p_mission_type: "analyze_company", p_capability: "company_research", p_objective: "e2e blocking run 2", p_input: { target: { query: "x.example" } }, p_autonomy: 1, p_limits: {}, p_idempotency_key: crypto.randomUUID(), p_max_runs: 30, p_window_hours: 24, p_stale_after_seconds: 180 });
  const blocking2 = (d2 as { run_id: string }).run_id;
  const stopped = await delegate(page, "prospect_known_candidates");
  await page.getByTestId("mission-cancel").click();
  await page.getByRole("alertdialog", { name: "Stop this mission?" }).waitFor();
  if ((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) !== "mission-cancel-keep") fail("focus should be on Keep working");
  await axe(page, "mission (cancel confirmation)");
  await page.getByTestId("mission-cancel-keep").click();
  if (await page.getByRole("alertdialog").count()) fail("Keep working should close the confirmation");
  await page.getByTestId("mission-cancel").click();
  await page.getByTestId("mission-cancel-confirm-button").click();
  await page.getByRole("heading", { name: "What ORQO finished" }).waitFor({ timeout: 20_000 });
  if ((await phase(page)) !== "cancelled") fail("phase should be Stopped");
  await page.getByText("You stopped the mission before it finished.").waitFor();
  const [m] = await sql`select status from public.missions where id = ${stopped}`;
  if (m.status !== "cancelled") fail(`mission should be cancelled, is ${m.status}`);
  await cancelRun(owner.db, org, blocking2);
  await page.reload();
  if ((await phase(page)) !== "cancelled") fail("cancellation must survive a reload");
  console.log("  cancel (confirm, persisted): ok");

  // 5. Lists: Missions page and Work show the missions.
  await page.goto(`${BASE}/workspace/missions`);
  await page.getByTestId("missions-recent").waitFor();
  if ((await page.getByTestId("mission-row").count()) < 3) fail("three missions expected in the list");
  await page.goto(`${BASE}/workspace`);
  await page.getByTestId("work-missions").getByRole("link", { name: "All missions" }).waitFor();

  // 6. Mobile width: no horizontal overflow on the list and on the briefing.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/workspace/missions", `/workspace/missions/${first}`]) {
    await page.goto(`${BASE}${path}`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await noOverflow(page, `mobile ${path}`);
  }
  await page.screenshot({ path: `${OUT}/p17c-briefing-mobile.png`, fullPage: true });
  await axe(page, "mission (mobile)");
  await context.close();

  // 7. A French viewer follows a finished mission: translated briefing, no Stop, nothing executed.
  const vctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  const vpage = await vctx.newPage();
  vpage.on("console", (m) => m.type() === "error" && errors.push(`viewer: ${m.text().slice(0, 160)}`));
  vpage.on("pageerror", (e) => errors.push(`viewer: ${e.message.slice(0, 160)}`));
  await signIn(vpage, viewer.email, viewer.password);
  await vpage.goto(`${BASE}/workspace/missions/${first}`);
  await vpage.getByRole("heading", { name: "Briefing ORQO" }).waitFor();
  await vpage.getByText("Que faire ensuite").waitFor();
  if (await vpage.getByTestId("mission-cancel").count()) fail("viewer must not see Stop");
  await vpage.goto(`${BASE}/workspace/missions`);
  await vpage.getByTestId("delegate-locked").getByText("Les lecteurs peuvent suivre les missions mais pas les lancer.").waitFor();
  await axe(vpage, "missions (fr viewer)");
  await vctx.close();

  if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
  if (outside.size) fail(`requests outside the app: ${[...outside].join(", ")}`);
  console.log("e2e:missions passed");
} finally {
  await browser.close();
  await cleanupTestData();
}
