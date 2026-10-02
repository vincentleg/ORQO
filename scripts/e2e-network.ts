/**
 * Walks the Phase 6 Network UI in a headless browser against a running
 * server, on a synthetic Free workspace created by this run's test users
 * (no preview organization, no provider keys, no external call): an
 * existing company with no recorded relationship state (Unknown / Not
 * recorded, no fabricated history), add and edit a contact, record an
 * interaction (timeline), create a follow-up (Next Best Action + due view),
 * complete it (history + next action update), change the stage, the Network
 * home summary, Search → Add to Network without duplicates (stored fictional
 * research), French, and the Agents page regression.
 *
 *   bun run e2e:network   (BASE_URL defaults to http://localhost:3100)
 */
import { chromium, type Page } from "playwright";
import { STRONG } from "../src/lib/discovery/fixtures";
import { createCompany } from "../src/lib/server/repositories/companies";
import { createOrganization } from "../src/lib/server/repositories/tenancy";
import { finishRun, saveIntelligence, startResearchRun } from "../src/lib/server/research/repository";
import { cleanupTestData, createTestUser, sql, type TestUser } from "../tests/support/supabase";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = ".screenshots";
const errors: string[] = [];

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/network-${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

function check(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

async function signIn(page: Page, user: TestUser) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname === "/workspace", { timeout: 15_000 });
}

await cleanupTestData();
const owner = await createTestUser("e2e-network");
const org = await createOrganization(owner.db, { name: "Network E2E" });
await createCompany(owner.db, org, { name: "Own Co", website: "https://own.example", isOwnCompany: true });
// A company that existed before Phase 6: no stage, no origin, no history.
const legacy = await createCompany(owner.db, org, { name: "Legacy Fictional Co", website: "https://legacy-fictional.example" });
// Stored fictional research for the Search → Add to Network check.
const rr = await startResearchRun(owner.db, org, "basic", STRONG.domain, STRONG.domain);
await saveIntelligence(owner.db, org, rr, "basic", STRONG, []);
await finishRun(owner.db, org, rr, { ok: true, domain: STRONG.domain, counters: {} });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, owner);

  // A. Network home renders the existing company honestly.
  await page.goto(`${BASE}/workspace/network`);
  const row = page.getByTestId("company-row").filter({ hasText: "Legacy Fictional Co" });
  await row.getByText("Not recorded").waitFor();
  await row.getByText("No activity recorded").waitFor();
  await row.getByText("No next action recorded").waitFor();
  await shot(page, "01-home");

  // B/C. Company detail: unknown state, no fabricated history.
  await row.click();
  await page.waitForURL(`**/workspace/companies/${legacy.id}`); // Phase 16B: the canonical company route
  await page.getByTestId("company-origin").getByText("Not recorded").waitFor();
  check((await page.getByTestId("next-best-action").getAttribute("data-kind")) === "add_contact", "no contact → identify a contact");
  check((await page.getByTestId("timeline").locator("li").count()) === 1, "only the real 'added' entry");
  await shot(page, "02-detail-empty");

  // D. Add, then edit, a contact.
  await page.getByTestId("add-contact").click();
  const cf = page.getByTestId("contact-form");
  await cf.getByLabel("Name").fill("Ada Fictional");
  await cf.getByLabel("Role / title").fill("CTO");
  await cf.getByLabel("Email").fill("ada@legacy-fictional.example");
  await cf.getByLabel("Primary contact").check();
  await cf.getByRole("button", { name: "Save contact" }).click();
  await page.getByTestId("contact").getByText("Ada Fictional").waitFor();
  check((await page.getByTestId("next-best-action").getAttribute("data-kind")) === "record_first_contact", "contact → record first contact");
  await page.getByTestId("contact").getByRole("button", { name: "Edit" }).click();
  await page.getByTestId("contact-form").getByLabel("Role / title").fill("Chief Technology Officer");
  await page.getByTestId("contact-form").getByRole("button", { name: "Save contact" }).click();
  await page.getByTestId("contact").getByText("Chief Technology Officer").waitFor();
  await shot(page, "03-contact");

  // E. Record an interaction with a next step → timeline + Next Best Action.
  await page.getByTestId("record-interaction").click();
  const inf = page.getByTestId("interaction-form");
  await inf.getByLabel("Type").selectOption("call");
  await inf.getByLabel("Title").fill("Intro call");
  await inf.getByLabel("Notes / summary").fill("Discussed a fictional pilot.");
  await inf.getByLabel("Next step").fill("Send the technical brief");
  await inf.getByRole("button", { name: "Save interaction" }).click();
  await page.getByTestId("timeline-interaction").getByText("Intro call").waitFor();
  check((await page.getByTestId("next-best-action").getAttribute("data-kind")) === "interaction_next_step", "next step surfaced");
  await shot(page, "04-interaction");

  // F/G. Follow-up from the next step, due today → Next Best Action.
  await page.getByTestId("follow-up-from-step").click();
  const ff = page.getByTestId("next-best-action").getByTestId("follow-up-form");
  // Phase 7/8 due-date control: the empty field is an ORQO button; activating it reveals the native date input.
  await ff.getByTestId("due-date-field").getByLabel("Due date").click();
  await ff.getByTestId("due-date-field").locator('input[type="date"]').fill(new Date().toISOString().slice(0, 10));
  await ff.getByRole("button", { name: "Save follow-up" }).click();
  // The card already showed this text as the interaction's next step: wait for the KIND to change after the save
  // (revalidation), not for text that was already present.
  await page.locator('[data-testid="next-best-action"][data-kind="follow_up"]').waitFor({ timeout: 30_000 });
  await page.getByTestId("next-best-action-title").getByText("Send the technical brief").waitFor();
  check((await page.getByTestId("next-best-action").getAttribute("data-kind")) === "follow_up", "follow-up is the next action");
  await page.getByTestId("timeline").getByText("Follow-up created: Send the technical brief").waitFor();
  await shot(page, "05-follow-up");

  // Due view.
  await page.goto(`${BASE}/workspace/network?view=follow-ups`);
  await page.getByTestId("bucket-today").getByText("Send the technical brief").waitFor();
  await shot(page, "06-due-view");

  // H. Complete it from the company page → history and next action update.
  await page.goto(`${BASE}/workspace/network/${legacy.id}`);
  await page.getByTestId("next-best-action").getByTestId("follow-up-done").click();
  await page.getByTestId("timeline").getByText("Follow-up done: Send the technical brief").waitFor();
  check((await page.getByTestId("next-best-action").getAttribute("data-kind")) === "none", "nothing left → explicit no action");

  // I. Change stage → history.
  await page.getByTestId("edit-relationship").click();
  const rf = page.getByTestId("relationship-form");
  await rf.getByLabel("Stage").selectOption("conversation");
  await rf.getByLabel("How it entered the Network").selectOption("event");
  await rf.getByLabel("Why this company matters").fill("Fictional reason for the test.");
  await rf.getByRole("button", { name: "Save relationship" }).click();
  await page.getByTestId("timeline").getByText("Stage set: Conversation").waitFor();
  await page.getByTestId("company-stage").getByText("Conversation").waitFor();
  await shot(page, "07-stage");
  const [{ n: events }] = await sql`select count(*)::int as n from public.network_events where organization_id = ${org}`;
  check(events === 4, `expected 4 history events (contact, follow-up created, done, stage), got ${events}`);

  // J. Network home now summarizes the relationship.
  await page.goto(`${BASE}/workspace/network`);
  const row2 = page.getByTestId("company-row").filter({ hasText: "Legacy Fictional Co" });
  await row2.getByText("Conversation").waitFor();
  await row2.getByText("Ada Fictional", { exact: false }).waitFor();
  await row2.getByText("Call", { exact: false }).waitFor();
  await page.goto(`${BASE}/workspace/network?stage=conversation`);
  check((await page.getByTestId("company-row").count()) === 1, "stage filter");
  await shot(page, "08-home-summary");

  // K. Search → Add to Network: server-derived, origin recorded, no duplicate.
  await page.goto(`${BASE}/workspace?q=${STRONG.domain}`);
  await page.getByTestId("add-to-network").click();
  // The transient "Added…" message is unmounted when the page revalidates and recognizes the company as known;
  // wait for that durable outcome (the persisted row is verified below).
  await page.getByText("Already in your Network").first().waitFor();
  await page.goto(`${BASE}/workspace?q=${STRONG.domain}`);
  // Search shows the known company as "Already in your Network" (search.result.inNetwork).
  await page.getByText("Already in your Network").first().waitFor();
  const strong = await sql`select network_origin, external_ref from public.companies where organization_id = ${org} and website like ${`%${STRONG.domain}%`}`;
  check(strong.length === 1 && strong[0].network_origin === "search", "one Search-origin row");
  await shot(page, "09-search-add");

  // French.
  await page.goto(`${BASE}/workspace/settings`);
  await page.getByRole("combobox", { name: "Language" }).selectOption("fr");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { name: "Paramètres" }).waitFor();
  await page.goto(`${BASE}/workspace/network/${legacy.id}`);
  await page.getByText("Prochaine meilleure action").waitFor();
  await page.getByText("En discussion").first().waitFor();
  await shot(page, "10-fr");

  // Agents page regression.
  await page.goto(`${BASE}/workspace/agents`);
  await page.locator('[data-agent="relationship"]').waitFor();
} finally {
  await browser.close();
  await cleanupTestData();
  await sql.end();
}

if (errors.length > 0) {
  console.error("Console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("Network E2E passed.");
