/**
 * Phase 17C mission experience UI: static render (no browser, no database, no provider) of the live mission,
 * the ORQO Briefing and its work cards, the delegation form and the Work section, in English and French,
 * from REAL golden mission state (Phase 17B engine in memory). No internal machinery (lease, attempt, run id,
 * step key, raw JSON) reaches the founder.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { goldenView } from "@/lib/missions/fixtures";
import type { MissionView } from "@/lib/missions/view";

mock.module("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
const { MissionLive } = await import("./mission-live");
const { DelegateMission } = await import("./mission-delegate");
const { AuthorityLine, BriefingView, missionItems, StepList, WorkMissions } = await import("./missions");

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const ORG = "7e570000-0000-4000-8000-000000000001";

/** Nothing that only means something to the engine is shown to the founder. */
function expectNoMachinery(html: string, v: MissionView) {
  const visible = text(html).replace(/<[^>]+>/g, " ");
  for (const word of ["lease", "attempt", "child_run", "fanout", "research_top_", "mission_summary", "prospecting_summary", "payload", "{", "undefined", "null", "NaN"]) expect(visible).not.toContain(word);
  for (const s of v.steps) if (s.childRunId) expect(html).not.toContain(s.childRunId);
}

const live = (v: MissionView, over: Partial<{ canExecute: boolean; canCancel: boolean; locale: "en" | "fr" }> = {}) =>
  renderToStaticMarkup(<MissionLive initial={v} locale={over.locale ?? "en"} organizationId={ORG} canExecute={over.canExecute ?? true} canCancel={over.canCancel ?? true} names={{}} />);

describe("live mission", () => {
  test("in progress: phase, live sentence, accessible progress, steps, Stop, free authority — no briefing yet", async () => {
    const { view } = await goldenView("prospect_and_research", { intent: "customers", researchTop: 2 }, { slices: 1 });
    const html = live(view);
    const s = text(html);
    expect(s).toContain('data-phase="researching"');
    expect(s).toContain("Researching");
    expect(s).toMatch(/ORQO is researching [a-z0-9.-]+\.example\./);
    expect(s).toContain('role="progressbar"');
    expect(s).toContain('aria-valuenow="40"');
    expect(s).toContain('aria-valuetext="2 of 5 steps done"');
    expect(s).toContain("Review the companies you already know");
    expect(s).toContain("Pick the best candidates to research");
    expect(s).toContain("Compile the briefing");
    expect(s).toContain('data-testid="mission-cancel"');
    expect(s).toContain("ORQO is working. You can leave this page");
    expect(s).toContain("Free capabilities · $0 paid authority");
    expect(s).toContain("No paid provider was used.");
    expect(s).not.toContain('data-testid="mission-briefing"');
    expectNoMachinery(html, view);
  });

  test("viewers follow without Stop or execution; non-creators get no Stop", async () => {
    const { view } = await goldenView("research_company", { target: { query: "strong.example" } }, { slices: 0 });
    const viewer = text(live(view, { canExecute: false, canCancel: false }));
    expect(viewer).toContain("You are following this mission");
    expect(viewer).not.toContain('data-testid="mission-cancel"');
    expect(viewer).toContain('data-driver="idle"');
    expect(text(live(view, { canCancel: false }))).not.toContain('data-testid="mission-cancel"');
  });

  test("completed: no Stop, steps folded away, the ORQO Briefing below", async () => {
    const { view } = await goldenView("prospect_and_research", { intent: "customers", researchTop: 2 });
    const html = live(view);
    const s = text(html);
    expect(s).toContain('data-phase="completed"');
    expect(s).not.toContain('data-testid="mission-cancel"');
    expect(s).toContain("<details");
    expect(s).toContain("ORQO Briefing");
    for (const h of ["What ORQO did", "What matters", "What to do next", "What ORQO found"]) expect(s).toContain(h);
    expectNoMachinery(html, view);
  });
});

describe("ORQO Briefing and work cards", () => {
  test("prospects and research appear as cards with real names, priorities and links; the funnel is summarized", async () => {
    const { view } = await goldenView("prospect_and_research", { intent: "customers", researchTop: 2 });
    const s = text(renderToStaticMarkup(<BriefingView v={view} locale="en" />));
    const prospects = view.findings.filter((f) => f.kind === "prospect");
    for (const p of prospects) {
      expect(s).toContain(`data-domain="${p.subjectDomain}"`);
      expect(s).toContain(String(p.payload.name));
    }
    expect(s).not.toContain('data-domain="peer.example" data-priority');
    // Researched prospects carry their research on their own card (no duplicate research cards).
    expect((s.match(/data-testid="prospect-research"/g) ?? []).length).toBe(2);
    expect(s).not.toContain('data-testid="analysis-card"');
    expect(s).toContain('data-testid="prospecting-card"');
    expect(s).toMatch(/\d+ considered · \d+ qualified/);
    expect(s).toContain('href="/workspace/companies?q=strong.example"');
    expect(s).toMatch(/Reviewed \d+ companies your workspace knows and kept \d+ as prospects\./);
    expect(s).toContain("Researched 2 companies");
    expect(s).toMatch(/Validate the [A-Z][^<]* hypothesis with/);
  });

  test("failed mission: partial title, the failure in plain words, and a way to start again", async () => {
    const { view } = await goldenView("research_company", { target: { query: "unknown-target.example" } });
    const html = renderToStaticMarkup(<BriefingView v={view} locale="en" />);
    const s = text(html);
    expect(s).toContain("What ORQO finished");
    expect(s).toContain("Research unknown-target.example — ORQO could not research this company here");
    expect(s).toContain("One step could not be completed.");
    expect(s).toContain("Start this mission again");
    expect(s).toContain("ORQO did not find anything to report.");
    expectNoMachinery(html, view);
  });

  test("French: briefing, cards and steps are translated", async () => {
    const { view } = await goldenView("prospect_and_research", { intent: "customers", researchTop: 2 });
    const s = text(renderToStaticMarkup(<BriefingView v={view} locale="fr" />));
    for (const h of ["Briefing ORQO", "Ce qu'ORQO a fait", "Ce qui compte", "Que faire ensuite", "Ce qu'ORQO a trouvé", "Comment ORQO a cherché"]) expect(s).toContain(h);
    expect(s).toMatch(/\d+ entreprises de votre espace passées en revue/);
    const steps = text(renderToStaticMarkup(<StepList v={view} locale="fr" />));
    expect(steps).toContain("Passer en revue les entreprises que vous connaissez");
    expect(steps).toContain("Fait");
    const live = text(renderToStaticMarkup(<MissionLive initial={(await goldenView("research_company", { target: { query: "strong.example" } }, { slices: 0 })).view} locale="fr" organizationId={ORG} canExecute canCancel names={{}} />));
    expect(live).toContain("Préparation");
    expect(live).toContain("Arrêter la mission");
    expect(live).toContain("Capacités gratuites · autorisation payante de 0 $");
  });

  test("authority line shows only real spend: none for free missions, the ledger total otherwise", async () => {
    const { view } = await goldenView("research_company", { target: { query: "strong.example" } }, { slices: 0 });
    expect(text(renderToStaticMarkup(<AuthorityLine v={view} locale="en" />))).toContain('data-max-cost="0" data-spend="0"');
    const spent = text(renderToStaticMarkup(<AuthorityLine v={{ ...view, authority: { ...view.authority, maxCostUsd: 0.5, paidProviders: true }, spend: { committedUsd: 0.0121, settledUsd: 0.0121, calls: 2 } }} locale="en" />));
    expect(spent).not.toContain("Free capabilities");
    expect(spent).toContain("$0.01 recorded across 2 paid calls.");
  });
});

describe("delegation", () => {
  const render = (over: Partial<Parameters<typeof DelegateMission>[0]> = {}) =>
    text(renderToStaticMarkup(<DelegateMission locale="en" organizationId={ORG} companies={[{ id: "c1", name: "Acme" }]} locked={null} prefill={{}} {...over} />));

  test("three real templates, a plain summary of what ORQO will do, and the free-only note", () => {
    const s = render();
    for (const name of ["Research a company", "Find prospects", "Find and research prospects"]) expect(s).toContain(name);
    expect(s).toContain("ORQO will</span> <span");
    expect(s).toContain("rank the best candidates (potential customers), then research the top 2.");
    expect(s).toContain("No web search, no paid providers.");
    expect(s).toContain('data-testid="delegate-start"');
    for (const word of ["Deep", "web search provider", "autonomy"]) expect(s).not.toContain(word);
  });

  test("CEO hand-off pre-fills the form (research a named company)", () => {
    const s = render({ prefill: { template: "research_company", target: "globex.example" } });
    expect(s).toContain('value="globex.example"');
    expect(s).toContain("research globex.example and assess the opportunity");
  });

  test("locked: plan and role explain why and offer no Start button", () => {
    const plan = render({ locked: "plan" });
    expect(plan).toContain("which your plan does not include");
    expect(plan).toContain('href="/workspace/plans"');
    expect(plan).not.toContain('data-testid="delegate-start"');
    const role = render({ locked: "role" });
    expect(role).toContain("Viewers can follow missions but cannot start them.");
    expect(role).not.toContain('data-testid="delegate-start"');
  });

  test("French form", () => {
    const s = text(renderToStaticMarkup(<DelegateMission locale="fr" organizationId={ORG} companies={[]} locked={null} prefill={{}} />));
    for (const x of ["Que doit faire ORQO ?", "Trouver et étudier des prospects", "Lancer la mission", "Capacités gratuites uniquement"]) expect(s).toContain(x);
  });
});

describe("Work section", () => {
  const row = (id: string, status: string, input: Record<string, unknown>, template = "research_company") => ({ id, template, objective: "x", status, created_at: "2026-10-05T10:00:00Z", finished_at: status === "completed" ? "2026-10-05T11:00:00Z" : null, input });

  test("active missions first, then the latest briefings, at most three; titles from the founder's input", async () => {
    const { createTranslator } = await import("@/lib/i18n/translate");
    const t = createTranslator("en");
    const items = missionItems([row("a", "running", { target: { query: "acme.com" } }), row("b", "completed", { intent: "customers" }, "prospect_known_candidates"), row("c", "completed", { target: { query: "x.com" } }), row("d", "completed", { target: { query: "y.com" } })], t, {});
    const s = text(renderToStaticMarkup(<WorkMissions items={items} locale="en" />));
    expect(s).toContain("ORQO is working on");
    expect(s).toContain("Research a company · acme.com");
    expect(s).toContain("Find prospects · Potential customers");
    expect((s.match(/data-testid="mission-row"/g) ?? []).length).toBe(3);
    expect(s).toContain("In progress");
    const empty = text(renderToStaticMarkup(<WorkMissions items={[]} locale="en" />));
    expect(empty).toContain('href="/workspace/missions#delegate"');
    expect(empty).toContain("Delegate a mission");
  });
});
