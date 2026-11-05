import { describe, expect, test } from "bun:test";
import { INITIAL, MAX_TICK_MS, overallProgress, revealAt, sceneProgress, tourReducer, typedText, type TourState } from "./machine";
import { SCENES, sceneDuration, STAGES, TOTAL_MS } from "./script";

const D = [5000, 5000, 6000];
const run = (s: TourState, ms: number, step = 16) => {
  for (let t = 0; t < ms; t += step) s = tourReducer(s, { type: "tick", dt: step }, D);
  return s;
};

describe("tour state machine", () => {
  test("advances scene by scene with no input, and holds on the last scene", () => {
    let s = run(INITIAL, 4990);
    expect(s.index).toBe(0);
    s = run(s, 30);
    expect(s.index).toBe(1);
    s = run(s, 11_200);
    expect(s).toMatchObject({ index: 2, finished: true, elapsed: 6000 });
    expect(run(s, 60_000)).toEqual(s);
  });

  test("a huge frame gap (frozen tab) never skips a scene", () => {
    const s = tourReducer(INITIAL, { type: "tick", dt: 60_000 }, D);
    expect(s).toMatchObject({ index: 0, elapsed: MAX_TICK_MS });
  });

  test("pause stops time; resume continues where it was", () => {
    let s = run(INITIAL, 2000);
    s = tourReducer(s, { type: "pause" }, D);
    const paused = run(s, 10_000);
    expect(paused.elapsed).toBe(s.elapsed);
    expect(run(tourReducer(paused, { type: "resume" }, D), 100).elapsed).toBeGreaterThan(s.elapsed);
  });

  test("skip, back and replay", () => {
    let s = tourReducer(INITIAL, { type: "next" }, D);
    expect(s.index).toBe(1);
    s = tourReducer(s, { type: "prev" }, D);
    expect(s.index).toBe(0);
    s = tourReducer(tourReducer(tourReducer(s, { type: "next" }, D), { type: "next" }, D), { type: "next" }, D);
    expect(s.finished).toBe(true);
    expect(tourReducer(s, { type: "replay" }, D)).toEqual(INITIAL);
  });

  test("progress, typing and reveal helpers", () => {
    expect(sceneProgress({ ...INITIAL, elapsed: 2500 }, D)).toBe(0.5);
    expect(overallProgress({ index: 2, elapsed: 6000, paused: false, finished: true }, D)).toBe(1);
    expect(typedText("abcdefghij", 0.35)).toBe("abcde");
    expect(typedText("abc", 1)).toBe("abc");
    expect(revealAt([2, 6], 0)).toBe(2);
    expect(revealAt([2, 6], 0.8)).toBe(6);
    expect(revealAt(undefined, 0.5)).toBeUndefined();
  });
});

describe("tour script", () => {
  test("12 stages, one scene each, in order, every scene complete", () => {
    expect(STAGES).toHaveLength(12);
    expect(SCENES).toHaveLength(12);
    expect([...new Set(SCENES.map((s) => s.stage))]).toEqual(STAGES.map((_, i) => i + 1));
    for (const s of SCENES) {
      expect(s.title.length).toBeGreaterThan(5);
      expect(s.body.length).toBeGreaterThan(20);
      expect(s.action.length).toBeGreaterThan(5);
      expect(s.target).toMatch(/^\[data-[a-z-]+(="[a-z0-9_-]+")?\]$/);
      expect(sceneDuration(s)).toBeGreaterThanOrEqual(5000);
    }
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
  });

  test("the whole tour lasts 60 seconds: 12 scenes of 5 seconds", () => {
    expect(TOTAL_MS).toBe(60_000);
    for (const s of SCENES) expect(sceneDuration(s)).toBe(5000);
  });
});
