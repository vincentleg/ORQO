/**
 * Walks the full ORQO demo in a headless browser, asserting each magic moment
 * and saving screenshots to .screenshots/. Run with the dev server up:
 *   bun run e2e            (BASE_URL defaults to http://localhost:3000)
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = ".screenshots";
const errors: string[] = [];

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`✓ ${name}`);
}

async function expectText(page: Page, text: string, timeout = 15_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE);
await expectText(page, "ORQO finds the business");
await shot(page, "01-overview");

await page.getByRole("link", { name: "Connect agents" }).first().click();
await expectText(page, "met 6 months ago");
await shot(page, "02-connect-idle");
await page.getByRole("button", { name: "Connect agents" }).click();
await page.waitForTimeout(2600);
await shot(page, "03-connect-running");
await expectText(page, "Review opportunity", 20_000);
await shot(page, "04-connect-discovered");

await page.getByRole("link", { name: "Review opportunity" }).click();
await page.waitForURL(/\/opportunities\/opp-/);
await expectText(page, "Bilateral consent");
await shot(page, "05-opportunity");
await page.mouse.wheel(0, 1400);
await shot(page, "06-opportunity-evidence");
await page.mouse.wheel(0, -3000);

await page.getByRole("button", { name: "Interested", exact: true }).click();
await expectText(page, "Your response is private");
await shot(page, "07-consent-maya");
await page.getByRole("button", { name: /View as Lukas/ }).click();
await expectText(page, "Awaiting you");
await page.getByRole("button", { name: "Interested", exact: true }).click();
await expectText(page, "It's a Business Match");
await page.waitForTimeout(1200);
await shot(page, "08-business-match");
await page.getByRole("button", { name: "Open meeting brief" }).click();
await expectText(page, "Meeting objective");
await shot(page, "09-meeting-brief");

await page.goto(`${BASE}/signals`);
await page.getByRole("button", { name: "FAST FORWARD +6 MONTHS" }).click();
await expectText(page, "New signal detected", 10_000);
await shot(page, "10-signal");
await page.getByRole("button", { name: /Re-evaluate affected relationships/ }).click();
await expectText(page, "New opportunity found", 10_000);
await page.waitForTimeout(3500);
await shot(page, "11-new-opportunity");
await page.getByText("Another company in your network could strengthen this opportunity.").first().scrollIntoViewIfNeeded();
await shot(page, "12-network-search");

await page.getByRole("link", { name: /Bring SecureChannel into the graph/ }).click();
await expectText(page, "CREATE 3-WAY OPPORTUNITY");
await shot(page, "13-graph-proposal");
await page.getByRole("button", { name: "CREATE 3-WAY OPPORTUNITY" }).click();
await expectText(page, "3-way opportunity created");
await page.waitForTimeout(1200);
await shot(page, "14-graph-3way");
await page.getByRole("link", { name: /Open 3-way opportunity/ }).click();
await expectText(page, "European Edge AI Appliance Program");
await shot(page, "15-3way-detail");

for (const path of ["/", "/opportunities", "/agent", "/agent/p-sophie", "/connect/r-maya-sophie", "/network"]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(700);
  await shot(page, `route${path.replaceAll("/", "_") || "_root"}`);
}

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} console error(s):\n${[...new Set(errors)].join("\n")}`);
  process.exit(1);
}
console.log("\nDemo flow passed with no console errors.");
