"use client";

/**
 * The live mission (Phase 17C). Renders the persisted mission and, for members, DRIVES it: it calls the
 * Phase 17B execute endpoint while the mission is executable, one call at a time, following the bounded
 * policy of lib/missions/driver.ts (yielded → continue; busy/in progress → back off; errors → few retries;
 * terminal or a hard call budget → stop). Leases make a refresh, a second tab or a retry harmless; leaving
 * the page stops the loop and the mission resumes on the next visit. Viewers only re-read the mission.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { isActive } from "@/lib/missions/briefing";
import { initialDriverState, nextDecision, shouldDrive, type ExecuteOutcome, type StopReason } from "@/lib/missions/driver";
import type { MissionView } from "@/lib/missions/view";
import { AuthorityLine, BriefingView, PhaseBadge, phaseSentence, ProgressBar, StepList } from "./missions";
import { Button, Card, cx, focusRing } from "./ui";

type DriverUi = { kind: "idle" } | { kind: "working" } | { kind: "waiting" } | { kind: "retrying" } | { kind: "paused"; reason: StopReason };

const PAUSED: Record<StopReason, MessageKey> = {
  terminal: "missions.progress.working",
  unauthenticated: "missions.progress.pausedAuth",
  forbidden: "missions.progress.pausedErrors",
  not_found: "missions.progress.pausedErrors",
  budget: "missions.progress.pausedBudget",
  errors: "missions.progress.pausedErrors",
  waiting: "missions.progress.pausedWaiting",
};

/** Viewers re-read an active mission at most this many times, this often. */
const VIEWER_POLL = { every: 8_000, max: 40 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toView(body: Record<string, unknown>): MissionView | null {
  return body && typeof body === "object" && "mission" in body && "steps" in body ? (body as unknown as MissionView) : null;
}

export function MissionLive({ initial, locale, organizationId, canExecute, canCancel, names }: { initial: MissionView; locale: Locale; organizationId: string; canExecute: boolean; canCancel: boolean; names: Record<string, string> }) {
  const t = createTranslator(locale);
  const [view, setView] = useState(initial);
  const [driver, setDriver] = useState<DriverUi>(shouldDrive(initial.mission.status, canExecute) ? { kind: "working" } : { kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [cancelState, setCancelState] = useState<"idle" | "stopping" | "error">("idle");
  // Each start bumps the generation; a loop whose generation is stale exits (unmount, cancel, StrictMode remount).
  const generation = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const base = `/api/v1/organizations/${encodeURIComponent(organizationId)}/missions/${encodeURIComponent(initial.mission.id)}`;

  const halt = useCallback(() => {
    generation.current += 1;
    inflight.current?.abort();
    inflight.current = null;
  }, []);

  const refetch = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" }).catch(() => null);
    const v = res?.ok ? toView(await res.json().catch(() => null)) : null;
    if (v) setView(v);
    return v;
  }, [base]);

  const drive = useCallback(async () => {
    halt();
    const gen = generation.current;
    let st = initialDriverState();
    while (gen === generation.current) {
      const ctrl = new AbortController();
      inflight.current = ctrl;
      let outcome: ExecuteOutcome;
      try {
        const res = await fetch(`${base}/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: ctrl.signal });
        if (res.ok) {
          const body = (await res.json()) as Record<string, unknown>;
          const v = toView(body);
          if (v && gen === generation.current) setView(v);
          outcome = { kind: "state", state: String(body.state) };
        } else outcome = { kind: "http", status: res.status };
      } catch {
        if (ctrl.signal.aborted || gen !== generation.current) return;
        outcome = { kind: "network" };
      }
      if (gen !== generation.current) return;
      const r = nextDecision(st, outcome);
      st = r.state;
      if (r.decision.action === "stop") {
        setDriver(r.decision.reason === "terminal" ? { kind: "idle" } : { kind: "paused", reason: r.decision.reason });
        if (r.decision.reason !== "terminal") await refetch();
        return;
      }
      setDriver(r.decision.waiting ? { kind: "waiting" } : r.decision.retrying ? { kind: "retrying" } : { kind: "working" });
      if (r.decision.delayMs) await sleep(r.decision.delayMs);
    }
  }, [base, halt, refetch]);

  useEffect(() => {
    // Started from a timer (not inside the effect body): a StrictMode remount clears it before it fires.
    const timer = setTimeout(() => {
      if (shouldDrive(initial.mission.status, canExecute)) {
        void drive();
        return;
      }
      if (!isActive(initial)) return;
      // Viewers follow a mission a member is running: bounded re-reads, then a Refresh button.
      const gen = ++generation.current;
      void (async () => {
        for (let i = 0; i < VIEWER_POLL.max && gen === generation.current; i++) {
          await sleep(VIEWER_POLL.every);
          if (gen !== generation.current) return;
          const v = await refetch();
          if (v && !isActive(v)) return;
        }
      })();
    }, 0);
    return () => {
      clearTimeout(timer);
      halt();
    };
    // Starts once per mounted mission; later restarts go through Resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  async function cancel() {
    setCancelState("stopping");
    halt();
    const res = await fetch(`${base}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    const v = await refetch();
    setConfirming(false);
    // 409: already finished — the refetched mission tells the truth either way.
    if (res && (res.ok || res.status === 409) && v && !isActive(v)) {
      setCancelState("idle");
      setDriver({ kind: "idle" });
      return;
    }
    setCancelState("error");
    if (v && isActive(v) && canExecute) {
      setDriver({ kind: "working" });
      void drive();
    }
  }

  const active = isActive(view);
  const note: MessageKey | null = !active
    ? null
    : !canExecute
      ? "missions.progress.viewer"
      : driver.kind === "waiting"
        ? "missions.progress.waiting"
        : driver.kind === "retrying"
          ? "missions.progress.retrying"
          : driver.kind === "paused"
            ? PAUSED[driver.reason]
            : "missions.progress.working";

  return (
    <div className="space-y-8">
      <Card className="space-y-5 px-5 py-5 md:px-6" data-testid="mission-live" data-driver={driver.kind} data-status={view.mission.status}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PhaseBadge v={view} locale={locale} />
          {active && canCancel && !confirming && (
            <button type="button" onClick={() => setConfirming(true)} disabled={cancelState === "stopping"} className={cx("min-h-11 rounded-lg px-3 text-[13.5px] font-medium text-fg-muted hover:bg-subtle hover:text-fg", focusRing)} data-testid="mission-cancel">
              {t("missions.cancel.action")}
            </button>
          )}
        </div>
        <p className="text-[15px] text-fg" role="status" aria-live="polite" data-testid="mission-sentence">
          {phaseSentence(t, view, names)}
        </p>
        <ProgressBar v={view} locale={locale} />

        {confirming && (
          <div role="alertdialog" aria-modal="false" aria-labelledby="cancel-title" aria-describedby="cancel-body" className="rounded-xl border border-caution/30 bg-caution-soft px-4 py-4" data-testid="mission-cancel-confirm">
            <h2 id="cancel-title" className="text-[14.5px] font-semibold text-fg">
              {t("missions.cancel.confirmTitle")}
            </h2>
            <p id="cancel-body" className="mt-1 text-[13.5px] text-fg-muted">
              {t("missions.cancel.confirmBody")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button ref={keepRef} onClick={() => setConfirming(false)} disabled={cancelState === "stopping"} className="min-h-11" data-testid="mission-cancel-keep">
                {t("missions.cancel.keep")}
              </Button>
              <Button variant="primary" onClick={cancel} disabled={cancelState === "stopping"} className="min-h-11 bg-critical hover:bg-critical/90" data-testid="mission-cancel-confirm-button">
                {cancelState === "stopping" ? t("missions.cancel.stopping") : t("missions.cancel.confirm")}
              </Button>
            </div>
          </div>
        )}
        {cancelState === "error" && (
          <p role="alert" className="rounded-lg bg-critical-soft px-4 py-2.5 text-[13.5px] text-critical">
            {t("missions.cancel.error")}
          </p>
        )}

        {note && (
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-fg-muted" data-testid="mission-driver-note">
            <span>{t(note)}</span>
            {driver.kind === "paused" && canExecute && driver.reason !== "unauthenticated" && (
              <Button size="sm" variant="primary" onClick={() => {
                  setDriver({ kind: "working" });
                  void drive();
                }}
                className="min-h-11"
                data-testid="mission-resume">
                {t("missions.progress.resume")}
              </Button>
            )}
            {!canExecute && (
              <Button size="sm" onClick={() => void refetch()} className="min-h-11">
                {t("missions.progress.refresh")}
              </Button>
            )}
          </div>
        )}

        {active ? (
          <StepList v={view} locale={locale} names={names} />
        ) : (
          <details className="group">
            <summary className={cx("cursor-pointer rounded text-[13px] font-medium text-fg-muted hover:text-fg", focusRing)}>{t("missions.progress.label")}</summary>
            <div className="mt-3">
              <StepList v={view} locale={locale} names={names} />
            </div>
          </details>
        )}
        <div className="border-t border-edge pt-4">
          <AuthorityLine v={view} locale={locale} />
        </div>
      </Card>

      {!active && <BriefingView v={view} locale={locale} names={names} />}
    </div>
  );
}
