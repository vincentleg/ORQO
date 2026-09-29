"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEMO_FUTURE, VIEWER_ID, futureSignal } from "@/lib/data/seed";
import type { ConsentResponse, LifecycleStage, Opportunity, World } from "@/lib/domain/types";
import { createFromProposal, discoverMultiParty } from "@/lib/engine/network";
import { advance, respond } from "@/lib/engine/orchestration";
import { commitEvaluation, evaluateRelationship, logActivity, type RelationshipEvaluation } from "@/lib/engine/pipeline";
import { applySignal, reevaluate, type ReevaluationReport } from "@/lib/engine/reevaluation";
import { buildInitialWorld } from "@/lib/engine/world";

interface OrqoState {
  world: World;
  connections: Record<string, RelationshipEvaluation>;
  reevaluation?: ReevaluationReport;
  celebrate?: string;
  briefViewed: boolean;
  evaluate: (relationshipId: string) => RelationshipEvaluation;
  commit: (relationshipId: string, result: RelationshipEvaluation, engine?: Opportunity["engine"]) => string[];
  respond: (opportunityId: string, personId: string, response: ConsentResponse) => void;
  setViewer: (personId: string) => void;
  dismissCelebration: () => void;
  markBriefViewed: () => void;
  fastForward: () => void;
  /** `searchNetwork: false` stops before Multi-Company Discovery (used to stage scenarios). */
  reevaluate: (opts?: { searchNetwork?: boolean }) => void;
  searchNetwork: () => void;
  createProposal: (proposalId: string) => string | undefined;
  advance: (opportunityId: string, stage: LifecycleStage, reason: string) => void;
  reset: () => void;
}

const initial = () => ({
  world: buildInitialWorld(),
  connections: {},
  reevaluation: undefined,
  celebrate: undefined,
  briefViewed: false,
});

export const useOrqo = create<OrqoState>()(
  persist(
    (set, get) => ({
      ...initial(),
      evaluate: (relationshipId) => evaluateRelationship(get().world, relationshipId),
      commit: (relationshipId, result, engine = "deterministic") => {
        const { world, created } = commitEvaluation(get().world, result, { kind: "connection" }, engine);
        set({ world, connections: { ...get().connections, [relationshipId]: result } });
        return created;
      },
      respond: (opportunityId, personId, response) => {
        const { world, matched } = respond(get().world, opportunityId, personId, response);
        // After a match the demo returns to the protagonist's perspective.
        if (matched) world.viewerId = VIEWER_ID;
        set({ world, celebrate: matched ? opportunityId : get().celebrate });
      },
      setViewer: (personId) => set({ world: { ...get().world, viewerId: personId } }),
      dismissCelebration: () => set({ celebrate: undefined }),
      markBriefViewed: () => set({ briefViewed: true }),
      fastForward: () => {
        const current = get().world;
        if (current.signals[futureSignal.id]) return;
        const world = structuredClone(current);
        world.now = DEMO_FUTURE;
        logActivity(world, "reevaluation", "Six months passed. Signal Monitoring kept watching every relationship.");
        set({ world: applySignal(world, futureSignal) });
      },
      reevaluate: ({ searchNetwork = true } = {}) => {
        const current = get().world;
        if (!current.signals[futureSignal.id] || get().reevaluation) return;
        const { world, report } = reevaluate(current, futureSignal.id);
        if (!searchNetwork) {
          set({ world, reevaluation: report });
          return;
        }
        const { world: withProposals } = discoverMultiParty(world, world.signals[futureSignal.id]);
        set({ world: withProposals, reevaluation: report });
      },
      searchNetwork: () => {
        const current = get().world;
        const { world } = discoverMultiParty(current, current.signals[futureSignal.id]);
        set({ world });
      },
      createProposal: (proposalId) => {
        const world = createFromProposal(get().world, proposalId);
        set({ world });
        return world.proposals[proposalId]?.opportunity.id;
      },
      advance: (opportunityId, stage, reason) => set({ world: advance(get().world, opportunityId, stage, reason) }),
      reset: () => set(initial()),
    }),
    {
      name: "orqo-demo",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ world: s.world, connections: s.connections, reevaluation: s.reevaluation, briefViewed: s.briefViewed }),
    },
  ),
);
