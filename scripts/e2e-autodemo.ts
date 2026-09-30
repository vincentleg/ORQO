/**
 * End-to-end test for Auto Demo. Needs the dev server running.
 *   bun run e2e:autodemo
 * Screenshots → .screenshots/auto-*.png
 */
import { chromium, type Page } from "playwright";

// The demo is mounted under /demo since Phase 1; BASE_URL stays the server origin.
const BASE = `${process.env.BASE_URL ?? "http://localhost:3000"}/demo`;
const OUT = ".screenshots";
const errors: string[] = [];
const log = (m: string) => console.log(m);

async function openSelector(page: Page) {
  await page.getByRole("button", { name: "Play demo" }).click();
  await page.getByRole("dialog", { name: "ORQO demo" }).waitFor();
}

async function play(page: Page, title: string) {
  await openSelector(page);
  await page.getByRole("dialog").getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "▶ PLAY DEMO" }).click();
}

async function sceneLabel(page: Page) {
  return (await page.getByTestId("demo-controls").textContent()) ?? "";
}

/** Plays until the finale, screenshotting every `every` ms. Returns elapsed seconds. */
async function runToFinale(page: Page, prefix: string, every = 6000, timeoutMs = 240_000) {
  // A previous run's finale fades out; wait for it before timing the new one.
  await page.getByTestId("demo-finale").waitFor({ state: "hidden", timeout: 10_000 });
  const start = Date.now();
  let n = 0;
  while (!(await page.getByTestId("demo-finale").isVisible())) {
    if (Date.now() - start > timeoutMs) throw new Error(`${prefix}: no finale after ${timeoutMs / 1000}s`);
    if (Date.now() - start >= n * every) {
      await page.screenshot({ path: `${OUT}/${prefix}-${String(n).padStart(2, "0")}.png` });
      n++;
    }
    await page.waitForTimeout(250);
  }
  const secs = (Date.now() - start) / 1000;
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${prefix}-final.png` });
  return secs;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE);
await page.getByText("ORQO finds the business").first().waitFor();

// Scenario 1 — primary.
await play(page, "European Edge AI Expansion");
const s1 = await runToFinale(page, "auto-s1");
await page.getByText("You meet the person. ORQO finds the business.").waitFor();
await page.getByText("European Edge AI Appliance Program").first().waitFor();
if (!page.url().includes("/network")) throw new Error(`S1 should end on the graph, ended on ${page.url()}`);
log(`✓ Scenario 1 finished in ${s1.toFixed(1)}s`);

// Replay Scenario 1 from its finished state.
await page.mouse.move(700, 500);
await page.getByRole("button", { name: "Replay" }).click();
await page.waitForTimeout(3000);
if (!(await sceneLabel(page)).includes("Scene 1")) throw new Error("Replay did not restart at scene 1");
const s1b = await runToFinale(page, "auto-s1-replay", 60_000);
const graphNodes = await page.locator("text=European Edge AI Appliance Program").count();
if (graphNodes < 1) throw new Error("Replay final graph missing 3-way opportunity");
log(`✓ Scenario 1 replay finished in ${s1b.toFixed(1)}s`);

// Scenario 2 — with a pause/resume check.
await page.mouse.move(700, 520);
await page.getByRole("button", { name: "Choose another scenario" }).click();
await page.getByRole("dialog").getByText("Dormant Relationship Becomes Valuable", { exact: true }).click();
await page.getByRole("button", { name: "▶ PLAY DEMO" }).click();
await page.waitForTimeout(6000);
await page.keyboard.press("Space");
const pausedAt = await sceneLabel(page);
const url = page.url();
await page.waitForTimeout(7000);
if ((await sceneLabel(page)) !== pausedAt || page.url() !== url) throw new Error("Pause did not hold playback");
if (!pausedAt.includes("Resume") && !(await page.getByRole("button", { name: "Resume" }).isVisible())) throw new Error("Paused controls not shown");
await page.keyboard.press("Space");
const s2 = await runToFinale(page, "auto-s2");
await page.getByText("Meet once. ORQO keeps looking.").first().waitFor();
if (!page.url().includes("opp-channel-distribution")) throw new Error(`S2 should end on the new opportunity, ended on ${page.url()}`);
log(`✓ Scenario 2 finished in ${s2.toFixed(1)}s (incl. 7s pause)`);

// Scenario 3.
await page.mouse.move(700, 540);
await page.getByRole("button", { name: "Choose another scenario" }).click();
await page.getByRole("dialog").getByText("Multi-Company Opportunity Graph", { exact: true }).click();
await page.getByRole("button", { name: "▶ PLAY DEMO" }).click();
const s3 = await runToFinale(page, "auto-s3");
await page.getByText("Your network is not a list of contacts.").waitFor();
await page.getByText("European Edge AI Appliance Program").first().waitFor();
log(`✓ Scenario 3 finished in ${s3.toFixed(1)}s`);

// Exit midway, then verify the manual app recovers.
await page.keyboard.press("Escape");
await play(page, "European Edge AI Expansion");
await page.waitForTimeout(16_000);
await page.keyboard.press("Escape");
await page.waitForTimeout(3000);
if (await page.getByTestId("demo-controls").isVisible()) throw new Error("Exit did not close Auto Demo");
await page.getByRole("link", { name: /DEMO \d\/8/ }).waitFor();
await page.getByRole("button", { name: "Reset demo" }).click();
await page.goto(BASE);
await page.getByRole("link", { name: "Connect agents" }).first().waitFor();
await page.getByRole("link", { name: /DEMO 1\/8/ }).waitFor();
log("✓ Exit midway + manual Reset recovered the initial state");

// Restart mid-run lands back on scene 1 with a clean state.
await play(page, "European Edge AI Expansion");
await page.waitForTimeout(24_000);
await page.keyboard.press("r");
await page.waitForTimeout(2500);
if (!(await sceneLabel(page)).includes("Scene 1")) throw new Error("Restart did not return to scene 1");
await page.keyboard.press("Escape");
log("✓ Restart mid-run returns to scene 1");

// Refresh during playback must not break anything.
await play(page, "Multi-Company Opportunity Graph");
await page.waitForTimeout(5000);
await page.reload();
await page.getByText("ORQO").first().waitFor();
await page.waitForTimeout(1500);
if (await page.getByTestId("demo-controls").isVisible()) throw new Error("Auto Demo should not survive a refresh");
await play(page, "Multi-Company Opportunity Graph");
await runToFinale(page, "auto-s3-after-refresh", 60_000);
await page.keyboard.press("Escape");
log("✓ Refresh mid-run, then replay, works");

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} console error(s):\n${[...new Set(errors)].join("\n")}`);
  process.exit(1);
}
console.log("\nAuto Demo passed with no console errors.");
