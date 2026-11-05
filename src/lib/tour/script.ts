/**
 * The guided tour's script (Nov 2026): 12 stages of one 5-second scene each — a 60-second tour. Pure data.
 *
 * Every scene says WHAT ORQO is doing (title), WHY it matters commercially (body) and WHAT HAPPENS on screen
 * (action), shows one view of the ORQO interface, and points the virtual cursor at a SEMANTIC target (a
 * data-tour / data-testid / data-section / data-map-node / data-compare-row selector inside the stage), never at
 * screen coordinates. Typing and progressive reveals are driven by the scene's progress, so the whole tour is a
 * deterministic function of (scene index, progress).
 */

export type ViewId = "home" | "profile" | "dna" | "discover" | "research" | "understanding" | "compare" | "assessment" | "dossier" | "agents" | "critic" | "map" | "proposal" | "plan" | "monitoring" | "summary";
export type NavId = "work" | "company" | "discover" | "companies" | "opportunities" | "agents" | "signals";
export type CursorAction = "point" | "click" | "type" | "none";

export interface Scene {
  id: string;
  stage: number;
  title: string;
  body: string;
  /** "Visual action": what the visitor sees ORQO do in this scene. */
  action: string;
  view: ViewId;
  nav: NavId;
  /** CSS selector of the element the cursor and spotlight focus on (inside the stage). */
  target: string;
  cursor: CursorAction;
  /** Text typed into a field of the view during this scene (finished by ~70% of the scene). */
  type?: { field: string; text: string };
  /** Progressive reveal of the view's items: from → to, interpolated over the scene. */
  reveal?: [number, number];
  durationMs?: number;
}

export const DEFAULT_SCENE_MS = 5000;

export const STAGES = [
  "Introduction",
  "Your company",
  "Company discovery",
  "Company research",
  "Business comparison",
  "Compatibility",
  "Synergy discovery",
  "AI agents",
  "Critic engine",
  "Opportunity graph",
  "Partnership proposal",
  "Final summary",
] as const;

const S = (stage: number, id: string, view: ViewId, nav: NavId, target: string, cursor: CursorAction, title: string, body: string, action: string, extra: Partial<Scene> = {}): Scene => ({ id, stage, view, nav, target, cursor, title, body, action, ...extra });

/** 60 seconds: one 5-second scene per stage. */
export const SCENES: Scene[] = [
  S(1, "intro", "home", "work", '[data-tour="home-ask"]', "type", "From a company to a business opportunity", "ORQO finds the partners worth your time — and shows why.", "ORQO receives the objective.", { type: { field: "ask", text: "Find a US appliance maker that needs European production" } }),
  S(2, "company", "dna", "company", '[data-testid="business-dna"]', "point", "Your company: INFODIP", "French OEM/ODM integrator: servers, edge appliances and AI infrastructure, built and delivered across Europe.", "ORQO structures INFODIP's business profile."),
  S(3, "discovery", "discover", "discover", '[data-tour="search"]', "type", "Company discovery", "A candidate: Northvale Edge Systems — a fictional American edge-AI company created for this demo.", "ORQO searches and selects the candidate.", { type: { field: "search", text: "Northvale Edge Systems" }, reveal: [0, 1] }),
  S(4, "research", "understanding", "companies", '[data-testid="analysis-understanding"]', "point", "Company research", "From its official website: products, customers, markets — facts kept apart from inferences.", "The company intelligence appears."),
  S(5, "comparison", "compare", "companies", '[data-compare-row="geographies"]', "point", "Business comparison", "Same field, opposite strengths: INFODIP builds in Europe; Northvale sells only in North America.", "The two companies line up; geography stands out.", { reveal: [3, 10] }),
  S(6, "compatibility", "assessment", "companies", '[data-tour="dimensions"]', "point", "Compatibility", "Complementary roles, strong evidence, and timing: Northvale announced its move into Europe in 2026.", "ORQO judges each dimension from the evidence.", { reveal: [0, 6] }),
  S(7, "synergy", "dossier", "companies", '[data-testid="scenario"]', "point", "Synergy discovery", "The opportunity: INFODIP builds and delivers Northvale's appliances for European customers.", "A concrete OEM/ODM partnership appears."),
  S(8, "agents", "agents", "agents", '[data-tour="agents-list"]', "point", "AI agents", "Research, understanding, ideas, criticism, qualification — one workflow. Here it replays prepared results.", "Specialized agents complete their steps.", { reveal: [0, 6] }),
  S(9, "critic", "critic", "companies", '[data-tour="critic-rejected"]', "point", "Critic engine", "Every idea is challenged: weak ones are rejected with reasons; only evidence-backed ones survive.", "Rejected ideas, risks and open questions appear."),
  S(10, "graph", "map", "opportunities", '[data-map-node="scenario"]', "point", "Opportunity graph", "Both companies, what each brings, the dated evidence — and the rejected ideas, dashed.", "The opportunity graph builds itself.", { reveal: [0, 12] }),
  S(11, "proposal", "proposal", "opportunities", '[data-tour="proposal"]', "point", "Partnership proposal", "The model, the risks, the questions to ask first, and the lowest-cost test: quote one small batch.", "The proposal and action plan are written.", { reveal: [1, 7] }),
  S(12, "end", "summary", "work", '[data-tour="cta"]', "point", "ORQO turns company intelligence into actionable business opportunities.", "Discover what ORQO could find for your business.", "The opportunity, summarized."),
];

export function sceneDuration(s: Scene): number {
  return s.durationMs ?? DEFAULT_SCENE_MS;
}

export const TOTAL_MS = SCENES.reduce((n, s) => n + sceneDuration(s), 0);
