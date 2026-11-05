/**
 * Guided-tour copy tables (Nov 2026). Dependency-free on purpose: the tour's client code imports these, and must not
 * pull the engine (or zod) into the browser bundle — the engine runs on the server at build time.
 */

/** Suggested people to involve for each decisive question (a suggestion shown as such, not a contact list). */
export const QUESTION_ROLES: Record<string, string> = {
  production_model: "Their VP Operations or head of manufacturing",
  volumes_stage: "Their product manager for the appliance line",
  supplier_qualification: "Their supply-chain / procurement lead",
};

/** Illustrative future events (labelled "Illustrative" in the tour): how monitoring would re-open the analysis. */
export const MONITORING_EVENTS = [
  { when: "Jan 2027", event: "Northvale opens a sales office in Germany", effect: "Strengthens the timing: European customers will need local supply and support." },
  { when: "Mar 2027", event: "Northvale publishes CE / EU compliance requirements for its appliances", effect: "Adds a technical question: who certifies the European build?" },
  { when: "May 2027", event: "Northvale announces a second appliance with a different GPU platform", effect: "A new integration line could extend the production scope." },
] as const;
