import { futureSignal } from "@/lib/data/seed";
import type { World } from "@/lib/domain/types";
import { consentOf, isMatched } from "@/lib/engine/orchestration";

export const DEMO_RELATIONSHIP = "r-maya-lukas";
export const DEMO_OPPORTUNITY = "opp-oem-appliance-edgevision-eurocompute";

export interface DemoStep {
  index: number;
  total: number;
  title: string;
  hint: string;
  href: string;
  moment?: 1 | 2 | 3;
}

const TOTAL = 8;

/** The next step of the guided demo, derived from world state so it never drifts. */
export function nextDemoStep(world: World, briefViewed: boolean, reevaluated: boolean): DemoStep {
  const opp = world.opportunities[DEMO_OPPORTUNITY];
  const step = (index: number, title: string, hint: string, href: string, moment?: 1 | 2 | 3): DemoStep => ({ index, total: TOTAL, title, hint, href, moment });

  if (!opp) return step(1, "Connect two agents", "Maya met Lukas six months ago. Nothing happened since.", `/connect/${DEMO_RELATIONSHIP}`, 1);
  if (!isMatched(opp)) {
    if (consentOf(world, opp.id, "p-maya")?.response !== "interested")
      return step(2, "Respond as Maya", "Each side decides privately.", `/opportunities/${opp.id}`, 1);
    return step(3, "Switch to Lukas and respond", "Maya's answer stays sealed until both agree.", `/opportunities/${opp.id}`, 1);
  }
  if (!briefViewed) return step(4, "Open the meeting brief", "ORQO prepared the first meeting.", `/opportunities/${opp.id}/match`, 1);
  const signal = world.signals[futureSignal.id];
  if (!signal) return step(5, "Fast forward +6 months", "Meet once. ORQO keeps looking.", "/signals", 2);
  if (!reevaluated) return step(6, "Re-evaluate affected relationships", "A new signal changed the network.", "/signals", 2);
  const proposal = Object.values(world.proposals).find((p) => p.status === "proposed");
  if (proposal) return step(7, "Create the 3-way opportunity", "A third company closes the gap.", `/network?proposal=${proposal.id}`, 3);
  return step(8, "Explore the Opportunity Graph", "One encounter became a three-company program.", "/network", 3);
}
