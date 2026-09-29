"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PACES, SCENARIOS } from "@/lib/autodemo/scenarios";
import { playScenario, stopScenario } from "@/lib/autodemo/runner";
import { useAutoDemo } from "@/lib/autodemo/store";
import { useOrqo } from "@/lib/store";
import { Avatar, Button, CompanyMark, Eyebrow, cx } from "./ui";

function formatSeconds(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

function useControls() {
  const router = useRouter();
  const set = useAutoDemo((s) => s.set);
  const play = useCallback(
    (scenarioId: string) => {
      const scenario = SCENARIOS.find((s) => s.id === scenarioId);
      if (!scenario) return;
      set({ status: "playing", selectorOpen: false, scenarioId, finale: false, caption: undefined });
      void playScenario(scenario, { navigate: (p) => router.push(p, { scroll: true }) });
    },
    [router, set],
  );
  const exit = useCallback(() => {
    stopScenario();
    set({ status: "idle", finale: false, caption: undefined, selectorOpen: false });
  }, [set]);
  const togglePause = useCallback(() => {
    const { status } = useAutoDemo.getState();
    if (status === "playing") set({ status: "paused" });
    else if (status === "paused") set({ status: "playing" });
  }, [set]);
  const restart = useCallback(() => {
    const id = useAutoDemo.getState().scenarioId;
    if (id) play(id);
  }, [play]);
  const skip = useCallback(() => set({ skipToken: useAutoDemo.getState().skipToken + 1 }), [set]);
  return { play, exit, togglePause, restart, skip };
}

export function PlayDemoButton() {
  const set = useAutoDemo((s) => s.set);
  return (
    <button
      onClick={() => set({ selectorOpen: true })}
      className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden>
        <path d="M0.5 0.8v7.4L7.2 4.5z" fill="currentColor" />
      </svg>
      Play demo
    </button>
  );
}

function ScenarioSelector({ onPlay }: { onPlay: (id: string) => void }) {
  const open = useAutoDemo((s) => s.selectorOpen);
  const pace = useAutoDemo((s) => s.pace);
  const hideSidebar = useAutoDemo((s) => s.hideSidebar);
  const set = useAutoDemo((s) => s.set);
  const world = useOrqo((s) => s.world);
  const reset = useOrqo((s) => s.reset);
  const [choice, setChoice] = useState(SCENARIOS[0].id);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-bg/70 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => set({ selectorOpen: false })}
        >
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[560px] rounded-2xl border border-line-strong bg-panel shadow-2xl"
            role="dialog"
            aria-label="ORQO demo"
          >
            <div className="border-b border-line px-6 py-5">
              <Eyebrow>ORQO demo</Eyebrow>
              <h2 className="mt-2 text-[18px] font-semibold tracking-tight">Watch an autonomous business relationship turn into a real opportunity.</h2>
            </div>
            <div className="px-6 py-5">
              <Eyebrow className="mb-2.5">Scenario</Eyebrow>
              <div className="space-y-2">
                {SCENARIOS.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setChoice(s.id)}
                    className={cx("flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors", choice === s.id ? "border-accent/40 bg-accent/[0.05]" : "border-line hover:border-line-strong")}
                  >
                    <span className={cx("mt-1 h-3 w-3 shrink-0 rounded-full border", choice === s.id ? "border-accent bg-accent" : "border-line-strong")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-ink">{s.title}</span>
                        {i === 0 && <span className="font-mono text-[9.5px] uppercase tracking-wider text-accent">Primary</span>}
                        <span className="ml-auto font-mono text-[10.5px] text-faint">~{formatSeconds(s.approxSeconds * pace)}</span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{s.subtitle}</p>
                      <div className="mt-2 flex items-center gap-1.5">
                        {s.people.map((p) => (
                          <Avatar key={p} person={world.people[p]} accent={world.companies[world.people[p].companyId].accent} size={18} />
                        ))}
                        <span className="mx-1 h-3 w-px bg-line" />
                        {s.companies.map((c) => (
                          <CompanyMark key={c} company={world.companies[c]} size={18} />
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between">
                <div>
                  <Eyebrow className="mb-2">Duration</Eyebrow>
                  <div className="flex rounded-lg border border-line p-0.5 text-[12px]">
                    {PACES.map((p) => (
                      <button key={p.id} onClick={() => set({ pace: p.factor })} className={cx("rounded-md px-3 py-1 transition-colors", pace === p.factor ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink")}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
                  <input type="checkbox" checked={hideSidebar} onChange={(e) => set({ hideSidebar: e.target.checked })} className="accent-[#8fa8ff]" />
                  Full-width layout (hide sidebar)
                </label>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-line px-6 py-4">
              <Button variant="ghost" size="sm" onClick={() => reset()}>
                Reset
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => set({ selectorOpen: false })}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => onPlay(choice)} className="min-w-[140px] font-mono tracking-wider">
                  ▶ PLAY DEMO
                </Button>
              </div>
            </div>
            <div className="px-6 pb-4 text-[11px] text-faint">Runs the real app on the deterministic engine; no external API calls. Space pause · R restart · → skip · Esc exit.</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Caption() {
  const caption = useAutoDemo((s) => s.caption);
  const finale = useAutoDemo((s) => s.finale);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-[110] flex justify-center">
      <AnimatePresence mode="wait">
        {caption && !finale && (
          <motion.div
            key={caption.key}
            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.35 }}
            className="rounded-xl border border-white/10 bg-bg/80 px-6 py-3 text-center shadow-2xl backdrop-blur-xl"
            data-testid="demo-caption"
          >
            <div className="font-mono text-[13px] font-medium uppercase tracking-[0.2em] text-ink">{caption.text}</div>
            {caption.sub && <div className="mt-1 text-[12.5px] text-muted">{caption.sub}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Finale() {
  const finale = useAutoDemo((s) => s.finale);
  const scenarioId = useAutoDemo((s) => s.scenarioId);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  return (
    <AnimatePresence>
      {finale && scenario && (
        <motion.div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[105] flex h-[40vh] items-end justify-center pb-24"
          style={{ background: "linear-gradient(to top, rgba(7,8,10,0.97) 50%, rgba(7,8,10,0.82) 75%, transparent)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2 }}
          data-testid="demo-finale"
        >
          <motion.div className="text-center" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }}>
            <h2 className="text-[34px] font-semibold tracking-tight text-ink">{scenario.finale.title}</h2>
            <p className="mt-2 text-[17px] text-muted">{scenario.finale.line}</p>
            {scenario.finale.small && <div className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.3em] text-faint">{scenario.finale.small}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Controls({ controls }: { controls: ReturnType<typeof useControls> }) {
  const status = useAutoDemo((s) => s.status);
  const sceneIndex = useAutoDemo((s) => s.sceneIndex);
  const sceneCount = useAutoDemo((s) => s.sceneCount);
  const sceneTitle = useAutoDemo((s) => s.sceneTitle);
  const set = useAutoDemo((s) => s.set);
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const poke = () => {
      setVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 2500);
    };
    poke();
    window.addEventListener("mousemove", poke);
    return () => {
      window.removeEventListener("mousemove", poke);
      clearTimeout(hideTimer.current);
    };
  }, []);

  const finished = status === "finished";
  const shown = visible || status !== "playing";
  const progress = sceneCount ? (finished ? 1 : (sceneIndex + 0.5) / sceneCount) : 0;
  const btn = "rounded-md px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted transition-colors hover:bg-white/[0.06] hover:text-ink";

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-[115] h-[2px] bg-white/[0.04]">
        <motion.div className="h-full bg-accent/70" animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
      </div>
      <motion.div
        className="fixed bottom-4 left-1/2 z-[115] -translate-x-1/2"
        animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 8 }}
        transition={{ duration: 0.25 }}
        style={{ pointerEvents: shown ? "auto" : "none" }}
        data-testid="demo-controls"
      >
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-panel/90 px-2 py-1 shadow-2xl backdrop-blur-xl">
          <span className="px-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">
            {finished ? "Finished" : `Scene ${sceneIndex + 1} / ${sceneCount}`}
            <span className="ml-2 normal-case tracking-normal text-muted">{finished ? "" : sceneTitle}</span>
          </span>
          <span className="h-4 w-px bg-line" />
          {finished ? (
            <>
              <button className={btn} onClick={controls.restart}>
                Replay
              </button>
              <button className={btn} onClick={() => set({ selectorOpen: true })}>
                Choose another scenario
              </button>
            </>
          ) : (
            <>
              <button className={btn} onClick={controls.togglePause}>
                {status === "paused" ? "Resume" : "Pause"}
              </button>
              <button className={btn} onClick={controls.skip}>
                Skip
              </button>
              <button className={btn} onClick={controls.restart}>
                Restart
              </button>
            </>
          )}
          <button className={btn} onClick={controls.exit}>
            Exit
          </button>
        </div>
      </motion.div>
    </>
  );
}

export function AutoDemoLayer() {
  const status = useAutoDemo((s) => s.status);
  const controls = useControls();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useAutoDemo.getState().status === "idle" || e.target instanceof HTMLInputElement) return;
      if (e.key === " ") {
        e.preventDefault();
        controls.togglePause();
      } else if (e.key === "r" || e.key === "R") controls.restart();
      else if (e.key === "ArrowRight") controls.skip();
      else if (e.key === "Escape") controls.exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls]);

  return (
    <>
      <ScenarioSelector onPlay={controls.play} />
      {status !== "idle" && (
        <>
          <Caption />
          <Finale />
          <Controls controls={controls} />
        </>
      )}
    </>
  );
}
