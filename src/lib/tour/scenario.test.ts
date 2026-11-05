/**
 * The guided tour runs on the product engine: these tests pin what the tour claims, so a change in the engine
 * that would make the tour say something false fails here.
 */
import { describe, expect, test } from "bun:test";
import { compareCompanies } from "@/lib/understanding/compare";
import { opportunityMap } from "@/lib/understanding/opportunity-map";
import { buildTour, NORTHVALE_RESEARCH } from "./scenario";

const tour = buildTour();

describe("tour scenario (computed by the product engine)", () => {
  test("the engine finds one credible opportunity: INFODIP produces Northvale's appliances, with timing evidence", () => {
    expect(tour.dossier.status).toBe("ready");
    expect(tour.dossier.verdict).toBe("opportunity");
    expect(tour.lead.key).toBe("contract_production:own");
    expect(tour.lead.verdict).toBe("credible");
    expect(tour.lead.dimensions.timing).toBe("evidenced");
    expect(tour.lead.whyNow.map((w) => w.signal)).toContain("new_region");
  });

  test("the critic rejects the other ideas with reasons, and decisive questions remain", () => {
    expect(tour.dossier.considered.length).toBeGreaterThan(0);
    for (const s of tour.dossier.considered) expect(s.critic.length).toBeGreaterThan(0);
    expect(tour.dossier.questions.length).toBeGreaterThan(0);
  });

  test("comparison and map agree with the dossier", () => {
    const rows = compareCompanies(tour.dossier);
    expect(rows.some((r) => r.link === "complement")).toBe(true);
    const map = opportunityMap(tour.dossier);
    expect(map.lead?.key).toBe(tour.lead.key);
    expect(map.nodes.filter((n) => n.kind === "rejected").map((n) => n.ref)).toEqual(tour.dossier.considered.slice(0, 3).map((s) => s.key));
    // Every edge connects existing nodes.
    const ids = new Set(map.nodes.map((n) => n.id));
    for (const e of map.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });

  test("the tracked opportunity is the server's own snapshot of the lead scenario", () => {
    expect(tour.tracked.snapshot.scenario.key).toBe(tour.lead.key);
    expect(tour.tracked.status).toBe("investigating");
  });

  test("the prospect is fictional (reserved .example domain), and the scenario is deterministic", () => {
    expect(NORTHVALE_RESEARCH.profile.domain.endsWith(".example")).toBe(true);
    expect(JSON.stringify(buildTour())).toBe(JSON.stringify(tour));
  });
});
