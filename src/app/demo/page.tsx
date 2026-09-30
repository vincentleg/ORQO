"use client";

import Link from "next/link";
import { OpportunityGraph } from "@/components/graph";
import { ActivityFeed, OpportunityCard, RelationshipRow } from "@/components/network-bits";
import { Arrow, ButtonLink, EmptyState, Eyebrow, Panel, PanelHeader } from "@/components/ui";
import { isMatched } from "@/lib/engine/orchestration";
import { useOrqo } from "@/lib/store";

export default function Overview() {
  const world = useOrqo((s) => s.world);
  const viewer = world.people[world.viewerId];
  const rels = Object.values(world.relationships).filter((r) => r.personIds.includes(viewer.id));
  const opps = Object.values(world.opportunities)
    .filter((o) => o.relationshipIds.some((r) => world.relationships[r].personIds.includes(viewer.id)))
    .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
  const active = opps.filter((o) => o.stage !== "rejected" && o.stage !== "dormant");
  const matches = opps.filter(isMatched);
  const now = Date.parse(world.now);
  const newSignals = Object.values(world.signals).filter((s) => now - Date.parse(s.occurredAt) < 30 * 86_400_000);
  const stats = [
    { label: "Relationships", value: rels.length, href: "/network" },
    { label: "Active opportunities", value: active.length, href: "/opportunities" },
    { label: "Business matches", value: matches.length, href: "/opportunities" },
    { label: "New signals", value: newSignals.length, href: "/signals" },
  ];

  return (
    <div className="mx-auto max-w-[1280px] px-8 py-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <Eyebrow>Autonomous business development network</Eyebrow>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ink">
            You meet the person. <span className="text-muted">ORQO finds the business.</span>
          </h1>
          <p className="mt-2 text-[13.5px] text-muted">
            {viewer.name.split(" ")[0]}&apos;s Business Agent is working {rels.length} relationships on both sides of every table.
          </p>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-4 divide-x divide-line rounded-xl border border-line bg-panel">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group px-5 py-4 transition-colors hover:bg-white/[0.02]">
            <div className="text-[12px] text-muted">{s.label}</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink">{s.value}</span>
              <Arrow className="text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-6">
        <Panel className="col-span-2 overflow-hidden">
          <PanelHeader
            eyebrow="Opportunity graph"
            title="Your network"
            action={
              <ButtonLink href="/network" size="sm" variant="ghost">
                Open graph <Arrow />
              </ButtonLink>
            }
          />
          <div className="bg-grid h-[380px] px-2">
            <OpportunityGraph world={world} proposal={Object.values(world.proposals).find((p) => p.status === "proposed")} />
          </div>
        </Panel>
        <Panel className="flex flex-col overflow-hidden">
          <PanelHeader eyebrow="Live" title="Agent activity" />
          <div className="max-h-[380px] flex-1 overflow-y-auto py-2">
            <ActivityFeed world={world} limit={12} />
          </div>
        </Panel>
      </div>

      <Panel className="mt-6" data-demo="relationships">
        <PanelHeader eyebrow="Relationship graph" title="People you've met" />
        <div className="divide-y divide-line">
          {rels
            .sort((a, b) => (a.status === "unevaluated" ? -1 : b.status === "unevaluated" ? 1 : b.encounter.date.localeCompare(a.encounter.date)))
            .map((r) => (
              <RelationshipRow key={r.id} world={world} r={r} />
            ))}
        </div>
      </Panel>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13.5px] font-medium text-ink">Recent opportunities</h2>
          <ButtonLink href="/opportunities" size="sm" variant="ghost">
            All opportunities <Arrow />
          </ButtonLink>
        </div>
        {opps.length === 0 ? (
          <Panel>
            <EmptyState
              title="No opportunities yet"
              body="Your agent held back every idea that did not survive the critic. Connect an agent to a relationship to start."
              action={
                <ButtonLink href="/connect/r-maya-lukas" variant="primary" size="sm">
                  Connect agents
                </ButtonLink>
              }
            />
          </Panel>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {opps.slice(0, 3).map((o) => (
              <OpportunityCard key={o.id} world={world} o={o} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
