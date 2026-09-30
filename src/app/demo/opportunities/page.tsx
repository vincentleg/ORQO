"use client";

import { demoHref } from "@/lib/demo-path";
import { useState } from "react";
import { OpportunityCard } from "@/components/network-bits";
import { ButtonLink, EmptyState, Eyebrow, Panel, VerdictBadge, cx, formatDate } from "@/components/ui";
import { isMatched, stageFor } from "@/lib/engine/orchestration";
import { useOrqo } from "@/lib/store";

const FILTERS = ["All", "New", "Matches", "Held back"] as const;
type Filter = (typeof FILTERS)[number];

export default function OpportunitiesPage() {
  const world = useOrqo((s) => s.world);
  const [filter, setFilter] = useState<Filter>("All");
  const opps = Object.values(world.opportunities).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
  const heldBack = Object.values(world.relationships).flatMap((r) =>
    (r.evaluations.at(-1)?.rejectedHypotheses ?? []).map((h) => ({ ...h, relationshipId: r.id, at: r.evaluations.at(-1)!.at })),
  );
  const shown = opps.filter((o) =>
    filter === "All" ? true : filter === "New" ? stageFor(world, o, world.viewerId) === "discovered" : filter === "Matches" ? isMatched(o) : false,
  );

  return (
    <div className="mx-auto max-w-[1280px] px-8 py-8">
      <Eyebrow>Opportunity graph</Eyebrow>
      <div className="mt-2 flex items-end justify-between">
        <h1 className="text-[26px] font-semibold tracking-tight">Opportunities</h1>
        <div className="flex rounded-lg border border-line p-0.5 text-[12.5px]">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cx("rounded-md px-3 py-1 transition-colors", filter === f ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink")}>
              {f}
              {f === "Held back" && <span className="ml-1.5 font-mono text-[10.5px] text-faint">{heldBack.length}</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[13.5px] text-muted">Every opportunity survived a critic that tried to reject it. The ones that did not are listed under Held back.</p>

      {filter === "Held back" ? (
        <Panel className="mt-6 divide-y divide-line">
          {heldBack.length === 0 && <EmptyState title="Nothing held back" body="The critic has not rejected any hypothesis yet." />}
          {heldBack.map((h) => {
            const r = world.relationships[h.relationshipId];
            const other = world.companies[r.companyIds[1]];
            return (
              <div key={h.relationshipId + h.patternId} className="flex items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] text-ink">{h.title}</span>
                    <span className="text-[12px] text-faint">
                      with {other.name} · tested {formatDate(h.at)}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {h.reasons.map((x) => (
                      <li key={x} className="text-[12.5px] text-muted">
                        — {x}
                      </li>
                    ))}
                  </ul>
                </div>
                <VerdictBadge verdict={h.verdict} />
              </div>
            );
          })}
        </Panel>
      ) : shown.length === 0 ? (
        <Panel className="mt-6">
          <EmptyState
            title="No opportunities here yet"
            body="Connect agents on a relationship. ORQO only surfaces what survives the critic."
            action={
              <ButtonLink href={demoHref("/connect/r-maya-lukas")} size="sm" variant="primary">
                Connect agents
              </ButtonLink>
            }
          />
        </Panel>
      ) : (
        <div className="mt-6 grid grid-cols-3 gap-4">
          {shown.map((o) => (
            <OpportunityCard key={o.id} world={world} o={o} />
          ))}
        </div>
      )}
    </div>
  );
}
