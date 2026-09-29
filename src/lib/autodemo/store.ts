"use client";

import { create } from "zustand";

export type PlaybackStatus = "idle" | "playing" | "paused" | "finished";

/** Playback state only; never persisted, so a refresh always returns to the normal app. */
interface AutoDemoState {
  selectorOpen: boolean;
  status: PlaybackStatus;
  scenarioId?: string;
  sceneIndex: number;
  sceneCount: number;
  sceneTitle: string;
  caption?: { text: string; sub?: string; key: number };
  finale: boolean;
  pace: number;
  hideSidebar: boolean;
  /** Increments to request a restart / skip from the runner. */
  skipToken: number;
  set: (patch: Partial<Omit<AutoDemoState, "set">>) => void;
}

export const useAutoDemo = create<AutoDemoState>()((set) => ({
  selectorOpen: false,
  status: "idle",
  sceneIndex: 0,
  sceneCount: 0,
  sceneTitle: "",
  finale: false,
  pace: 1,
  hideSidebar: false,
  skipToken: 0,
  set: (patch) => set(patch),
}));

export const isPresenting = (s: { status: PlaybackStatus }) => s.status !== "idle";
