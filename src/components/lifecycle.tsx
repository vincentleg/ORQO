"use client";

import type { LifecycleStage, Opportunity, World } from "@/lib/domain/types";
import { isMatched, nextStage } from "@/lib/engine/orchestration";
import { useOrqo } from "@/lib/store";
import { Button, Eyebrow, Panel, cx, formatDate, stageLabel } from "./ui";

const PATH: LifecycleStage[] = ["discovered", "interested", "mutual-interest", "meeting", "qualified", "pilot", "partnership", "revenue"];

export function Lifecycle({ stage }: { stage: LifecycleStage }) {
  const idx = PATH.indexOf(stage);
  const ended = stage === "rejected" || stage === "dormant";
  return (
    <div className="flex items-center gap-1">
      {PATH.map((s, i) => {
        const reached = !ended && i <= idx;
        const current = !ended && i === idx;
        return (
          <div key={s} className="flex flex-1 flex-col gap-2">
            <div className={cx("h-[3px] rounded-full transition-colors duration-500", reached ? (i >= 2 ? "bg-match" : "bg-accent") : "bg-white/[0.06]")} />
            <span className={cx("font-mono text-[10px] uppercase tracking-wider", current ? "text-ink" : reached ? "text-muted" : "text-faint")}>
              {s === "revenue" ? "Customer / revenue" : stageLabel(s)}
            </span>
          </div>
        );
      })}
      {ended && <span className="ml-3 font-mono text-[10px] uppercase tracking-wider text-reject">{stageLabel(stage)}</span>}
    </div>
  );
}

const NEXT_COPY: Partial<Record<LifecycleStage, { action: string; reason: string }>> = {
  meeting: { action: "Record meeting held", reason: "First meeting held." },
  qualified: { action: "Mark qualified", reason: "Both sides confirmed scope, owners and budget." },
  pilot: { action: "Start pilot", reason: "Pilot scoped and started." },
  partnership: { action: "Sign partnership", reason: "Commercial agreement signed." },
  revenue: { action: "Record first revenue", reason: "First customer revenue booked." },
};

/** Outcome tracking feeds the future Outcome Graph: every transition is recorded with a reason. */
export function OutcomeControls({ world, opp }: { world: World; opp: Opportunity }) {
  const advance = useOrqo((s) => s.advance);
  if (!isMatched(opp)) return null;
  const next = nextStage(opp.stage);
  const copy = next ? NEXT_COPY[next] : undefined;
  const history = world.outcomes.filter((o) => o.opportunityId === opp.id);
  return (
    <Panel className="p-5">
      <Eyebrow>Outcome tracking</Eyebrow>
      <ol className="mt-3 space-y-2">
        {history.map((h) => (
          <li key={h.id} className="flex gap-2.5 text-[12px]">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-match" />
            <span className="text-muted">
              <span className="text-ink">{stageLabel(h.stage)}</span> · {formatDate(h.recordedAt)} — {h.reason}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        {next && copy && (
          <Button size="sm" variant="secondary" onClick={() => advance(opp.id, next, copy.reason)}>
            {copy.action}
          </Button>
        )}
        {opp.stage !== "rejected" && opp.stage !== "revenue" && (
          <Button size="sm" variant="ghost" onClick={() => advance(opp.id, "dormant", "Parked by participants after meeting.")}>
            Park as dormant
          </Button>
        )}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">Every outcome, including failures, trains which relationships become valuable.</p>
    </Panel>
  );
}
