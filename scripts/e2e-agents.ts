/**
 * Walks the Phase 4 Agents UI in a headless browser against a running server
 * started with ORQO_AGENT_PREVIEW_ORGS=<E2E_AGENT_PREVIEW_ORG>:
 * preview catalog, Research Agent mission (stored research reused — no web
 * fetch, no provider), run detail with real steps, recent runs, a failed run,
 * an approval request rejected from the UI, the Partnership Manager path,
 * French, and the locked Free state.
 *
 *   E2E_AGENT_PREVIEW_ORG=<uuid> bun run e2e:agents   (BASE_URL defaults to http://localhost:3100)
 *
 * Test users are created pre-confirmed through the Auth admin API and deleted
 * at the end.
 */
import { chromium, type Page } from "playwright";
import { AGENT_REGISTRY } from "../src/lib/agents/registry";
import { extractTargetProfile } from "../src/lib/intelligence/extract";
import { FIXTURE_ABOUT, FIXTURE_HOME } from "../src/lib/intelligence/fixtures";
import { parseHtml } from "../src/lib/intelligence/html";
import { createCompany, updateOwnCompanyProfile } from "../src/lib/server/repositories/companies";
import { createOrganization } from "../src/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "../src/lib/server/research/repository";
import { addMember, cleanupTestData, createTestUser, sql, type TestUser } from "../tests/support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = ".screenshots";
const ORG = process.env.E2E_AGENT_PREVIEW_ORG ?? "a4a4a4a4-0000-4000-8000-000000000004";
const DOMAIN = "nimbusfabric.example";
const errors: string[] = [];

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/agents-${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}

async function signIn(page: Page, user: TestUser) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname === "/workspace", { timeout: 15_000 });
}

async function runMission(page: Page, opts: { target?: string; network?: string; autonomy?: string; mission?: string }) {
  if (opts.mission) await page.getByTestId("mission-form").locator("select").first().selectOption(opts.mission);
  if (opts.target) await page.getByTestId("mission-form").locator('input[name="target"]').fill(opts.target);
  if (opts.network) await page.getByTestId("mission-form").locator('select[name="company"]').selectOption({ label: opts.network });
  if (opts.autonomy) await page.getByTestId("mission-form").locator('select[name="autonomy"]').selectOption(opts.autonomy);
  await page.getByTestId("run-mission").click();
  await page.waitForURL(/\/workspace\/agents\/runs\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.getByTestId("run-header").waitFor();
}

await cleanupTestData();
const owner = await createTestUser("e2e-agents");
const free = await createTestUser("e2e-agents-free");

// Preview workspace with an own profile, a Network company and stored research (fixture pages, no fetch).
await sql`delete from public.organizations where id = ${ORG}`;
await sql`insert into public.organizations (id, name, created_by) values (${ORG}, 'Agents Preview', ${owner.id})`;
await addMember(ORG, owner.id, "owner");
await createCompany(owner.db, ORG, { name: "Rugged Integrations", isOwnCompany: true });
await updateOwnCompanyProfile(owner.db, ORG, { name: "Rugged Integrations", website: null, summary: "We integrate and test rugged servers", offerings: ["System integration", "Testing and validation", "Rugged servers"], customerSegments: ["Defense"], markets: ["Defense"], geographies: ["France", "Germany"], soughtCapabilities: ["GPU fabric"], partnershipGoals: ["oem", "integration", "supplier"] });
await createCompany(owner.db, ORG, { name: "NimbusFabric", website: `https://${DOMAIN}` });
const now = new Date();
const src = (key: string, url: string, pageType: "home" | "about") => ({ key, url, title: url, authority: "official" as const, pageType, retrievedAt: now.toISOString() });
const profile = extractTargetProfile({ nameHint: null, domain: DOMAIN, website: `https://${DOMAIN}`, resolution: { method: "url", confidence: "strong" }, pages: [{ doc: parseHtml(FIXTURE_HOME, `https://${DOMAIN}/`), source: src("s0", `https://${DOMAIN}/`, "home") }, { doc: parseHtml(FIXTURE_ABOUT, `https://${DOMAIN}/about`), source: src("s1", `https://${DOMAIN}/about`, "about") }], now });
const rr = await startResearchRun(owner.db, ORG, "basic", DOMAIN, DOMAIN);
await saveIntelligence(owner.db, ORG, rr, "basic", profile, []);
await finishRun(owner.db, ORG, rr, { ok: true, domain: DOMAIN, counters: {} });
await createOrganization(free.db, { name: "Free Workspace" });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, owner);

  // Catalog: preview-enabled agents are executable, others stay truthful.
  await page.goto(`${BASE}/workspace/agents`);
  await page.getByTestId("agent-preview-note").waitFor();
  for (const [id, state] of [["research", "executable"], ["partnership", "executable"], ["prospecting", "locked"], ["orchestrator", "locked"]] as const) {
    const got = await page.locator(`[data-agent="${id}"]`).getAttribute("data-access");
    if (got !== state) throw new Error(`${id} should be ${state}, got ${got}`);
  }
  await page.getByTestId("agent-hierarchy").waitFor();
  await shot(page, "01-catalog-preview");

  // Research Agent mission → completed run reusing stored research.
  await page.getByTestId("start-research").click();
  await page.waitForURL(`${BASE}/workspace/agents/research`);
  await page.getByTestId("mission-form").locator('input[name="target"]').fill(DOMAIN);
  await page.getByTestId("mission-summary").getByText(DOMAIN).waitFor();
  await shot(page, "02-mission-form");
  await runMission(page, {});
  await page.locator('[data-run-status="completed"]').waitFor();
  await page.getByTestId("run-result").getByText("Reused stored research", { exact: false }).waitFor();
  if ((await page.getByTestId("run-steps").locator("li").count()) !== 6) throw new Error("expected 6 steps");
  await page.getByTestId("run-steps").locator('[data-step="run_research"][data-state="skipped"]').waitFor();
  await page.getByTestId("run-next-action").waitFor();
  await page.getByTestId("run-usage").getByText("No paid provider was used.").waitFor();
  await shot(page, "03-run-completed");

  // Failed state: Observe cannot fetch the web and nothing is stored.
  await page.goto(`${BASE}/workspace/agents/research`);
  await runMission(page, { target: "unknown-target.example", autonomy: "0" });
  await page.locator('[data-run-status="failed"]').waitFor();
  await page.getByTestId("run-failure").getByText("Observe autonomy cannot fetch the web").waitFor();
  await shot(page, "04-run-failed");

  // Partnership Manager: explain stored analysis for a Network company.
  await page.goto(`${BASE}/workspace/agents/partnership`);
  await runMission(page, { network: "NimbusFabric" });
  await page.locator('[data-run-status="completed"]').waitFor();
  await shot(page, "05-partnership-run");

  // Approval gate UI: a run waiting for approval (created through the real RPCs), rejected from the page.
  const { data: created, error: createErr } = await owner.db.rpc("create_agent_mission", { p_organization_id: ORG, p_agent_id: "research", p_mission_type: "analyze_company", p_capability: "company_research", p_objective: "analyze_company · deep.example", p_input: { target: { query: "deep.example" }, depth: "deep", refresh: false }, p_autonomy: 2, p_limits: AGENT_REGISTRY.research.limits, p_idempotency_key: crypto.randomUUID(), p_max_runs: 30, p_window_hours: 24, p_stale_after_seconds: 180 });
  if (createErr) throw new Error(`create_agent_mission: ${createErr.code}`);
  const waitingRun = (created as { run_id: string }).run_id;
  const started = await owner.db.from("agent_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", waitingRun);
  if (started.error) throw new Error(`start run: ${started.error.code}`);
  const missionStarted = await owner.db.from("agent_missions").update({ status: "running", started_at: new Date().toISOString() }).eq("id", (created as { mission_id: string }).mission_id);
  if (missionStarted.error) throw new Error(`start mission: ${missionStarted.error.code}`);
  const requested = await owner.db.rpc("request_agent_approval", { p_organization_id: ORG, p_run_id: waitingRun, p_tool_id: "deep_company_research", p_action: { toolId: "deep_company_research" }, p_ttl_hours: 24 });
  if (requested.error) throw new Error(`request_agent_approval: ${requested.error.code}`);
  await page.goto(`${BASE}/workspace/agents/runs/${waitingRun}`);
  await page.getByTestId("run-approval").waitFor();
  await page.locator('[data-run-status="waiting_for_approval"]').waitFor();
  await shot(page, "06-approval-waiting");
  await page.getByTestId("reject").click();
  await page.locator('[data-run-status="cancelled"]').waitFor();
  await page.getByTestId("run-failure").getByText("The action was rejected.").waitFor();
  await shot(page, "07-approval-rejected");

  // Recent runs.
  await page.goto(`${BASE}/workspace/agents`);
  if ((await page.getByTestId("agent-runs").locator("tbody tr").count()) !== 4) throw new Error("expected 4 runs");
  await shot(page, "08-recent-runs");

  // French.
  await page.goto(`${BASE}/workspace/settings`);
  await page.getByRole("combobox", { name: "Language" }).selectOption("fr");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { name: "Paramètres" }).waitFor();
  await page.goto(`${BASE}/workspace/agents`);
  await page.getByText("Exécutions récentes").waitFor();
  await page.getByTestId("agent-preview-note").getByText("avant-première", { exact: false }).waitFor();
  await shot(page, "09-catalog-fr");
  await page.getByTestId("agent-runs").getByRole("link", { name: "Voir →" }).last().click();
  await page.getByText("Étapes").first().waitFor();
  await page.getByText("Prochaine action").waitFor();
  await shot(page, "10-run-fr");
  await page.goto(`${BASE}/workspace/agents/research`);
  await page.getByText("Nouvelle mission").waitFor();
  await shot(page, "11-mission-form-fr");
  await page.getByRole("button", { name: "Se déconnecter" }).click();

  // Free workspace: locked, no mission entry point.
  const freePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  freePage.on("pageerror", (e) => errors.push(e.message));
  await signIn(freePage, free);
  await freePage.goto(`${BASE}/workspace/agents`);
  if ((await freePage.locator('[data-access="executable"]').count()) !== 0) throw new Error("Free must not have executable agents");
  if ((await freePage.locator('[data-agent="research"]').getAttribute("data-access")) !== "locked") throw new Error("Research Agent must be locked on Free");
  await shot(freePage, "12-free-locked");
  await freePage.goto(`${BASE}/workspace/agents/research`);
  if ((await freePage.getByTestId("mission-form").count()) !== 0) throw new Error("Free must not see a mission form");
  await freePage.locator('[data-agent="research"]').getByText("Available with Pro").waitFor();
  await shot(freePage, "13-free-agent-locked");

  if (errors.length > 0) throw new Error(`Console errors:\n${errors.join("\n")}`);
  console.log("Agents E2E passed.");
} finally {
  await browser.close();
  await cleanupTestData();
  await sql.close();
}
