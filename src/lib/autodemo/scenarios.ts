import { DEMO_OPPORTUNITY, DEMO_RELATIONSHIP } from "@/lib/demo";
import type { World } from "@/lib/domain/types";
import type { DemoScenario } from "./types";

const CHANNEL_OPPORTUNITY = "opp-channel-distribution-edgevision-securechannel";
const proposalPath = (w: World) => {
  const p = Object.values(w.proposals)[0];
  return p ? `/network?proposal=${p.id}` : "/network";
};

const FINALE_PRIMARY = {
  title: "You meet the person. ORQO finds the business.",
  line: "Meet once. ORQO keeps looking.",
  small: "Autonomous Business Development Network",
};

const edgeAiExpansion: DemoScenario = {
  id: "edge-ai-expansion",
  title: "European Edge AI Expansion",
  subtitle: "One encounter becomes a business match, then a three-company program six months later.",
  people: ["p-maya", "p-lukas", "p-sophie"],
  companies: ["c-edgevision", "c-eurocompute", "c-securechannel"],
  approxSeconds: 120,
  setup: [{ type: "RESET" }],
  finale: FINALE_PRIMARY,
  scenes: [
    {
      id: "met",
      title: "They met six months ago",
      actions: [
        { type: "NAVIGATE", to: "/" },
        { type: "SHOW_CAPTION", text: "They met 6 months ago", sub: "Maya Chen · EdgeVision  ↔  Lukas Brandt · EuroCompute" },
        { type: "WAIT", ms: 3800 },
        { type: "SCROLL_TO", target: "relationships" },
        { type: "SHOW_CAPTION", text: "Nothing happened since", sub: "Like most relationships, it went dormant" },
        { type: "WAIT", ms: 3600 },
      ],
    },
    {
      id: "connect",
      title: "Their Business Agents connect",
      actions: [
        { type: "NAVIGATE", to: `/connect/${DEMO_RELATIONSHIP}` },
        { type: "SHOW_CAPTION", text: "Their Business Agents connect" },
        { type: "WAIT", ms: 2800 },
        { type: "CONNECT_AGENTS" },
        { type: "WAIT", ms: 1000 },
        { type: "SHOW_CAPTION", text: "ORQO understands both companies" },
        { type: "WAIT", ms: 3600 },
        { type: "SCROLL_TO", target: "analysis", offset: 72 },
        { type: "SHOW_CAPTION", text: "Searching for mutual value", sub: "Capabilities and needs, mapped in both directions" },
        { type: "WAIT", ms: 4200 },
        { type: "SHOW_CAPTION", text: "The critic tests the opportunity", sub: "Nothing surfaces unless it survives" },
        { type: "WAIT_FOR", until: (w) => Boolean(w.opportunities[DEMO_OPPORTUNITY]) },
        { type: "WAIT", ms: 600 },
        { type: "SHOW_CAPTION", text: "Opportunity discovered", sub: "European Edge AI Appliance Partnership" },
        { type: "WAIT", ms: 4800 },
      ],
    },
    {
      id: "opportunity",
      title: "What each side brings",
      actions: [
        { type: "NAVIGATE", to: `/opportunities/${DEMO_OPPORTUNITY}` },
        { type: "HIDE_CAPTION" },
        { type: "WAIT", ms: 3400 },
        { type: "SCROLL_TO", target: "contributions" },
        { type: "SHOW_CAPTION", text: "What each company brings", sub: "EdgeVision: AI software · EuroCompute: hardware, manufacturing, deployment" },
        { type: "WAIT", ms: 5600 },
        { type: "SCROLL_TO", target: "evidence" },
        { type: "SHOW_CAPTION", text: "Every claim is sourced", sub: "Facts, inferences and assumptions stay separate" },
        { type: "WAIT", ms: 4400 },
        { type: "SCROLL_TOP" },
        { type: "HIDE_CAPTION" },
        { type: "WAIT", ms: 1400 },
      ],
    },
    {
      id: "consent",
      title: "Bilateral consent",
      actions: [
        { type: "SHOW_CAPTION", text: "Each side decides privately" },
        { type: "WAIT", ms: 2600 },
        { type: "SET_CONSENT", opportunityId: DEMO_OPPORTUNITY, personId: "p-maya", response: "interested" },
        { type: "SHOW_CAPTION", text: "Maya is interested", sub: "Her answer stays sealed" },
        { type: "WAIT", ms: 3200 },
        { type: "VIEW_AS", personId: "p-lukas" },
        { type: "SHOW_CAPTION", text: "Both sides remain private", sub: "Lukas sees the same opportunity from his side" },
        { type: "WAIT", ms: 3400 },
        { type: "SET_CONSENT", opportunityId: DEMO_OPPORTUNITY, personId: "p-lukas", response: "interested" },
        { type: "SHOW_CAPTION", text: "Mutual interest detected" },
        { type: "WAIT", ms: 1800 },
        { type: "HIDE_CAPTION" },
        { type: "WAIT", ms: 4600 },
      ],
    },
    {
      id: "brief",
      title: "The first meeting",
      actions: [
        { type: "OPEN_MEETING_BRIEF", opportunityId: DEMO_OPPORTUNITY },
        { type: "SHOW_CAPTION", text: "ORQO prepares the first meeting" },
        { type: "WAIT", ms: 3800 },
        { type: "SCROLL_TO", target: "agenda" },
        { type: "SHOW_CAPTION", text: "Objective, agenda, questions, stakeholders" },
        { type: "WAIT", ms: 4200 },
        { type: "SCROLL_TO", target: "questions" },
        { type: "WAIT", ms: 3000 },
      ],
    },
    {
      id: "signal",
      title: "Six months later",
      actions: [
        { type: "NAVIGATE", to: "/signals" },
        { type: "SHOW_CAPTION", text: "6 months later…" },
        { type: "WAIT", ms: 2400 },
        { type: "FAST_FORWARD" },
        { type: "WAIT_FOR", until: (w) => Boolean(w.signals["sig-ev-europe"]) },
        { type: "WAIT", ms: 500 },
        { type: "SCROLL_TO", target: "signal" },
        { type: "SHOW_CAPTION", text: "A new signal changes the relationship", sub: "EdgeVision expands into Germany and Western Europe" },
        { type: "WAIT", ms: 6000 },
      ],
    },
    {
      id: "reevaluate",
      title: "ORQO re-evaluates the network",
      actions: [
        { type: "SCROLL_TO", target: "scan" },
        { type: "SHOW_CAPTION", text: "ORQO re-evaluates the network", sub: "Which relationships does this signal change?" },
        { type: "WAIT", ms: 4000 },
        { type: "RUN_REEVALUATION" },
        { type: "WAIT", ms: 2900 },
        { type: "SHOW_CAPTION", text: "New opportunity found", sub: "Someone you met six months ago is now strategically relevant" },
        { type: "WAIT", ms: 6600 },
        { type: "SCROLL_TO", target: "proposal", offset: 120 },
        { type: "SHOW_CAPTION", text: "One capability is still missing", sub: "The appliance deal has no European distribution" },
        { type: "WAIT", ms: 3600 },
        { type: "SHOW_CAPTION", text: "Searching the opportunity graph", sub: "SecureChannel provides European enterprise distribution" },
        { type: "WAIT", ms: 4400 },
      ],
    },
    {
      id: "graph",
      title: "The Opportunity Graph",
      actions: [
        { type: "NAVIGATE", to: proposalPath },
        { type: "SHOW_CAPTION", text: "Another company completes the opportunity", sub: "EdgeVision + EuroCompute + SecureChannel" },
        { type: "WAIT", ms: 5600 },
        { type: "CREATE_MULTI_COMPANY_OPPORTUNITY" },
        { type: "WAIT", ms: 1200 },
        { type: "HIDE_CAPTION" },
        { type: "WAIT", ms: 2400 },
        { type: "FINISH" },
      ],
    },
  ],
};

const dormantBecomesValuable: DemoScenario = {
  id: "dormant-relationship",
  title: "Dormant Relationship Becomes Valuable",
  subtitle: "The critic says no today. Six months later, a signal meets its watch conditions.",
  people: ["p-maya", "p-sophie"],
  companies: ["c-edgevision", "c-securechannel"],
  approxSeconds: 75,
  setup: [{ type: "RESET" }],
  finale: {
    title: "Meet once. ORQO keeps looking.",
    line: "No opportunity today became a qualified opportunity six months later.",
    small: "Autonomous Business Development Network",
  },
  scenes: [
    {
      id: "met",
      title: "No strong opportunity yet",
      actions: [
        { type: "NAVIGATE", to: "/connect/r-maya-sophie" },
        { type: "SHOW_CAPTION", text: "Maya meets Sophie at The AI Conference", sub: "EdgeVision  ↔  SecureChannel" },
        { type: "WAIT", ms: 3800 },
        { type: "SCROLL_TO", target: "verdict", offset: 120 },
        { type: "SHOW_CAPTION", text: "No strong opportunity yet", sub: "ORQO does not manufacture opportunities" },
        { type: "WAIT", ms: 4600 },
        { type: "SHOW_CAPTION", text: "The critic holds back a weak hypothesis", sub: "No EU support entity · distribution need still exploratory" },
        { type: "WAIT", ms: 5200 },
        { type: "SHOW_CAPTION", text: "ORQO keeps watching", sub: "It records what would change its mind" },
        { type: "WAIT", ms: 4200 },
      ],
    },
    {
      id: "signal",
      title: "Six months later",
      actions: [
        { type: "NAVIGATE", to: "/signals" },
        { type: "SHOW_CAPTION", text: "6 months later…" },
        { type: "WAIT", ms: 2400 },
        { type: "FAST_FORWARD" },
        { type: "WAIT_FOR", until: (w) => Boolean(w.signals["sig-ev-europe"]) },
        { type: "WAIT", ms: 500 },
        { type: "SCROLL_TO", target: "signal" },
        { type: "SHOW_CAPTION", text: "A new signal", sub: "EdgeVision opens a Munich office and EU support center" },
        { type: "WAIT", ms: 5600 },
      ],
    },
    {
      id: "reopen",
      title: "The relationship re-opens",
      actions: [
        { type: "SCROLL_TO", target: "scan" },
        { type: "SHOW_CAPTION", text: "The signal meets the critic's watch conditions" },
        { type: "WAIT", ms: 4400 },
        { type: "RUN_REEVALUATION" },
        { type: "WAIT", ms: 2900 },
        { type: "SHOW_CAPTION", text: "New opportunity found", sub: "Someone you met six months ago is now strategically relevant" },
        { type: "WAIT", ms: 4400 },
        { type: "SCROLL_TO", target: "reveal-delta", offset: 160 },
        { type: "SHOW_CAPTION", text: "What changed · Why now · Why not before" },
        { type: "WAIT", ms: 6400 },
      ],
    },
    {
      id: "opportunity",
      title: "The qualified opportunity",
      actions: [
        { type: "NAVIGATE", to: `/opportunities/${CHANNEL_OPPORTUNITY}` },
        { type: "SHOW_CAPTION", text: "What business opportunity now exists", sub: "European Enterprise Channel Partnership" },
        { type: "WAIT", ms: 4600 },
        { type: "SCROLL_TO", target: "contributions" },
        { type: "SHOW_CAPTION", text: "EdgeVision brings the product. SecureChannel brings the channel." },
        { type: "WAIT", ms: 4600 },
        { type: "SCROLL_TOP" },
        { type: "HIDE_CAPTION" },
        { type: "WAIT", ms: 1600 },
        { type: "FINISH" },
      ],
    },
  ],
};

const multiCompanyGraph: DemoScenario = {
  id: "multi-company-graph",
  title: "Multi-Company Opportunity Graph",
  subtitle: "A strong deal is missing one capability. ORQO finds the company that has it.",
  people: ["p-maya", "p-lukas", "p-sophie"],
  companies: ["c-edgevision", "c-eurocompute", "c-securechannel"],
  approxSeconds: 55,
  setup: [
    { type: "RESET" },
    { type: "CONNECT_INSTANT", relationshipId: DEMO_RELATIONSHIP },
    { type: "FAST_FORWARD_INSTANT" },
    { type: "REEVALUATE_INSTANT", searchNetwork: false },
  ],
  finale: {
    title: "Your network is not a list of contacts.",
    line: "It is a graph of unrealized business opportunities.",
    small: "ORQO · Autonomous Business Development Network",
  },
  scenes: [
    {
      id: "gap",
      title: "One capability is missing",
      actions: [
        { type: "NAVIGATE", to: `/opportunities/${DEMO_OPPORTUNITY}` },
        { type: "SHOW_CAPTION", text: "A credible opportunity", sub: "EdgeVision + EuroCompute · European Edge AI Appliance Partnership" },
        { type: "WAIT", ms: 3800 },
        { type: "SCROLL_TO", target: "contributions" },
        { type: "SHOW_CAPTION", text: "EdgeVision brings the software. EuroCompute brings the hardware." },
        { type: "WAIT", ms: 5000 },
        { type: "SCROLL_TO", target: "risks", offset: 160 },
        { type: "SHOW_CAPTION", text: "One capability is missing", sub: "Neither company can sell into European enterprises" },
        { type: "WAIT", ms: 5200 },
      ],
    },
    {
      id: "search",
      title: "Searching your network",
      actions: [
        { type: "NAVIGATE", to: "/network" },
        { type: "SHOW_CAPTION", text: "Searching your network…", sub: "Every company Maya, Lukas and Sophie's agents can reach" },
        { type: "WAIT", ms: 3400 },
        { type: "SEARCH_NETWORK" },
        { type: "WAIT", ms: 1200 },
        { type: "SHOW_CAPTION", text: "SecureChannel provides the missing capability", sub: "Found through an existing relationship" },
        { type: "WAIT", ms: 5200 },
      ],
    },
    {
      id: "contributions",
      title: "Company C enters the graph",
      actions: [
        { type: "SHOW_CAPTION", text: "Three companies, one program", sub: "Software · Hardware & deployment · European distribution" },
        { type: "WAIT", ms: 5600 },
      ],
    },
    {
      id: "create",
      title: "The multi-company opportunity",
      actions: [
        { type: "CREATE_MULTI_COMPANY_OPPORTUNITY" },
        { type: "SHOW_CAPTION", text: "Another company completes the opportunity" },
        { type: "WAIT", ms: 3600 },
        { type: "HIDE_CAPTION" },
        { type: "WAIT", ms: 1600 },
        { type: "FINISH" },
      ],
    },
  ],
};

export const SCENARIOS: DemoScenario[] = [edgeAiExpansion, dormantBecomesValuable, multiCompanyGraph];

export const PACES = [
  { id: "brisk", label: "Brisk", factor: 0.72 },
  { id: "standard", label: "Standard", factor: 1 },
  { id: "relaxed", label: "Relaxed", factor: 1.3 },
] as const;
