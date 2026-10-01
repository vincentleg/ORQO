/**
 * Phase 9 Agent Organization: static render (no browser, no database, no
 * provider). Statuses are truthful per workspace, the planner marks
 * unavailable steps honestly, no private data or internal ids leak into the
 * organization UI, and FR and EN both render.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MISSION_TEMPLATE_IDS, organizationAccess, planMission, type AccessContext } from "@/lib/agents/organization";
import { DATA_DOMAINS, PRIVATE_FIELDS } from "@/lib/agents/permissions";
import { AGENT_ORDER, AGENT_REGISTRY } from "@/lib/agents/registry";
import { catalogFor } from "@/lib/i18n/translate";

// Static render only: the server action reached through the run table is never invoked (it imports server-only modules).
mock.module("@/app/actions/discover", () => ({ addDiscoveredCompanyAction: async () => ({}) }));
const { AgentOrganization, AgentOverview, AgentPermissionsCard, MissionPlanner, RunnableNow } = await import("./agent-organization");

const free: AccessContext = { entitledPlan: "free", preview: false, role: "owner" };
const preview: AccessContext = { entitledPlan: "free", preview: true, role: "owner" };

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("Agents organization page", () => {
  test("Free: every agent rendered once, nothing presents as runnable, coming soon is not sold as an upgrade", () => {
    const html = renderToStaticMarkup(<AgentOrganization access={organizationAccess(free)} locale="en" />);
    for (const id of AGENT_ORDER) expect(count(html, new RegExp(`data-agent="${id}"`, "g"))).toBe(1);
    expect(html).not.toContain('data-access="executable"');
    expect(html).toContain('data-agent="signal" data-feature="agents.signal" data-access="coming_soon"');
    expect(html).toContain('data-agent="research" data-feature="agents.research" data-access="locked"');
    // Upgrade CTAs only for built agents (Research, Prospecting → Pro; Partnership → Business).
    expect(count(html, /Upgrade to/g)).toBe(3);
    expect(renderToStaticMarkup(<RunnableNow access={organizationAccess(free)} locale="en" />)).toContain('data-testid="runnable-empty"');
  });

  test("Preview: built agents show Preview, never Available; unbuilt stay Coming soon", () => {
    const html = renderToStaticMarkup(<AgentOrganization access={organizationAccess(preview)} locale="en" />);
    expect(count(html, /data-status="preview"/g)).toBe(3);
    expect(html).not.toContain('data-status="available"');
    expect(count(html, /data-status="coming_soon"/g)).toBe(9);
    const now = renderToStaticMarkup(<RunnableNow access={organizationAccess(preview)} locale="en" />);
    expect(now).toContain('data-runnable="research"');
    expect(now).not.toContain('data-runnable="signal"');
  });

  test("Planner: unavailable steps are labelled, the count is honest, the human keeps the decision", () => {
    const plan = planMission("prepare_event", organizationAccess(preview));
    const html = renderToStaticMarkup(<MissionPlanner plan={plan} selected="prepare_event" locale="en" />);
    expect(html).toContain("2 of 5 steps can run in this workspace.");
    expect(count(html, /data-runnable="false"/g)).toBe(3);
    expect(html).toContain("Coming soon — will not run");
    expect(html).toContain("Only available steps can run.");
    expect(html).toContain("never sends messages");
    expect(html).toContain('method="get"');
  });

  test("Agent detail: permissions are human-readable, private fields are listed as withheld, no internal ids", () => {
    const html = renderToStaticMarkup(<AgentPermissionsCard agent={AGENT_REGISTRY.research} locale="en" />);
    expect(html).toContain("Public company websites");
    expect(html).toContain("Needs an admin&#x27;s approval");
    expect(html).toContain("Send emails or messages, book meetings, or act outside ORQO");
    expect(html).toContain("Email addresses and phone numbers");
    expect(html).not.toMatch(/>(read_stored_research|official_site_research|deep_company_research)</);
    const overview = renderToStaticMarkup(<AgentOverview agent={AGENT_REGISTRY.research} access={organizationAccess(free).research} locale="en" />);
    expect(overview).toContain('data-ceiling="none"');
    expect(overview).toContain('data-testid="agent-locked-note"');
    const live = renderToStaticMarkup(<AgentOverview agent={AGENT_REGISTRY.research} access={organizationAccess(preview).research} locale="en" />);
    expect(live).toContain('data-level="2" data-level-state="allowed"');
    expect(live).toContain('data-level="3" data-level-state="never"');
  });

  test("planned agent: planned responsibilities, nothing granted", () => {
    const html = renderToStaticMarkup(<AgentOverview agent={AGENT_REGISTRY.event} access={organizationAccess(preview).event} locale="en" />);
    expect(html).toContain("Planned responsibilities");
    expect(html).toContain('data-testid="agent-planned-note"');
    const perms = renderToStaticMarkup(<AgentPermissionsCard agent={AGENT_REGISTRY.event} locale="en" />);
    expect(perms).toContain("No tool is granted.");
    expect(perms).toContain("not granted until it is built");
  });

  test("FR renders and every new label exists in both languages", () => {
    const html = renderToStaticMarkup(<MissionPlanner plan={planMission("find_companies", organizationAccess(free))} selected="find_companies" locale="fr" />);
    expect(html).toContain("Afficher le plan");
    expect(html).toContain("Nécessite Pro");
    for (const locale of ["en", "fr"] as const) {
      const a = catalogFor(locale).agents;
      for (const m of MISSION_TEMPLATE_IDS) expect(a.planner.templates[m].length).toBeGreaterThan(0);
      for (const id of AGENT_ORDER) expect(Object.keys(a.responsibilities[id])).toEqual(["r1", "r2", "r3"]);
      for (const d of DATA_DOMAINS) expect(a.domains[d].length).toBeGreaterThan(0);
      for (const f of PRIVATE_FIELDS) expect(a.privateFields[f].length).toBeGreaterThan(0);
    }
  });
});
