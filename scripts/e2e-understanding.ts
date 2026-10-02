/**
 * Phase 14 browser walk-through: low-input company understanding.
 *
 * Sign in → workspace → own company with NAME + WEBSITE only → "read my
 * company" (ONE real Basic analysis of a public official website: a few page
 * fetches, no paid provider) → Business DNA with fact / inference labels and
 * evidence → how the market works → the one question → answer, confirm and
 * reject persist → mobile layout without horizontal scroll → French.
 * Console errors, failed requests and unlabeled controls fail the run.
 *
 *   bun run test:isolated e2e:understanding   (BASE_URL defaults to http://localhost:3100)
 */
import { chromium, type Page } from "playwright";
import { cleanupTestData, createTestUser } from "../tests/support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = ".screenshots";
const TARGET = process.env.E2E_ANALYSIS_DOMAIN ?? "gigaio.com";
const errors: string[] = [];

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/understanding-${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}

async function expectPath(page: Page, path: string) {
  await page.waitForURL((u) => u.pathname === path, { timeout: 15_000 });
}

/** Every visible button, link and form control has an accessible name. */
async function assertLabeled(page: Page) {
  const unlabeled = await page.evaluate(() => {
    const els = [...document.querySelectorAll("main button, main a[href], main input:not([type=hidden]), main select, main textarea")] as HTMLElement[];
    return els
      .filter((el) => el.offsetParent !== null)
      .filter((el) => {
        const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
        const text = (el.textContent ?? "").trim();
        const label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
        return !aria && !text && !label && !el.closest("label") && !(el as HTMLInputElement).value;
      })
      .map((el) => el.outerHTML.slice(0, 120));
  });
  if (unlabeled.length) throw new Error(`Unlabeled controls: ${unlabeled.join(" | ")}`);
}

await cleanupTestData();
const user = await createTestUser("e2e-understanding");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => {
    if (!r.url().startsWith(BASE)) return;
    // Navigations cancelled by a refresh are not failures.
    if (r.failure()?.errorText.includes("ERR_ABORTED")) return;
    errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`);
  });

  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectPath(page, "/onboarding");
  await page.getByLabel("Workspace name").fill("E2E Understanding");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expectPath(page, "/workspace");

  // Low input: name + website only.
  await page.goto(`${BASE}/workspace/company`);
  await page.getByText("Your name and website are enough").waitFor();
  if ((await page.getByLabel("What your company does (optional)").count()) !== 0) throw new Error("Onboarding must not ask for a description ORQO can read");
  await page.getByLabel("Company name", { exact: true }).fill("E2E Reader Co");
  await page.getByLabel("Website", { exact: true }).fill(`https://${TARGET}`);
  await page.getByRole("button", { name: "Save company profile" }).click();
  await page.getByTestId("own-company").getByText("E2E Reader Co").waitFor();
  await page.getByTestId("business-dna").getByText("Let ORQO read your company").waitFor();
  if ((await page.getByTestId("market-model").count()) !== 0) throw new Error("No market model before any evidence");
  if ((await page.getByTestId("next-question-card").count()) !== 0) throw new Error("No question before ORQO has read anything");
  await assertLabeled(page);
  await shot(page, "01-not-analyzed");

  // One real Basic read of the official site (free path only: deep research is not offered here).
  if ((await page.getByTestId("run-deep").count()) !== 0) throw new Error("The company page must only offer the free Basic read");
  await page.getByTestId("run-basic").click();
  await page.getByTestId("research-progress").waitFor();
  await page.getByTestId("dna-item").first().waitFor({ timeout: 90_000 });
  await page.getByTestId("market-model").waitFor();
  const states = await page.getByTestId("dna-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  if (!states.includes("fact") || !states.includes("inference")) throw new Error(`Expected both facts and inferences, got ${[...new Set(states)].join(",")}`);
  const coverage = await page.getByTestId("market-model").getAttribute("data-coverage");
  const marketStates = await page.getByTestId("market-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  console.log(`  ${TARGET}: ${states.length} DNA items, market coverage ${coverage}, ${marketStates.length} market entries (${marketStates.filter((s) => s === "inference").length} evidence-backed)`);
  if (coverage === "insufficient" || marketStates.length === 0) throw new Error("A readable official site should give at least a partial market model");
  await page.getByTestId("business-dna").getByText("Evidence").first().click();
  await page.getByTestId("business-dna").getByRole("link", { name: "Source page" }).first().waitFor();
  await assertLabeled(page);
  await shot(page, "02-dna", true);

  // The one question: answer it; it is replaced, and the answer appears as stated by the user.
  const card = page.getByTestId("next-question-card");
  if ((await card.count()) === 1) {
    const prompt = await card.locator("legend").innerText();
    await card.locator('input[name="values"]').first().check();
    await card.getByRole("button", { name: "Save answer" }).click();
    await page.waitForFunction((p) => !document.querySelector('[data-testid="next-question-card"] legend') || document.querySelector('[data-testid="next-question-card"] legend')!.textContent !== p, prompt, { timeout: 15_000 });
    await page.getByTestId("business-dna").getByText("Stated by you").first().waitFor();
    console.log(`  answered: "${prompt}"`);
  } else console.log("  no open question for this company");

  // Confirm one inference, reject another; both persist across a reload.
  const inferences = page.locator('[data-testid="dna-item"][data-state="inference"]');
  await inferences.first().getByRole("button", { name: "Confirm" }).click();
  await page.getByTestId("business-dna").getByText("Confirmed by you").first().waitFor();
  const victim = page.locator('[data-testid="dna-item"][data-state="inference"]').last();
  const victimText = (await victim.locator("p").first().innerText()).trim();
  await victim.getByRole("button", { name: "Not right" }).click();
  await page.getByTestId("business-dna").getByText("You marked as not right").waitFor();
  await page.reload();
  await page.getByTestId("business-dna").getByText("Confirmed by you").first().waitFor();
  await page.getByTestId("business-dna").getByText("You marked as not right").waitFor();
  if (!(await page.getByTestId("business-dna").getByText("You marked as not right").innerText()).includes(victimText.slice(0, 20))) throw new Error("The rejected item should be listed as not right");
  await shot(page, "03-validated");

  // Mobile: same page, no horizontal scroll, large enough targets.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByTestId("business-dna").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Horizontal scroll on mobile: ${overflow}px`);
  const small = await page.locator('[data-testid="dna-item"] button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 32).length);
  if (small > 0) throw new Error(`${small} validation buttons are smaller than 32px on mobile`);
  await shot(page, "04-mobile", true);

  // French.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/workspace/settings`);
  await page.getByLabel("Language").selectOption("fr");
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.goto(`${BASE}/workspace/company`);
  await page.getByText("Ce qu'ORQO comprend de votre entreprise").waitFor();
  await page.getByText("Comment fonctionne votre marché").waitFor();
  await shot(page, "05-french");

  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log("e2e:understanding passed");
} finally {
  await browser.close();
  await cleanupTestData();
}
