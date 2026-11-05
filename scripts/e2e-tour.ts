/**
 * Acceptance test of the public guided tour (Nov 2026). Browser only; works on any deployment.
 *
 *   BASE_URL=https://orqo-jet.vercel.app bun scripts/e2e-tour.ts            (fast: playback ×6 via the test hook)
 *   TOUR_REALTIME=1 BASE_URL=… bun scripts/e2e-tour.ts                        (the real 5-second pacing, 60 seconds)
 *
 * Mandatory journey: home page → ONE click on "Open the demo" → nothing else. The test then only observes:
 * every scene and all 14 stages appear in order with the script's title, explanation and action; each scene's
 * progress bar fills; the virtual cursor lands on the scene's semantic target; the company analysis,
 * comparison, compatibility, synergy (dossier), critic, graph, proposal and plan appear; the final screen is
 * reached by itself. Throughout: no console error, no POST request, no /api call, no session cookie.
 * Then: pause/resume, back/skip, replay, mobile (390 px, no horizontal overflow) and reduced motion.
 */
import { chromium, type Browser, type Page } from "playwright";
import { SCENES, STAGES } from "../src/lib/tour/script";
/** Optional: Vercel "Protection Bypass for Automation" secret, to test a protected preview deployment (never printed). */
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const BYPASS_HEADERS = BYPASS ? { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" } : undefined;

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const REALTIME = process.env.TOUR_REALTIME === "1";
const OUT = ".screenshots";

function fail(m: string): never {
  throw new Error(m);
}

interface Watch {
  errors: string[];
  posts: string[];
  api: string[];
}
function watch(page: Page): Watch {
  const w: Watch = { errors: [], posts: [], api: [] };
  page.on("console", (m) => m.type() === "error" && w.errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => w.errors.push(e.message.slice(0, 200)));
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/csp-report") {
      // A CSP violation fails the test — except Vercel's own toolbar, injected into preview deployments only.
      let rep: Record<string, string> = {};
      try {
        const body = JSON.parse(r.postData() ?? "{}");
        rep = body["csp-report"] ?? body.body ?? body;
      } catch {
        // unreadable report: counted below
      }
      const blocked = String(rep["blocked-uri"] ?? rep.blockedURL ?? "?");
      if (!blocked.includes("vercel.live")) w.errors.push(`CSP violation: ${rep["violated-directive"] ?? rep.effectiveDirective ?? "?"} blocked ${blocked} on ${rep["document-uri"] ?? rep.documentURL ?? "?"}`);
      return;
    }
    if (r.method() !== "GET" && r.method() !== "HEAD") w.posts.push(`${r.method()} ${r.url()}`);
    if (new URL(r.url()).pathname.startsWith("/api/")) w.api.push(r.url());
  });
  return w;
}
const attr = (page: Page, name: string) => page.getAttribute('[data-testid="tour"]', name);

/** Cursor point and target rect, both relative to the stage. */
async function cursorOnTarget(page: Page): Promise<{ ok: boolean; detail: string }> {
  return page.evaluate(() => {
    const cursor = document.querySelector<HTMLElement>('[data-testid="tour-cursor"]');
    const stage = cursor?.parentElement;
    const sel = cursor?.dataset.target;
    const target = sel && stage ? stage.querySelector<HTMLElement>(sel) : null;
    if (!cursor || !stage || !target) return { ok: false, detail: `missing ${sel}` };
    const c = cursor.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const tol = 24;
    const ok = c.left >= t.left - tol && c.left <= t.right + tol && c.top >= t.top - tol && c.top <= t.bottom + tol;
    return { ok, detail: `${sel} cursor(${Math.round(c.left)},${Math.round(c.top)}) target(${Math.round(t.left)},${Math.round(t.top)},${Math.round(t.right)},${Math.round(t.bottom)})` };
  });
}

/** Expected content per scene id: the result that must be visible in the stage. */
const RESULTS: Record<string, string> = {
  company: '[data-testid="business-dna"]',
  discovery: '[data-tour="search"]',
  research: '[data-testid="analysis-understanding"]',
  comparison: '[data-testid="company-comparison"]',
  compatibility: '[data-tour="dimensions"]',
  synergy: '[data-testid="scenario"]',
  agents: '[data-tour="agents-list"]',
  critic: '[data-tour="critic-rejected"]',
  graph: '[data-map-node="scenario"]',
  proposal: '[data-section="what"]',
  end: '[data-tour="cta"]',
};

async function fullRun(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: BYPASS_HEADERS });
  const page = await ctx.newPage();
  const w = watch(page);
  await page.goto(`${BASE}/`);
  // The ONLY interaction of the whole run.
  await page.getByRole("link", { name: /open the demo/i }).first().click();
  await page.waitForURL((u) => u.pathname === "/tour", { timeout: 20_000 });
  if (!REALTIME) {
    // Test hook: same tour, faster clock (a reload is navigation, not interaction with the tour).
    await page.goto(`${BASE}/tour?speed=6`);
  }
  const started = Date.now();
  const seen: string[] = [];
  const stagesSeen = new Set<number>();
  let lastIndex = -1;
  const deadline = started + (REALTIME ? 120_000 : 60_000);
  while (Date.now() < deadline) {
    const idx = Number(await attr(page, "data-scene-index"));
    if (idx !== lastIndex) {
      if (idx !== lastIndex + 1) fail(`scene order broken: ${lastIndex} → ${idx}`);
      lastIndex = idx;
      const sc = SCENES[idx];
      seen.push(sc.id);
      stagesSeen.add(sc.stage);
      const [title, body, action, stageNo, stageTitle] = await Promise.all(["tour-title", "tour-body", "tour-action", "tour-stage-number", "tour-stage-title"].map((id) => page.getByTestId(id).innerText()));
      if (title.trim() !== sc.title) fail(`scene ${sc.id}: title "${title}"`);
      if (body.trim() !== sc.body) fail(`scene ${sc.id}: body mismatch`);
      if (action.trim() !== sc.action) fail(`scene ${sc.id}: action mismatch`);
      if (!stageNo.includes(`Stage ${sc.stage} of ${STAGES.length}`) || stageTitle.trim() !== STAGES[sc.stage - 1]) fail(`scene ${sc.id}: stage header`);
      // Mid-scene: progress bar moving, cursor on its target, result visible.
      const bar1 = await page.getByTestId("tour-scene-bar").evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
      await page.waitForTimeout(REALTIME ? 2600 : 450);
      if (Number(await attr(page, "data-scene-index")) === idx) {
        const bar2 = await page.getByTestId("tour-scene-bar").evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
        if (!(bar2 > bar1)) fail(`scene ${sc.id}: progress bar did not advance (${bar1} → ${bar2})`);
        const c = await cursorOnTarget(page);
        if (!c.ok) fail(`scene ${sc.id}: cursor not on target — ${c.detail}`);
      }
      const result = RESULTS[sc.id];
      if (result && !(await page.locator(`[data-testid="tour"] ${result}`).first().isVisible())) fail(`scene ${sc.id}: ${result} not visible`);
      if (["company", "comparison", "synergy", "graph", "proposal", "end"].includes(sc.id)) await page.screenshot({ path: `${OUT}/tour-${sc.id}.png` });
    }
    if ((await attr(page, "data-finished")) === "true") break;
    await page.waitForTimeout(120);
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  if ((await attr(page, "data-finished")) !== "true") fail(`the tour did not reach its end (last scene ${seen.at(-1)})`);
  if (seen.length !== SCENES.length) fail(`saw ${seen.length}/${SCENES.length} scenes`);
  if (stagesSeen.size !== STAGES.length) fail(`saw ${stagesSeen.size}/${STAGES.length} stages`);
  // Real time: the final screen must be reached, and the tour complete, within 60 seconds of playback.
  if (REALTIME && seconds > 62) fail(`the tour took ${seconds}s (limit 60 s of playback + page load)`);
  for (const id of ["tour-replay-final", "tour-signup", "tour-explore"]) await page.getByTestId(id).waitFor();
  if (w.errors.length) fail(`console errors: ${w.errors.join(" | ")}`);
  if (w.posts.length) fail(`non-GET requests: ${w.posts.join(" | ")}`);
  if (w.api.length) fail(`API calls: ${w.api.join(" | ")}`);
  if ((await ctx.cookies()).some((c) => c.name === "orqo_session")) fail("a session cookie was set");
  console.log(`✓ full autonomous run: ${seen.length} scenes, ${stagesSeen.size} stages, ${seconds}s ${REALTIME ? "(real time)" : "(×6)"}, one click, no console error, no write`);

  // Replay from the final screen.
  await page.getByTestId("tour-replay-final").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="tour"]')?.getAttribute("data-scene-index") === "0");
  console.log("✓ replay restarts the tour");
  await ctx.close();
}

async function controls(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: BYPASS_HEADERS });
  const w = watch(page);
  await page.goto(`${BASE}/tour?speed=4`);
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="tour"]')?.getAttribute("data-scene-index")) >= 2);
  await page.getByTestId("tour-pause").click();
  const at = await attr(page, "data-scene-index");
  const bar = await page.getByTestId("tour-scene-bar").evaluate((e) => getComputedStyle(e).transform);
  await page.waitForTimeout(3500);
  if ((await attr(page, "data-scene-index")) !== at || (await page.getByTestId("tour-scene-bar").evaluate((e) => getComputedStyle(e).transform)) !== bar) fail("pause did not stop playback");
  await page.getByTestId("tour-pause").click();
  await page.waitForFunction((i) => document.querySelector('[data-testid="tour"]')?.getAttribute("data-scene-index") !== i, at, { timeout: 10_000 });
  const before = Number(await attr(page, "data-scene-index"));
  await page.getByTestId("tour-skip").click();
  if (Number(await attr(page, "data-scene-index")) !== before + 1) fail("skip");
  await page.getByTestId("tour-back").click();
  if (Number(await attr(page, "data-scene-index")) !== before) fail("back");
  await page.getByTestId("tour-replay").click();
  if ((await attr(page, "data-scene-index")) !== "0") fail("replay control");
  if (w.errors.length || w.posts.length) fail(`controls: ${[...w.errors, ...w.posts].join(" | ")}`);
  console.log("✓ pause / resume / skip / back / replay");
  await page.close();
}

async function mobileAndReducedMotion(browser: Browser) {
  for (const [label, opts] of [
    ["mobile 390 px", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ["reduced motion", { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" as const }],
  ] as const) {
    const ctx = await browser.newContext({ ...opts, extraHTTPHeaders: BYPASS_HEADERS });
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(`${BASE}/tour?speed=12`);
    let worst = 0;
    for (let i = 0; i < 400 && (await attr(page, "data-finished")) !== "true"; i++) {
      worst = Math.max(worst, await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
      await page.waitForTimeout(150);
    }
    if ((await attr(page, "data-finished")) !== "true") fail(`${label}: did not finish`);
    if (worst > 1) fail(`${label}: horizontal overflow ${worst}px`);
    if (w.errors.length || w.posts.length) fail(`${label}: ${[...w.errors, ...w.posts].join(" | ")}`);
    if (label.startsWith("mobile")) await page.screenshot({ path: `${OUT}/tour-mobile-end.png` });
    console.log(`✓ ${label}: complete, no overflow, no error`);
    await ctx.close();
  }
}

const browser = await chromium.launch();
try {
  await fullRun(browser);
  await controls(browser);
  await mobileAndReducedMotion(browser);
  console.log(`\nTOUR ACCEPTANCE PASSED on ${BASE}`);
} catch (e) {
  console.error(`\nTOUR ACCEPTANCE FAILED on ${BASE}: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
