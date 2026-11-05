/**
 * The guided tour's script (Nov 2026): 14 stages, each split into 5-second scenes. Pure data.
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
  "From a company to a business opportunity",
  "Understanding INFODIP",
  "Discovering a potential partner",
  "Researching the target company",
  "Comparing both companies",
  "Analyzing business compatibility",
  "Discovering commercial synergies",
  "Specialized business agents",
  "Critical evaluation",
  "Building the opportunity graph",
  "Creating a partnership proposal",
  "Planning next actions",
  "Continuous opportunity monitoring",
  "Final opportunity summary",
] as const;

const S = (stage: number, id: string, view: ViewId, nav: NavId, target: string, cursor: CursorAction, title: string, body: string, action: string, extra: Partial<Scene> = {}): Scene => ({ id, stage, view, nav, target, cursor, title, body, action, ...extra });

export const SCENES: Scene[] = [
  // 1 · Introducing ORQO
  S(1, "intro", "home", "work", '[data-tour="home-title"]', "point", "From a company to a business opportunity", "ORQO analyzes companies, compares them with yours, and finds partnerships worth your team's time.", "The ORQO workspace opens."),
  S(1, "workspace", "home", "work", '[data-tour="nav"]', "point", "Your business-development workspace", "Your company, the companies you meet, and the opportunities between them — in one place.", "The cursor tours the main sections."),
  S(1, "case", "home", "work", '[data-tour="home-ask"]', "type", "One concrete case", "A French hardware integrator wants American partners that need European production.", "ORQO receives the objective.", { type: { field: "ask", text: "Find a US appliance maker that needs European production" } }),

  // 2 · Understanding INFODIP
  S(2, "open-profile", "home", "company", '[data-tour="nav-company"]', "click", "First, understand your own business", "ORQO can only find good partners once it knows what you sell, to whom, and where.", "ORQO opens the company profile."),
  S(2, "what", "profile", "company", '[data-tour="field-summary"]', "type", "What INFODIP does", "In a sentence: the business ORQO will compare every other company with.", "The description is filled in.", { type: { field: "summary", text: "French OEM/ODM integrator: assembles, configures, tests and delivers IT hardware for business customers across Europe and EMEA." } }),
  S(2, "offer", "profile", "company", '[data-tour="field-offerings"]', "type", "Products and capabilities", "Server and workstation integration, edge appliances, AI infrastructure, customization, testing.", "The offer is listed, capability by capability.", { type: { field: "offerings", text: "Server integration · Workstation integration · Edge computing appliances · AI infrastructure · Customization and branding · OS installation · Testing and validation · EMEA deployment" } }),
  S(2, "markets", "profile", "company", '[data-tour="field-geographies"]', "type", "Customers and coverage", "Who buys from INFODIP and where it can deliver — the basis of any partnership.", "Customers, industries and regions are filled in.", { type: { field: "geographies", text: "Hardware and software vendors, industrial companies · France, Europe, EMEA" } }),
  S(2, "dna", "dna", "company", '[data-testid="business-dna"]', "point", "ORQO structures the business", "Each statement becomes Business DNA: its role (manufacturer, integrator), what it sells, to whom, and how.", "The Business DNA appears, with its evidence."),
  S(2, "market", "dna", "company", '[data-testid="market-model"]', "point", "And understands its market", "From that DNA, ORQO models who INFODIP's customers, suppliers and partners usually are.", "The market model is highlighted."),

  // 3 · Discovering a potential partner
  S(3, "search", "discover", "discover", '[data-tour="search"]', "type", "Looking for a partner", "ORQO searches for a company that needs exactly what INFODIP does best.", "The search runs.", { type: { field: "search", text: "Northvale Edge Systems" } }),
  S(3, "candidate", "discover", "discover", '[data-tour="candidate"]', "click", "A promising candidate", "Northvale Edge Systems — a fictional American edge-AI appliance company created for this demo.", "ORQO selects the candidate."),
  S(3, "why-candidate", "discover", "discover", '[data-tour="candidate-reasons"]', "point", "Why this company", "It builds physical appliances, sells only in North America, and announced a move into Europe.", "The reasons are shown, each from the company's own words."),

  // 4 · Researching the target company
  S(4, "research", "research", "companies", '[data-tour="research-stages"]', "point", "Researching the company", "ORQO reads the company's official website and structures what it finds.", "The research stages complete one by one.", { reveal: [0, 6] }),
  S(4, "understanding", "understanding", "companies", '[data-testid="analysis-understanding"]', "point", "What Northvale does", "Products, customers, markets and footprint — organized in seconds.", "The company intelligence appears."),
  S(4, "facts", "understanding", "companies", '[data-testid="analysis-understanding"]', "point", "Facts, not guesses", "ORQO separates what the company states (facts, with a source) from what it infers.", "Each finding carries its status."),
  S(4, "evidence", "understanding", "companies", '[data-testid="analysis-evidence"]', "point", "Evidence you can check", "Every finding links back to the page it came from. Here: prepared demo evidence, clearly labelled.", "The evidence list opens."),

  // 5 · Comparing both companies
  S(5, "side", "compare", "companies", '[data-testid="company-comparison"]', "point", "Side by side", "ORQO lines the two companies up: role, offer, customers, industries, technology, regions.", "The comparison builds row by row.", { reveal: [0, 5] }),
  S(5, "side-2", "compare", "companies", '[data-compare-row="geographies"]', "point", "Where they differ", "INFODIP delivers in Europe; Northvale sells only in North America. That gap is the opportunity.", "Geography is highlighted.", { reveal: [5, 10] }),
  S(5, "complement", "compare", "companies", '[data-link="complement"]', "point", "What fits together", "Green rows: what one company brings and the other needs. Blue: shared ground.", "Complementary characteristics are matched.", { reveal: [10, 10] }),

  // 6 · Analyzing business compatibility
  S(6, "assess", "assessment", "companies", '[data-tour="dimensions"]', "point", "Analyzing compatibility", "ORQO judges evidence, strategic fit, market fit, timing, effort and risk — one by one.", "The assessment appears dimension by dimension.", { reveal: [0, 6] }),
  S(6, "timing", "assessment", "companies", '[data-tour="dim-timing"]', "point", "Why now?", "Northvale announced its expansion into Europe in 2026 — a dated, cited signal.", "The timing evidence is highlighted.", { reveal: [6, 6] }),
  S(6, "no-score", "assessment", "companies", '[data-tour="no-score"]', "point", "No arbitrary score", "ORQO shows its reasons instead of a number: every judgement can be checked.", "The method is explained.", { reveal: [6, 6] }),

  // 7 · Discovering commercial synergies
  S(7, "found", "dossier", "companies", '[data-testid="dossier-executive"]', "point", "The opportunity ORQO found", "INFODIP could build and deliver Northvale's appliances for its European customers.", "The executive assessment appears."),
  S(7, "proposal-idea", "dossier", "companies", '[data-testid="scenario"]', "point", "The proposed partnership", "Contract production in Europe: Northvale keeps its product and customers, INFODIP builds and delivers.", "The partnership scenario opens."),
  S(7, "both-win", "dossier", "companies", '[data-testid="scenario"]', "point", "Why both sides win", "Northvale gets European capacity without building a factory; INFODIP gets recurring production volume.", "The value for each side is highlighted."),

  // 8 · Specialized business agents
  S(8, "agents", "agents", "agents", '[data-tour="agent-0"]', "point", "A team of specialized agents", "Each step is done by a specialist: research, understanding, ideas, criticism, qualification.", "The workflow starts.", { reveal: [0, 2] }),
  S(8, "agents-2", "agents", "agents", '[data-tour="agent-3"]', "point", "Working as one workflow", "The output of one becomes the input of the next — with evidence carried all the way through.", "The workflow progresses.", { reveal: [2, 4] }),
  S(8, "agents-3", "agents", "agents", '[data-tour="agent-5"]', "point", "Honest about what runs", "In your workspace these run on your data. In this demo they replay prepared results.", "The workflow completes.", { reveal: [4, 6] }),

  // 9 · Critical evaluation
  S(9, "critic", "critic", "companies", '[data-tour="critic-rejected"]', "point", "Challenging every idea", "ORQO does not invent attractive opportunities: a critic tries to reject each one.", "Rejected ideas appear, with the critic's reasons."),
  S(9, "unknowns", "critic", "companies", '[data-tour="critic-questions"]', "point", "What is still unknown", "Before investing time, these questions would confirm — or kill — the opportunity.", "The decisive questions are listed."),
  S(9, "survives", "critic", "companies", '[data-tour="critic-lead"]', "point", "Why this one survives", "Strong evidence, a shown need, evidenced timing, and no major objection.", "The surviving opportunity is confirmed."),

  // 10 · Building the opportunity graph
  S(10, "graph", "map", "opportunities", '[data-map-node="own"]', "point", "Building the opportunity graph", "The two companies and what each one brings.", "Company and capability nodes appear.", { reveal: [0, 4] }),
  S(10, "graph-2", "map", "opportunities", '[data-map-node="scenario"]', "point", "Connecting the opportunity", "The partnership sits where INFODIP's production meets Northvale's products, backed by dated evidence.", "The opportunity and its evidence connect.", { reveal: [4, 8] }),
  S(10, "graph-3", "map", "opportunities", '[data-kind="rejected"]', "point", "And what was rejected", "Dashed: ideas the critic rejected. The graph never says more than the analysis.", "Rejected ideas appear, dashed.", { reveal: [8, 12] }),

  // 11 · Creating a partnership proposal
  S(11, "p-what", "proposal", "opportunities", '[data-section="what"]', "point", "The partnership proposal", "What the opportunity is, who pays for what, and how it would work.", "The proposal starts building.", { reveal: [0, 2] }),
  S(11, "p-why", "proposal", "opportunities", '[data-section="why"]', "point", "Rationale and mutual benefits", "What each company brings and gains — in business terms.", "The rationale is added.", { reveal: [2, 3] }),
  S(11, "p-risk", "proposal", "opportunities", '[data-section="kill"]', "point", "Risks, stated up front", "What could kill the deal, and the evidence behind the opportunity.", "Risks and evidence are added.", { reveal: [3, 5] }),
  S(11, "p-next", "proposal", "opportunities", '[data-section="next"]', "point", "Questions and next step", "What to validate first, and the lowest-cost test to run.", "The proposal is complete.", { reveal: [5, 8] }),

  // 12 · Planning next actions
  S(12, "plan", "plan", "opportunities", '[data-tour="plan-questions"]', "point", "From opportunity to action plan", "The qualification questions to ask first, and who should answer them.", "The action plan appears.", { reveal: [0, 2] }),
  S(12, "plan-2", "plan", "opportunities", '[data-tour="plan-meeting"]', "point", "Introduction and meeting", "How to open the conversation and what to prepare for the first call.", "Meeting preparation is added.", { reveal: [2, 3] }),
  S(12, "plan-3", "plan", "opportunities", '[data-tour="plan-milestones"]', "point", "Milestones", "From a first call to a quoted pilot batch. Nothing is sent from the demo.", "Follow-up milestones are set.", { reveal: [3, 4] }),

  // 13 · Continuous monitoring
  S(13, "monitor", "monitoring", "signals", '[data-tour="monitor-today"]', "point", "Opportunities evolve", "When a company is analyzed again, ORQO records what changed and what it means.", "The monitoring view opens.", { reveal: [0, 1] }),
  S(13, "monitor-2", "monitoring", "signals", '[data-tour="monitor-timeline"]', "point", "What could change the picture", "New offices, compliance needs or products can strengthen or weaken the opportunity.", "Illustrative future signals appear.", { reveal: [1, 4] }),

  // 14 · Final summary
  S(14, "summary", "summary", "work", '[data-tour="summary"]', "point", "The opportunity, in one view", "Two companies, one credible partnership, its evidence, what is still unknown, and the next step.", "The executive summary appears."),
  S(14, "end", "summary", "work", '[data-tour="cta"]', "point", "ORQO turns company intelligence into actionable business opportunities.", "Discover what ORQO could find for your business.", "The demo is complete.", { durationMs: 6000 }),
];

export function sceneDuration(s: Scene): number {
  return s.durationMs ?? DEFAULT_SCENE_MS;
}

export const TOTAL_MS = SCENES.reduce((n, s) => n + sceneDuration(s), 0);
