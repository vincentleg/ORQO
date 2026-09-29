/**
 * Auto Demo scenarios are configuration: a staged starting state plus a list of
 * scenes, each a list of actions. The runner executes actions against the real
 * application (store actions and the same page handlers the buttons call).
 */
import type { ConsentResponse, World } from "@/lib/domain/types";

/** Values that may depend on live state (e.g. an id created mid-run). */
export type Dynamic<T> = T | ((world: World) => T | undefined);

/** Page handlers registered by screens; invoking one is identical to clicking its button. */
export type DemoHandler = "connect.run" | "signals.fastForward" | "signals.reevaluate" | "network.create";

export type DemoAction =
  | { type: "NAVIGATE"; to: Dynamic<string> }
  | { type: "WAIT"; ms: number }
  | { type: "WAIT_FOR"; until: (world: World) => boolean; timeoutMs?: number }
  | { type: "SHOW_CAPTION"; text: string; sub?: string }
  | { type: "HIDE_CAPTION" }
  | { type: "SCROLL_TO"; target: string; offset?: number }
  | { type: "SCROLL_TOP" }
  | { type: "CONNECT_AGENTS" }
  | { type: "SET_CONSENT"; opportunityId: Dynamic<string>; personId: string; response: ConsentResponse }
  | { type: "VIEW_AS"; personId: string }
  | { type: "OPEN_MEETING_BRIEF"; opportunityId: Dynamic<string> }
  | { type: "FAST_FORWARD" }
  | { type: "RUN_REEVALUATION" }
  | { type: "SEARCH_NETWORK" }
  | { type: "CREATE_MULTI_COMPANY_OPPORTUNITY" }
  | { type: "FINISH" };

export interface DemoScene {
  id: string;
  title: string;
  actions: DemoAction[];
}

/** Instant steps that stage a scenario's starting state through the normal store actions. */
export type DemoSetupStep =
  | { type: "RESET" }
  | { type: "CONNECT_INSTANT"; relationshipId: string }
  | { type: "FAST_FORWARD_INSTANT" }
  | { type: "REEVALUATE_INSTANT"; searchNetwork: boolean };

export interface DemoScenario {
  id: string;
  title: string;
  subtitle: string;
  people: string[];
  companies: string[];
  /** Rough length at 1× pace, shown in the selector. */
  approxSeconds: number;
  setup: DemoSetupStep[];
  scenes: DemoScene[];
  finale: { title: string; line: string; small?: string };
}
