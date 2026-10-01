/**
 * Walks the production app in a headless browser against a running server and
 * the real Supabase development project: protected-route redirect, sign in,
 * first workspace, the Phase 2 shell (Search home, six spaces, company profile,
 * Search → Add to Network, locked Pro agent → Plans), persisted companies,
 * Phase 3 company analysis (profile editing, a failure state, ONE real Basic
 * analysis of an official website with streamed stages, evidence, opportunities,
 * stored-result reuse, Add to Network, locked deep research), FR/EN switch,
 * sign out.
 *
 * The real analysis reads a few public pages of one official website (no paid
 * provider is involved). Set E2E_ANALYSIS_DOMAIN to change the target.
 *
 *   bun run e2e:app        (BASE_URL defaults to http://localhost:3100)
 *
 * The test user is created pre-confirmed through the Auth admin API and deleted
 * at the end. The sign-up form is rendered but not submitted: submitting sends a
 * real confirmation email.
 */
import { chromium, type Page } from "playwright";
import { cleanupTestData, createTestUser } from "../tests/support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = ".screenshots";
const errors: string[] = [];
const TARGET = process.env.E2E_ANALYSIS_DOMAIN ?? "gigaio.com";

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/app-${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}

async function expectPath(page: Page, path: string) {
  await page.waitForURL((u) => u.pathname === path, { timeout: 15_000 });
}

await cleanupTestData();
const user = await createTestUser("e2e-app");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/workspace`);
  await expectPath(page, "/login");
  await page.getByRole("heading", { name: "Sign in to ORQO" }).waitFor();
  await shot(page, "01-login-redirect");

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectPath(page, "/onboarding");
  await shot(page, "02-onboarding");

  await page.getByLabel("Workspace name").fill("E2E Workspace");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expectPath(page, "/workspace");
  await page.getByTestId("workspace-name").getByText("E2E Workspace").waitFor();
  await page.getByRole("heading", { name: "What business are you looking for?" }).waitFor();
  await page.getByTestId("plan-badge").getByText("Free").waitFor();
  await shot(page, "03-search-home");

  // Six principal spaces are reachable from the sidebar, each marked as current.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const [label, path, heading] of [
    ["Discover", "/workspace/discover", "Discover"],
    ["Network", "/workspace/network", "Network"],
    ["Intelligence", "/workspace/intelligence", "Intelligence"],
    // Phase 9: "Agents" is the eyebrow; the page heading names the team.
    ["Agents", "/workspace/agents", "Your AI business development team"],
    ["Dashboard", "/workspace/dashboard", "Dashboard"],
    ["Search", "/workspace", "What business are you looking for?"],
  ] as const) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expectPath(page, path);
    await page.getByRole("heading", { level: 1, name: heading }).waitFor();
    if ((await nav.getByRole("link", { name: label, exact: true }).getAttribute("aria-current")) !== "page") throw new Error(`${label} should be the current page`);
    if (path !== "/workspace") await shot(page, `04-space-${label.toLowerCase()}`);
  }

  // Company profile: the reference Search compares with.
  await page.getByRole("link", { name: "Set up company profile" }).click();
  await expectPath(page, "/workspace/company");
  await page.getByLabel("Company name", { exact: true }).fill("E2E Own Co");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await page.getByTestId("own-company").getByText("E2E Own Co").waitFor();
  // Phase 3: the structured profile ORQO compares with.
  const form = page.getByTestId("own-profile-form");
  await form.getByLabel("What your company does (optional)").fill("European manufacturer of rugged servers and edge systems.");
  await form.getByLabel("What you offer").fill("Rugged servers\nODM manufacturing\nSystem integration");
  await form.getByLabel("Target customers").fill("Defense, Industrial");
  await form.getByLabel("Markets").fill("Europe");
  await form.getByLabel("Geographies covered").fill("France, Germany");
  await form.getByLabel("What you are looking for").fill("Composable infrastructure, GPU");
  await form.getByText("Potential supplier").click();
  await form.getByText("OEM / ODM").click();
  await form.getByRole("button", { name: "Save" }).click();
  await form.getByText("Profile saved.").waitFor();
  await page.reload();
  await page.getByTestId("own-company").getByText("Rugged servers, ODM manufacturing, System integration").waitFor();
  await shot(page, "05-company-profile");

  // Search → deterministic target, not in Network → Add to Network → now known.
  await page.goto(`${BASE}/workspace`);
  await page.getByTestId("search-context").getByText("Compared with E2E Own Co").waitFor();
  await page.getByLabel("Company name or website").fill("https://www.e2e-robotics.example.com/about");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByTestId("search-result").getByText("e2e-robotics.example.com").first().waitFor();
  await page.getByText("Not in your Network yet").waitFor();
  await page.getByTestId("research-panel").getByText("Analyze e2e-robotics.example.com").waitFor();
  if ((await page.locator('[data-feature="search.deepResearch"]').getAttribute("data-access")) !== "locked") throw new Error("Deep research must be locked on Free");
  await shot(page, "06-search-result");
  // Failure state: the host does not exist → truthful error, nothing invented.
  await page.getByTestId("run-basic").click();
  await page.getByTestId("research-error").getByText("The website could not be reached or read.").waitFor({ timeout: 30_000 });
  if ((await page.getByTestId("analysis-understanding").count()) !== 0) throw new Error("A failed run must not render an analysis");
  await shot(page, "06b-search-failure");
  await page.getByRole("button", { name: "Add to Network" }).click();
  // The action revalidates the page, which now recognizes the target as known.
  await page.getByText("Already in your Network").waitFor();
  await page.reload();
  await page.getByText("Already in your Network").waitFor();

  await page.goto(`${BASE}/workspace/network`);
  await page.getByTestId("company-list").getByText("e2e-robotics.example.com").first().waitFor();
  await page.getByLabel("Company name", { exact: true }).fill("E2E Robotics");
  await page.getByLabel("Website (optional)").fill("https://e2e.example.com");
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByTestId("company-list").getByText("E2E Robotics").waitFor();
  await page.reload();
  await page.getByTestId("company-list").getByText("E2E Robotics").waitFor();
  await shot(page, "07-company-persisted");

  // Phase 3: one real Basic analysis of an official website, with the server's real stages.
  await page.goto(`${BASE}/workspace?q=${TARGET}`);
  await page.getByTestId("run-basic").click();
  await page.getByTestId("research-progress").waitFor();
  await shot(page, "14-analysis-progress");
  await page.getByTestId("analysis-understanding").waitFor({ timeout: 60_000 });
  await page.getByTestId("research-meta").getByText("Official website only").waitFor();
  await page.getByTestId("analysis-relevance").waitFor();
  const status = await page.getByTestId("analysis-relevance").getAttribute("data-status");
  console.log(`  analysis status for ${TARGET}: ${status}; opportunities: ${await page.getByTestId("opportunity").count()}`);
  await shot(page, "15-analysis-result", true);
  await page.getByTestId("analysis-evidence").locator("summary").click();
  await page.getByTestId("analysis-evidence").getByText("Official site").first().waitFor();
  await page.getByTestId("analysis-unknowns").scrollIntoViewIfNeeded().catch(() => undefined);
  await page.getByTestId("analysis-evidence").scrollIntoViewIfNeeded();
  await shot(page, "16-analysis-evidence");
  // Stored result is reused: reload shows it without running again, and refresh is not offered yet.
  await page.reload();
  await page.getByTestId("research-meta").getByText("Saved in this workspace", { exact: false }).waitFor();
  await page.getByTestId("refresh-later").waitFor();
  // Add the researched company to the Network.
  await page.getByTestId("add-to-network").click();
  await page.getByText("Already in your Network").waitFor();
  // Phase 6 rows show the company name (from its site), not the domain: find it with the Network filter, which
  // matches the website, and require exactly one matching company.
  await page.goto(`${BASE}/workspace/network?q=${encodeURIComponent(TARGET)}`);
  await page.getByTestId("company-list").getByTestId("company-row").first().waitFor();
  if ((await page.getByTestId("company-list").getByTestId("company-row").count()) !== 1) throw new Error(`${TARGET} should appear exactly once in the Network`);

  // Premium agent is visible but locked on Free; its CTA leads to Plans, never to a checkout.
  await page.goto(`${BASE}/workspace/agents`);
  const prospecting = page.locator('[data-feature="agents.prospecting"]');
  if ((await prospecting.getAttribute("data-access")) !== "locked") throw new Error("Prospecting Agent should be locked on Free");
  await prospecting.getByText("Available with Pro").waitFor();
  if ((await page.locator('[data-access="available"], [data-access="executable"]').count()) !== 0) throw new Error("No agent may present as runnable on Free");
  await shot(page, "08-agents-locked");
  await prospecting.getByRole("link", { name: "Upgrade to Pro" }).click();
  await expectPath(page, "/workspace/plans");
  await page.getByText("Current plan").first().waitFor();
  const upgrade = page.getByRole("button", { name: "Upgrades open soon" }).first();
  if (!(await upgrade.isDisabled())) throw new Error("Upgrade must not be actionable without billing");
  await shot(page, "09-plans");

  await page.goto(`${BASE}/workspace/dashboard`);
  await page.getByTestId("next-best-action").getByText("Search a company you have in mind").waitFor();

  await page.goto(`${BASE}/workspace/settings`);
  await page.getByText("Your role: Owner").waitFor();
  await page.getByRole("combobox", { name: "Language" }).selectOption("fr");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { name: "Paramètres" }).waitFor();
  await page.reload();
  await page.getByText("Votre rôle : Propriétaire").waitFor();
  if ((await page.getAttribute("html", "lang")) !== "fr") throw new Error("html lang should be fr after switching language");
  await page.goto(`${BASE}/workspace/agents`);
  await page.locator('[data-feature="agents.prospecting"]').getByText("Disponible avec Pro").waitFor();
  await shot(page, "10-french-agents");
  await page.goto(`${BASE}/workspace`);
  await page.getByRole("heading", { name: "Quel business recherchez-vous ?" }).waitFor();
  await shot(page, "11-french-search");
  await page.goto(`${BASE}/workspace?q=${TARGET}`);
  await page.getByRole("heading", { name: "Ce qu'elle fait" }).waitFor();
  await page.getByTestId("research-meta").getByText("Site officiel uniquement").waitFor();
  await page.getByText("Déjà dans votre Réseau").waitFor();
  await shot(page, "17-french-analysis");

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expectPath(page, "/");
  await page.goto(`${BASE}/workspace`);
  await expectPath(page, "/login");

  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Mot de passe").fill("wrong-password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("alert").getByText("E-mail ou mot de passe incorrect.").waitFor();
  await shot(page, "12-wrong-password-fr");

  await page.goto(`${BASE}/signup`);
  await page.getByRole("heading", { name: "Créer votre compte ORQO" }).waitFor();

  // The compact EN/FR switch on the public home.
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("heading", { name: "Humans create relationships. ORQO discovers what they can become." }).waitFor();

  await page.goto(`${BASE}/demo/connect/r-maya-lukas`);
  await page.getByText("met 6 months ago").waitFor();
  await page.getByText(/Live AI: (sign in to use|no application key configured)/).waitFor();
  await shot(page, "13-demo-signed-out");
} finally {
  await browser.close();
  await cleanupTestData();
}

if (errors.length) {
  console.error(`\n${errors.length} console error(s):\n${[...new Set(errors)].join("\n")}`);
  process.exit(1);
}
console.log("\nProduction app flow passed with no console errors.");
