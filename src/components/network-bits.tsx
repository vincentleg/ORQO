"use client";

import Link from "next/link";
import type { AgentModule, Opportunity, Relationship, World } from "@/lib/domain/types";
import { stageFor } from "@/lib/engine/orchestration";
import { Arrow, Avatar, ButtonLink, Chip, CompanyMark, ConfidenceMeter, StageBadge, cx, formatDate, relativeTo } from "./ui";

const MODULE: Record<AgentModule, { label: string; color: string }> = {
  research: { label: "Research", color: "#8d949e" },
  bilateral: { label: "Bilateral", color: "#a78bfa" },
  discovery: { label: "Discovery", color: "#8fa8ff" },
  critic: { label: "Critic", color: "#f07a7a" },
  orchestration: { label: "Orchestration", color: "#5ee6c0" },
  reevaluation: { label: "Re-evaluation", color: "#f5b85c" },
  network: { label: "Graph", color: "#60a5fa" },
};

export function ActivityFeed({ world, limit = 8 }: { world: World; limit?: number }) {
  const items = world.activity.slice(0, limit);
  return (
    <ol className="relative space-y-0">
      {items.map((a, i) => (
        <li key={a.id} className="relative flex gap-3 px-5 py-2.5">
          <div className="relative flex w-3 justify-center pt-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: MODULE[a.module].color }} />
            {i < items.length - 1 && <span className="absolute top-4 h-[calc(100%+4px)] w-px bg-line" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
              <span style={{ color: MODULE[a.module].color }}>{MODULE[a.module].label}</span>
              <span className="text-faint">{relativeTo(a.at, world.now)}</span>
            </div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{a.message}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function relationshipState(world: World, r: Relationship): { label: string; tone: "accent" | "match" | "neutral" | "signal" | "quiet" } {
  const last = r.evaluations[r.evaluations.length - 1];
  switch (r.status) {
    case "unevaluated":
      return { label: "Agents not connected", tone: "quiet" };
    case "matched":
      return { label: "Business match", tone: "match" };
    case "active":
      return { label: last?.trigger.kind === "signal" ? "Re-activated by signal" : "Opportunity found", tone: last?.trigger.kind === "signal" ? "signal" : "accent" };
    default:
      return { label: `No strong opportunity yet · watching ${last?.watchConditions.length ?? 0}`, tone: "neutral" };
  }
}

export function RelationshipRow({ world, r }: { world: World; r: Relationship }) {
  const otherId = r.personIds.find((p) => p !== world.viewerId) ?? r.personIds[1];
  const other = world.people[otherId];
  const company = world.companies[other.companyId];
  const state = relationshipState(world, r);
  const opp = r.evaluations.at(-1)?.opportunityIds[0];
  return (
    <div className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.015]">
      <Avatar person={other} accent={company.accent} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-ink">{other.name}</span>
          <span className="text-[12px] text-faint">
            {other.role} · {company.name}
          </span>
        </div>
        <div className="mt-0.5 text-[12px] text-muted">
          Met at {r.encounter.event} · {relativeTo(r.encounter.date, world.now)}
        </div>
      </div>
      <Chip tone={state.tone}>{state.label}</Chip>
      <div className="w-[150px] text-right">
        {r.status === "unevaluated" ? (
          <ButtonLink href={`/connect/${r.id}`} size="sm" variant="primary">
            Connect agents
          </ButtonLink>
        ) : opp ? (
          <ButtonLink href={`/opportunities/${opp}`} size="sm" variant="ghost">
            View opportunity <Arrow />
          </ButtonLink>
        ) : (
          <ButtonLink href={`/connect/${r.id}`} size="sm" variant="ghost">
            See reasoning <Arrow />
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

export function OpportunityCard({ world, o, className }: { world: World; o: Opportunity; className?: string }) {
  const stage = stageFor(world, o, world.viewerId);
  return (
    <Link
      href={`/opportunities/${o.id}`}
      className={cx("group block rounded-xl border border-line bg-panel p-5 transition-all hover:border-line-strong hover:bg-panel-2", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex -space-x-1.5">
          {o.companyIds.map((cid) => (
            <span key={cid} className="rounded-md ring-2 ring-panel">
              <CompanyMark company={world.companies[cid]} size={26} />
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {o.delta && <Chip tone="signal">{o.kind === "multi" ? "Network" : o.trigger.kind === "signal" ? "New · signal" : "Updated"}</Chip>}
          <StageBadge stage={stage} />
        </div>
      </div>
      <h3 className="mt-4 text-[15px] font-medium leading-snug text-ink">{o.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{o.summary}</p>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5">
        <ConfidenceMeter level={o.confidence.level} />
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">{o.types.slice(0, 2).join(" · ")}</span>
      </div>
      <div className="mt-2 text-[11.5px] text-faint">Discovered {formatDate(o.discoveredAt)}</div>
    </Link>
  );
}
