/**
 * Walks the production app in a headless browser against a running server and
 * the real Supabase development project: protected-route redirect, sign in,
 * first workspace, the Phase 2 shell (Search home, six spaces, company profile,
 * Search → Add to Network, locked Pro agent → Plans), persisted companies,
 * FR/EN switch, sign out.
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

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/app-${name}.png` });
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
    ["Agents", "/workspace/agents", "Agents"],
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
  await shot(page, "05-company-profile");

  // Search → deterministic target, not in Network → Add to Network → now known.
  await page.goto(`${BASE}/workspace`);
  await page.getByTestId("search-context").getByText("Compared with E2E Own Co").waitFor();
  await page.getByLabel("Company name or website").fill("https://www.e2e-robotics.example.com/about");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByTestId("search-result").getByText("e2e-robotics.example.com").first().waitFor();
  await page.getByText("Not in your Network yet").waitFor();
  await page.getByTestId("analysis-preview").getByText("Coming soon", { exact: true }).waitFor();
  await shot(page, "06-search-result");
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

  // Premium agent is visible but locked on Free; its CTA leads to Plans, never to a checkout.
  await page.goto(`${BASE}/workspace/agents`);
  const prospecting = page.locator('[data-feature="agents.prospecting"]');
  if ((await prospecting.getAttribute("data-access")) !== "locked") throw new Error("Prospecting Agent should be locked on Free");
  await prospecting.getByText("Available with Pro").waitFor();
  if ((await page.locator('[data-access="available"]').count()) !== 0) throw new Error("No agent may present as runnable in Phase 2");
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
