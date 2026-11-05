"use client";

/**
 * The guided tour player (Nov 2026). One click on "Open the demo" lands here and the tour plays by itself:
 * no account, no choice, no click needed until the final screen.
 *
 * - Time: one requestAnimationFrame loop feeds the pure state machine (src/lib/tour/machine.ts). Ticks are
 *   clamped, and playback pauses while the tab is hidden, so no explanation is skipped.
 * - Rendering: React re-renders only when what is visible changes (scene, typed length, reveal count). Progress
 *   bars, the virtual cursor and the spotlight are positioned on DOM nodes from the frame loop.
 * - Cursor and spotlight target the scene's SEMANTIC selector inside the stage (never screen coordinates); they
 *   are re-measured every frame, so they follow layout, scrolling and resizing on any screen size.
 * - Reduced motion: no cursor travel, no smooth scrolling, no animated transitions; states still change.
 * - The stage is a presentation of the ORQO interface: it ignores pointer input (except the final buttons), sends
 *   no request and writes nothing.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/orqo/ui";
import { INITIAL, overallProgress, revealAt, sceneProgress, tourReducer, typedText, type TourEvent, type TourState } from "@/lib/tour/machine";
import type { TourData } from "@/lib/tour/scenario";
import { config as zodConfig } from "zod";
import { SCENES, sceneDuration, STAGES } from "@/lib/tour/script";
import { TourShell, TourView, type ViewFrame } from "./views";

// No runtime code generation in the browser (CSP): zod, if bundled through a shared module, must not probe eval.
zodConfig({ jitless: true });

const DURATIONS = SCENES.map(sceneDuration);
const SCENE_INDEX = new Map(SCENES.map((s, i) => [s.id, i]));

interface Snap {
  index: number;
  paused: boolean;
  finished: boolean;
  /** Visible derived values: re-render only when they change. */
  typedLen: number;
  reveal: number | undefined;
  click: boolean;
}

function snapOf(s: TourState): Snap {
  const scene = SCENES[s.index];
  const p = sceneProgress(s, DURATIONS);
  return {
    index: s.index,
    paused: s.paused,
    finished: s.finished,
    typedLen: scene.type ? typedText(scene.type.text, p).length : 0,
    reveal: revealAt(scene.reveal, p),
    click: scene.cursor === "click" && p > 0.5 && p < 0.75,
  };
}

const same = (a: Snap, b: Snap) => a.index === b.index && a.paused === b.paused && a.finished === b.finished && a.typedLen === b.typedLen && a.reveal === b.reveal && a.click === b.click;

export function TourPlayer({ data }: { data: TourData }) {
  const router = useRouter();
  const machine = useRef<TourState>(INITIAL);
  const [snap, setSnap] = useState<Snap>(() => snapOf(INITIAL));
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const sceneBarRef = useRef<HTMLDivElement>(null);
  const totalBarRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef(-1);
  const reduced = useRef(false);
  const speed = useRef(1);

  const dispatch = useCallback((e: TourEvent) => {
    machine.current = tourReducer(machine.current, e, DURATIONS);
    const next = snapOf(machine.current);
    setSnap((prev) => (same(prev, next) ? prev : next));
  }, []);

  // Frame loop: time, progress bars, cursor and spotlight.
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Test hook only: ?speed=N (1–20) accelerates playback for automated tests. Default: real time (5 s per scene).
    const sp = Number(new URLSearchParams(window.location.search).get("speed"));
    speed.current = Number.isFinite(sp) && sp >= 1 && sp <= 20 ? sp : 1;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      if (document.visibilityState === "visible") dispatch({ type: "tick", dt: dt * speed.current });
      const s = machine.current;
      if (sceneBarRef.current) sceneBarRef.current.style.transform = `scaleX(${sceneProgress(s, DURATIONS)})`;
      if (totalBarRef.current) totalBarRef.current.style.transform = `scaleX(${overallProgress(s, DURATIONS)})`;
      place(s, Math.min(dt, 100) * speed.current);
      raf = requestAnimationFrame(frame);
    };
    // Cursor and spotlight glide toward their (possibly moving) target with exponential smoothing driven by the
    // frame clock: natural motion, no CSS transition to restart every frame, instant with reduced motion.
    const cur = { x: -40, y: -40 };
    const box = { x: 0, y: 0, w: 0, h: 0 };
    const ease = (dt: number, tau: number) => (reduced.current ? 1 : 1 - Math.exp(-dt / tau));
    const place = (s: TourState, dt: number) => {
      const stage = stageRef.current;
      const cursor = cursorRef.current;
      const spot = spotRef.current;
      if (!stage || !cursor || !spot) return;
      const scene = SCENES[s.index];
      const target = stage.querySelector<HTMLElement>(scene.target);
      if (!target || target.getClientRects().length === 0) {
        spot.style.opacity = "0";
        return;
      }
      // Bring the target into view once per scene (instant when motion is reduced).
      if (scrolledFor.current !== s.index && scrollerRef.current) {
        scrolledFor.current = s.index;
        const sr = scrollerRef.current.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        if (tr.top < sr.top + 16 || tr.bottom > sr.bottom - 16) target.scrollIntoView({ block: tr.height > sr.height * 0.7 ? "start" : "center", behavior: reduced.current || speed.current > 1 ? "auto" : "smooth" });
      }
      const base = stage.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const top = Math.max(r.top, base.top) - base.top;
      const bottom = Math.min(r.bottom, base.bottom) - base.top;
      const left = Math.max(r.left, base.left) - base.left;
      const right = Math.min(r.right, base.right) - base.left;
      const pad = 6;
      spot.style.opacity = bottom - top > 8 ? "1" : "0";
      const ks = ease(dt, 120);
      box.x += (left - pad - box.x) * ks;
      box.y += (top - pad - box.y) * ks;
      box.w += (Math.max(0, right - left + pad * 2) - box.w) * ks;
      box.h += (Math.max(0, bottom - top + pad * 2) - box.h) * ks;
      spot.style.transform = `translate(${box.x}px, ${box.y}px)`;
      spot.style.width = `${box.w}px`;
      spot.style.height = `${box.h}px`;
      // The cursor points into the target, near its start (where a person would click or type).
      const x = left + Math.min((right - left) * 0.3, 140);
      const y = top + Math.min((bottom - top) / 2, 28);
      const kc = ease(dt, 160);
      cur.x += (x - cur.x) * kc;
      cur.y += (y - cur.y) * kc;
      cursor.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
      cursor.dataset.target = scene.target;
    };
    raf = requestAnimationFrame(frame);
    const onVisible = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [dispatch]);

  // Keyboard: Space pause/resume, ← back, → skip, Esc exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        dispatch({ type: "toggle" });
      } else if (e.key === "ArrowRight") dispatch({ type: "next" });
      else if (e.key === "ArrowLeft") dispatch({ type: "prev" });
      else if (e.key === "Escape") router.push("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, router]);

  const scene = SCENES[snap.index];
  const replay = useCallback(() => {
    scrolledFor.current = -1;
    scrollerRef.current?.scrollTo({ top: 0 });
    dispatch({ type: "replay" });
  }, [dispatch]);

  const frame: ViewFrame = useMemo(() => {
    // Typed fields: complete for earlier scenes of the tour, partial for the current one.
    const typed: Record<string, string> = {};
    SCENES.slice(0, snap.index).forEach((s) => {
      if (s.type) typed[s.type.field] = s.type.text;
    });
    if (scene.type) typed[scene.type.field] = scene.type.text.slice(0, snap.typedLen);
    return { view: scene.view, typed, reveal: snap.reveal, sceneId: scene.id, passed: (id: string) => (SCENE_INDEX.get(id) ?? Infinity) < snap.index };
  }, [snap.index, snap.typedLen, snap.reveal, scene]);

  return (
    <div className="orqo-light fixed inset-0 flex flex-col bg-canvas" data-testid="tour" data-scene={scene.id} data-scene-index={snap.index} data-stage={scene.stage} data-paused={snap.paused} data-finished={snap.finished}>
      {/* Top bar: identity, stage, overall progress, optional controls. */}
      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-surface px-4 py-2.5 md:px-5">
        <Link href="/" className="text-[15px] font-semibold tracking-[0.18em] text-fg">
          ORQO
        </Link>
        <span className="rounded-md bg-caution-soft px-2 py-0.5 text-[11.5px] font-medium text-caution">Guided demo · fictional prospect · prepared data</span>
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <div className="flex items-baseline gap-2 text-[12.5px]">
            <span className="shrink-0 font-semibold text-brand" data-testid="tour-stage-number">
              Stage {scene.stage} of {STAGES.length}
            </span>
            <span className="truncate text-fg-muted" data-testid="tour-stage-title">
              {STAGES[scene.stage - 1]}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Demo progress" aria-valuemin={1} aria-valuemax={SCENES.length} aria-valuenow={snap.index + 1}>
            <div ref={totalBarRef} className="h-full origin-left bg-brand" style={{ transform: "scaleX(0)" }} data-testid="tour-total-bar" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Demo controls (optional)">
          <Ctl onClick={() => dispatch({ type: "prev" })} label="Back" testid="tour-back">
            ‹
          </Ctl>
          <Ctl onClick={() => dispatch({ type: "toggle" })} label={snap.paused ? "Resume" : "Pause"} testid="tour-pause" disabled={snap.finished}>
            {snap.paused ? "▶ Resume" : "❚❚ Pause"}
          </Ctl>
          <Ctl onClick={() => dispatch({ type: "next" })} label="Skip" testid="tour-skip">
            ›
          </Ctl>
          <Ctl onClick={replay} label="Replay" testid="tour-replay">
            ↺
          </Ctl>
          <Ctl onClick={() => router.push("/")} label="Exit" testid="tour-exit">
            ✕
          </Ctl>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* The ORQO interface, operated by the guided tour. */}
        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden" aria-label="ORQO interface (guided demo)">
          <div className="pointer-events-none h-full select-none">
            <TourShell nav={scene.nav}>
              <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7">
                <div key={scene.view} className="tour-fade">
                  <TourView f={frame} data={data} onReplay={replay} />
                </div>
              </div>
            </TourShell>
          </div>
          {/* Spotlight: dims everything but the focused element. */}
          <div ref={spotRef} aria-hidden className="pointer-events-none absolute left-0 top-0 rounded-xl ring-2 ring-brand/70 transition-opacity duration-300 motion-reduce:transition-none" style={{ boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.18)", opacity: 0 }} data-testid="tour-spotlight" />
          {/* Virtual cursor. */}
          <div ref={cursorRef} aria-hidden className="pointer-events-none absolute left-0 top-0 z-10" data-testid="tour-cursor">
            <svg width="22" height="22" viewBox="0 0 24 24" className="drop-shadow-md">
              <path d="M4 2l16 9-7 2-3 7z" fill="#111827" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            {snap.click && <span key={snap.index} className="tour-click absolute -left-2 -top-2 h-6 w-6 rounded-full bg-brand/50" data-testid="tour-click" />}
          </div>
        </div>

        {/* Narration: what ORQO is doing, why it matters, what happens. */}
        <aside className="relative z-20 shrink-0 border-t border-edge bg-surface px-5 py-4 lg:w-[360px] lg:border-l lg:border-t-0 lg:py-6" aria-live="polite">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-faint">
            Stage {scene.stage} · {STAGES[scene.stage - 1]}
          </div>
          <h2 className="mt-1.5 text-[19px] font-semibold leading-snug tracking-tight text-fg lg:text-[22px]" data-testid="tour-title">
            {scene.title}
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-fg-muted" data-testid="tour-body">
            {scene.body}
          </p>
          <p className="mt-3 flex items-start gap-2 text-[13px] text-fg" data-testid="tour-action">
            <span className="mt-[3px] inline-block h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
            {scene.action}
          </p>
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <div ref={sceneBarRef} className="h-full origin-left bg-brand" style={{ transform: "scaleX(0)" }} data-testid="tour-scene-bar" />
            </div>
            <div className="mt-1.5 flex justify-between text-[11.5px] text-fg-faint">
              <span>
                Scene {snap.index + 1} / {SCENES.length}
              </span>
              <span>{snap.finished ? "Demo complete" : snap.paused ? "Paused" : "Next scene starts automatically"}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Ctl({ onClick, label, testid, disabled, children }: { onClick: () => void; label: string; testid: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} disabled={disabled} data-testid={testid} className={cx("inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-edge-strong bg-surface px-2 text-[12.5px] font-medium text-fg hover:bg-subtle disabled:opacity-40")}>
      {children}
    </button>
  );
}
