/**
 * Golden missions (Phase 17B): deterministic scenarios that exercise the whole engine —
 *   contracts → executor → child runs → findings/state → APIs → recovery/cancellation.
 * The same scenarios run in-memory (src/lib/server/missions/golden.test.ts, real orchestrator, fake tools),
 * against the database (tests/db/missions.test.ts, real RPCs and tools over stored research) and over HTTP
 * (tests/http/missions.test.ts). Regression protection for later phases: change them only deliberately.
 *
 * The world: the workspace's own profile (SERVICES_OWN) and three companies it already analyzed. Nothing is
 * fetched from the web: Research Basic reuses the stored analyses; an unknown company cannot be researched.
 */
import { INJECTED, PEER_FIXTURE, SERVICES_OWN, STRONG } from "@/lib/discovery/fixtures";
import type { MissionStatus, MissionTemplateId } from "./types";

export const GOLDEN_WORLD = { own: SERVICES_OWN, ownWebsite: "https://own.example", stored: [STRONG, PEER_FIXTURE, INJECTED] } as const;

export interface GoldenMission {
  name: string;
  template: MissionTemplateId;
  input: Record<string, unknown>;
  expect: {
    status: Extract<MissionStatus, "completed" | "failed">;
    failureReason: string | null;
    /** `key:status[:error]` in seq order. */
    steps: string[];
    /** Finding keys that must exist (in addition to the rules below). */
    findings: string[];
    /** Domains that must never appear as a prospect. */
    notProspects: string[];
    /** Child runs the mission creates (one per child-run step). */
    childRuns: number;
  };
}

export const GOLDEN_MISSIONS: readonly GoldenMission[] = [
  {
    name: "research a known company (Research Basic over stored research)",
    template: "research_company",
    input: { target: { query: "strong.example" } },
    expect: { status: "completed", failureReason: null, steps: ["research:completed", "compile:completed"], findings: ["analysis:strong.example", "summary"], notProspects: [], childRuns: 1 },
  },
  {
    name: "prospect from stored/known candidates",
    template: "prospect_known_candidates",
    input: { intent: "customers", maxResults: 5 },
    expect: { status: "completed", failureReason: null, steps: ["prospect:completed", "compile:completed"], findings: ["prospect:strong.example", "prospecting:prospect", "summary"], notProspects: ["peer.example"], childRuns: 1 },
  },
  {
    name: "prospect, then research the top candidates (fan-out child runs)",
    template: "prospect_and_research",
    input: { intent: "customers", researchTop: 2 },
    expect: {
      status: "completed",
      failureReason: null,
      steps: ["prospect:completed", "research_top:completed", "research_top_1:completed", "research_top_2:completed", "compile:completed"],
      findings: ["prospect:strong.example", "prospecting:prospect", "analysis:strong.example", "summary"],
      notProspects: ["peer.example"],
      childRuns: 3,
    },
  },
  {
    name: "a required child run fails deterministically: mission failed, nothing after it runs",
    template: "research_company",
    input: { target: { query: "unknown-target.example" } },
    expect: { status: "failed", failureReason: "step_failed", steps: ["research:failed:research_refused", "compile:skipped"], findings: [], notProspects: [], childRuns: 1 },
  },
];

/** `key:status[:error]` view of steps, as the golden expectations are written. */
export const stepLine = (s: { key: string; status: string; error: string | null }) => (s.status === "failed" && s.error ? `${s.key}:${s.status}:${s.error}` : `${s.key}:${s.status}`);
