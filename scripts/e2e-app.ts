/**
 * Walks the Phase 1 production app in a headless browser against a running
 * server and the real Supabase development project: protected-route redirect,
 * sign in, first workspace, persisted company, FR/EN switch, sign out.
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
  await page.getByText("Your role: Owner").waitFor();
  await shot(page, "03-workspace");

  await page.getByLabel("Company name").fill("E2E Robotics");
  await page.getByLabel("Website (optional)").fill("https://e2e.example.com");
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByTestId("company-list").getByText("E2E Robotics").waitFor();
  await page.reload();
  await page.getByTestId("company-list").getByText("E2E Robotics").waitFor();
  await shot(page, "04-company-persisted");

  await page.getByLabel("Language").selectOption("fr");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Entreprises").first().waitFor();
  await page.reload();
  await page.getByText("Votre rôle : Propriétaire").waitFor();
  if ((await page.getAttribute("html", "lang")) !== "fr") throw new Error("html lang should be fr after switching language");
  await shot(page, "05-french");

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expectPath(page, "/");
  await page.goto(`${BASE}/workspace`);
  await expectPath(page, "/login");

  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Mot de passe").fill("wrong-password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("alert").getByText("E-mail ou mot de passe incorrect.").waitFor();
  await shot(page, "06-wrong-password-fr");

  await page.goto(`${BASE}/signup`);
  await page.getByRole("heading", { name: "Créer votre compte ORQO" }).waitFor();

  await page.goto(`${BASE}/demo/connect/r-maya-lukas`);
  await page.getByText("met 6 months ago").waitFor();
  await page.getByText(/Live AI: (sign in to use|no application key configured)/).waitFor();
  await shot(page, "07-demo-signed-out");
} finally {
  await browser.close();
  await cleanupTestData();
}

if (errors.length) {
  console.error(`\n${errors.length} console error(s):\n${[...new Set(errors)].join("\n")}`);
  process.exit(1);
}
console.log("\nProduction app flow passed with no console errors.");
