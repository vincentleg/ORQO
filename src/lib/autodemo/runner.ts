"use client";

import { useOrqo } from "@/lib/store";
import type { World } from "@/lib/domain/types";
import { demoHref } from "@/lib/demo-path";
import { getDemoHandler } from "./handlers";
import { useAutoDemo } from "./store";
import type { DemoAction, DemoHandler, DemoScenario, DemoSetupStep, Dynamic } from "./types";

class Cancelled extends Error {}

export interface RunnerDeps {
  navigate: (path: string) => void;
}

let generation = 0;
let captionKey = 0;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const resolve = <T,>(v: Dynamic<T>, world: World): T | undefined => (typeof v === "function" ? (v as (w: World) => T | undefined)(world) : v);

/** Cancels any running scenario. The app keeps whatever state it reached. */
export function stopScenario(): void {
  generation += 1;
}

export async function playScenario(scenario: DemoScenario, deps: RunnerDeps): Promise<void> {
  const gen = ++generation;
  const demo = useAutoDemo.getState;
  const orqo = useOrqo.getState;
  const check = () => {
    if (gen !== generation) throw new Cancelled();
  };
  let skipToken = demo().skipToken;

  /** Paced wait that honours pause and skip. */
  const sleep = async (ms: number) => {
    let left = ms * demo().pace;
    while (left > 0) {
      check();
      if (demo().skipToken !== skipToken) return;
      await delay(50);
      if (demo().status === "playing") left -= 50;
    }
  };
  const until = async (pred: () => boolean, timeoutMs: number, what: string) => {
    const start = Date.now();
    while (!pred()) {
      check();
      if (Date.now() - start > timeoutMs) throw new Error(`Auto demo timed out waiting for ${what}`);
      await delay(60);
    }
  };
  const here = () => window.location.pathname + window.location.search;
  /** Scenario paths are demo-relative ("/signals"); the demo is mounted under DEMO_BASE. */
  const navigate = async (demoPath: string) => {
    const path = demoHref(demoPath);
    if (here() !== path) {
      deps.navigate(path);
      await until(() => here() === path, 6000, `navigation to ${path}`);
    }
    await delay(450);
  };
  const handler = async (name: DemoHandler) => {
    await until(() => Boolean(getDemoHandler(name)), 6000, `handler ${name}`);
    getDemoHandler(name)?.({ pace: demo().pace });
  };
  const scrollTo = async (target: string, offset = 88) => {
    await until(() => Boolean(document.querySelector(`[data-demo="${target}"]`)), 5000, `element ${target}`);
    const el = document.querySelector(`[data-demo="${target}"]`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
  };

  const setup = async (step: DemoSetupStep) => {
    const s = orqo();
    switch (step.type) {
      case "RESET":
        s.reset();
        return;
      case "CONNECT_INSTANT":
        s.commit(step.relationshipId, s.evaluate(step.relationshipId));
        return;
      case "FAST_FORWARD_INSTANT":
        s.fastForward();
        return;
      case "REEVALUATE_INSTANT":
        s.reevaluate({ searchNetwork: step.searchNetwork });
        return;
    }
  };

  const perform = async (a: DemoAction) => {
    const world = orqo().world;
    switch (a.type) {
      case "NAVIGATE": {
        const path = resolve(a.to, world);
        if (path) await navigate(path);
        return;
      }
      case "WAIT":
        return sleep(a.ms);
      case "WAIT_FOR":
        return until(() => a.until(orqo().world), a.timeoutMs ?? 30_000, "demo state");
      case "SHOW_CAPTION":
        demo().set({ caption: { text: a.text, sub: a.sub, key: ++captionKey } });
        return;
      case "HIDE_CAPTION":
        demo().set({ caption: undefined });
        return;
      case "SCROLL_TO":
        return scrollTo(a.target, a.offset);
      case "SCROLL_TOP":
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      case "CONNECT_AGENTS":
        return handler("connect.run");
      case "SET_CONSENT": {
        const id = resolve(a.opportunityId, world);
        if (id) orqo().respond(id, a.personId, a.response);
        return;
      }
      case "VIEW_AS":
        orqo().setViewer(a.personId);
        return;
      case "OPEN_MEETING_BRIEF": {
        const id = resolve(a.opportunityId, world);
        orqo().dismissCelebration();
        if (id) await navigate(`/opportunities/${id}/match`);
        return;
      }
      case "FAST_FORWARD":
        return handler("signals.fastForward");
      case "RUN_REEVALUATION":
        return handler("signals.reevaluate");
      case "SEARCH_NETWORK":
        orqo().searchNetwork();
        return;
      case "CREATE_MULTI_COMPANY_OPPORTUNITY":
        return handler("network.create");
      case "FINISH":
        demo().set({ status: "finished", finale: true, caption: undefined });
        return;
    }
  };

  try {
    demo().set({ scenarioId: scenario.id, sceneIndex: 0, sceneCount: scenario.scenes.length, sceneTitle: scenario.scenes[0]?.title ?? "", finale: false, caption: undefined });
    // Leave the current screen first so its timers unmount before state is reset.
    await navigate("/");
    window.scrollTo({ top: 0 });
    for (const step of scenario.setup) await setup(step);
    await delay(300);
    for (const [i, scene] of scenario.scenes.entries()) {
      check();
      skipToken = demo().skipToken;
      demo().set({ sceneIndex: i, sceneTitle: scene.title });
      for (const action of scene.actions) {
        check();
        await perform(action);
      }
    }
  } catch (e) {
    if (e instanceof Cancelled) return;
    console.error("[orqo] auto demo stopped", e);
    if (gen === generation) demo().set({ status: "finished", caption: undefined });
  }
}
