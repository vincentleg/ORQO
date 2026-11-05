/**
 * The guided tour's playback state machine (Nov 2026). Pure: (state, event) → state. The player feeds it
 * animation-frame ticks; nothing else in the tour keeps time.
 *
 * - Ticks are clamped (MAX_TICK_MS), so a throttled or frozen tab can never jump over scenes; the player also
 *   pauses while the tab is hidden.
 * - A scene advances only when its time is fully elapsed; the last scene holds (finished) — the tour never
 *   loops or exits by itself.
 */
export const MAX_TICK_MS = 100;

export interface TourState {
  index: number;
  /** Time spent in the current scene (ms). */
  elapsed: number;
  paused: boolean;
  finished: boolean;
}

export type TourEvent = { type: "tick"; dt: number } | { type: "pause" } | { type: "resume" } | { type: "toggle" } | { type: "next" } | { type: "prev" } | { type: "replay" };

export const INITIAL: TourState = { index: 0, elapsed: 0, paused: false, finished: false };

export function tourReducer(s: TourState, e: TourEvent, durations: readonly number[]): TourState {
  const last = durations.length - 1;
  switch (e.type) {
    case "tick": {
      if (s.paused || s.finished || !(e.dt > 0)) return s;
      const elapsed = s.elapsed + Math.min(e.dt, MAX_TICK_MS);
      if (elapsed < durations[s.index]) return { ...s, elapsed };
      if (s.index >= last) return { ...s, elapsed: durations[last], finished: true };
      // Carry nothing over: the next scene starts at 0, so no explanation is ever shortened.
      return { ...s, index: s.index + 1, elapsed: 0 };
    }
    case "pause":
      return s.finished ? s : { ...s, paused: true };
    case "resume":
      return { ...s, paused: false };
    case "toggle":
      return s.finished ? s : { ...s, paused: !s.paused };
    case "next":
      return s.index >= last ? { ...s, elapsed: durations[last], finished: true } : { ...s, index: s.index + 1, elapsed: 0, finished: false };
    case "prev":
      return { ...s, index: Math.max(0, s.index - 1), elapsed: 0, finished: false };
    case "replay":
      return { ...INITIAL };
  }
}

/** 0..1 within the current scene. */
export function sceneProgress(s: TourState, durations: readonly number[]): number {
  return Math.max(0, Math.min(1, s.elapsed / durations[s.index]));
}

/** 0..1 over the whole tour. */
export function overallProgress(s: TourState, durations: readonly number[]): number {
  const total = durations.reduce((a, b) => a + b, 0);
  const done = durations.slice(0, s.index).reduce((a, b) => a + b, 0) + s.elapsed;
  return Math.max(0, Math.min(1, done / total));
}

/** Text typed so far for a scene typing `text`: complete at 70% of the scene. */
export function typedText(text: string, progress: number): string {
  return text.slice(0, Math.round(text.length * Math.min(1, progress / 0.7)));
}

/** Interpolated reveal count for a [from, to] range. */
export function revealAt(range: readonly [number, number] | undefined, progress: number): number | undefined {
  if (!range) return undefined;
  const [a, b] = range;
  return Math.round(a + (b - a) * Math.min(1, progress / 0.8));
}
