/**
 * Phase 10 Opportunity Graph map: static render (no browser, no database, no
 * provider, no Neo4j). FR and EN; node kinds are distinguishable; the legend
 * keeps FACT / INFERENCE / ASSUMPTION distinct; nothing private is rendered.
 * Fictional data only.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { neighborhood } from "@/lib/graph/opportunity/neighborhood";
import { BRIGHT, ORG_A, snapshot } from "@/lib/graph/opportunity/fixtures";
import { buildProjection, nodeKey } from "@/lib/graph/opportunity/projection";
import { OpportunityGraphMap } from "./opportunity-graph-map";

function render(locale: "en" | "fr") {
  const n = neighborhood(buildProjection(snapshot()), nodeKey(ORG_A, "company", BRIGHT))!;
  return renderToStaticMarkup(<OpportunityGraphMap locale={locale} nodes={n.nodes} edges={n.edges} highlight={[]} />);
}

describe("Opportunity Graph map", () => {
  test("EN: kinds, legend and the selection hint render", () => {
    const html = render("en");
    for (const s of ["Company", "Capability", "Need", "Concept", "Signal", "Event", "Fact", "Inference", "Assumption", "Select a node or a connection"]) expect(html).toContain(s);
    expect(html).toContain('data-kind="need"');
    expect(html).toContain('data-kind="signal"');
  });

  test("FR: the same view is translated", () => {
    const html = render("fr");
    for (const s of ["Entreprise", "Capacité", "Besoin", "Fait", "Inférence", "Hypothèse", "Sélectionnez un nœud"]) expect(html).toContain(s);
  });

  test("no private CRM content is rendered", () => {
    const html = render("en");
    for (const s of ["@", "prep_notes", "notes:", "interaction summary"]) expect(html).not.toContain(s);
  });
});
