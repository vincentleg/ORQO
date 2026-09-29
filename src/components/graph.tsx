"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import type { NetworkProposal, Opportunity, Relationship, World } from "@/lib/domain/types";
import { isMatched } from "@/lib/engine/orchestration";
import { cx, monogram } from "./ui";

export type Selection = { kind: "company"; id: string } | { kind: "opportunity"; id: string } | { kind: "proposal"; id: string };

interface Pt {
  x: number;
  y: number;
}

const W = 1000;
const H = 620;
const RX = 385;
const RY = 225;
const CENTER: Pt = { x: 500, y: 330 };

function layout(world: World) {
  const viewerCompany = world.people[world.viewerId].companyId;
  const others = [...new Set(Object.values(world.relationships).flatMap((r) => r.companyIds))].filter((id) => id !== viewerCompany);
  const pos: Record<string, Pt> = { [viewerCompany]: CENTER };
  const angles = others.length === 4 ? [-140, -40, 40, 140] : others.map((_, i) => -150 + (300 / Math.max(1, others.length - 1)) * i);
  others.forEach((id, i) => {
    const a = (angles[i] * Math.PI) / 180;
    pos[id] = { x: CENTER.x + Math.cos(a) * RX, y: CENTER.y + Math.sin(a) * RY };
  });
  return { pos, viewerCompany };
}

function oppPoint(pos: Record<string, Pt>, companyIds: string[]): Pt {
  const pts = companyIds.map((id) => pos[id]).filter(Boolean);
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  if (pts.length <= 2) return c;
  return { x: c.x + (c.x - CENTER.x) * 1.2, y: c.y + (c.y - CENTER.y) * 1.2 };
}

const curve = (a: Pt, b: Pt, bend = 0.12) => {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const nx = -(b.y - a.y) * bend;
  const ny = (b.x - a.x) * bend;
  return `M${a.x},${a.y} Q${mx + nx},${my + ny} ${b.x},${b.y}`;
};

function relStyle(r: Relationship) {
  switch (r.status) {
    case "matched":
      return { stroke: "#5ee6c0", width: 1.6, dash: undefined, opacity: 0.8 };
    case "active":
      return { stroke: "#8fa8ff", width: 1.3, dash: undefined, opacity: 0.7 };
    case "dormant":
    case "watching":
      return { stroke: "#ffffff", width: 1, dash: "3 6", opacity: 0.22 };
    default:
      return { stroke: "#ffffff", width: 1, dash: "1 5", opacity: 0.25 };
  }
}

function oppColor(o: Opportunity) {
  return isMatched(o) ? "#5ee6c0" : "#8fa8ff";
}

interface GraphProps {
  world: World;
  selected?: Selection;
  onSelect?: (s: Selection | undefined) => void;
  proposal?: NetworkProposal;
  highlight?: string[];
  compact?: boolean;
  className?: string;
}

export function OpportunityGraph({ world, selected, onSelect, proposal, highlight = [], compact, className }: GraphProps) {
  const { pos, viewerCompany } = useMemo(() => layout(world), [world]);
  const [hover, setHover] = useState<string>();
  const opps = Object.values(world.opportunities).filter((o) => o.stage !== "rejected");
  const rels = Object.values(world.relationships);
  const now = Date.parse(world.now);
  const signals = Object.values(world.signals).filter((s) => now - Date.parse(s.occurredAt) < 45 * 86_400_000);
  const focusId = hover ?? (selected ? selected.id : undefined);
  const focusCompanies = new Set<string>(
    focusId
      ? world.opportunities[focusId]?.companyIds ?? (proposal && focusId === proposal.id ? proposal.opportunity.companyIds : [focusId])
      : [],
  );
  const dim = (ids: string[]) => focusId !== undefined && !ids.some((id) => focusCompanies.has(id) || id === focusId);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cx("h-full w-full select-none", className)} onClick={() => onSelect?.(undefined)}>
      <defs>
        <radialGradient id="halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8fa8ff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#8fa8ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="halo-match" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5ee6c0" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#5ee6c0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={CENTER.x} cy={CENTER.y} r={260} fill="url(#halo)" />
      <ellipse cx={CENTER.x} cy={CENTER.y} rx={RX} ry={RY} fill="none" stroke="white" strokeOpacity={0.04} />

      {rels.map((r) => {
        const [a, b] = r.companyIds.map((id) => pos[id]);
        const s = relStyle(r);
        return (
          <path
            key={r.id}
            d={curve(a, b, 0.08)}
            fill="none"
            stroke={s.stroke}
            strokeWidth={s.width}
            strokeDasharray={s.dash}
            strokeOpacity={dim(r.companyIds) ? 0.06 : s.opacity}
            className={r.status === "matched" ? "edge-flow" : undefined}
            style={{ transition: "stroke-opacity 200ms" }}
          />
        );
      })}

      {opps.map((o) => {
        const p = oppPoint(pos, o.companyIds);
        const color = oppColor(o);
        return o.companyIds.map((cid) => (
          <motion.path
            key={`${o.id}-${cid}`}
            d={`M${p.x},${p.y} L${pos[cid].x},${pos[cid].y}`}
            stroke={color}
            strokeWidth={o.kind === "multi" ? 1.8 : 1.1}
            strokeOpacity={dim(o.companyIds) ? 0.05 : o.kind === "multi" ? 0.8 : 0.55}
            fill="none"
            className={o.kind === "multi" ? "edge-flow" : undefined}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        ));
      })}

      {proposal && proposal.status === "proposed" && (
        <g>
          {proposal.opportunity.companyIds.map((cid) => {
            const p = oppPoint(pos, proposal.opportunity.companyIds);
            return (
              <path key={cid} d={`M${p.x},${p.y} L${pos[cid].x},${pos[cid].y}`} stroke="#f5b85c" strokeWidth={1.4} strokeOpacity={0.7} className="edge-flow" fill="none" />
            );
          })}
        </g>
      )}

      {Object.keys(pos).map((cid) => {
        const c = world.companies[cid];
        const p = pos[cid];
        const isViewer = cid === viewerCompany;
        const r = isViewer ? 38 : 30;
        const person = Object.values(world.people).find((x) => x.companyId === cid);
        const rel = rels.find((x) => x.companyIds.includes(cid) && !isViewer);
        const isSel = selected?.id === cid;
        const lit = highlight.includes(cid);
        const hasSignal = signals.some((s) => s.companyId === cid);
        return (
          <g
            key={cid}
            transform={`translate(${p.x},${p.y})`}
            className="cursor-pointer"
            opacity={dim([cid]) ? 0.3 : 1}
            style={{ transition: "opacity 200ms" }}
            onMouseEnter={() => setHover(cid)}
            onMouseLeave={() => setHover(undefined)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.({ kind: "company", id: cid });
            }}
          >
            {(lit || isSel) && <circle r={r + 10} fill="none" stroke={c.accent} strokeOpacity={0.5} className="pulse-ring" />}
            <circle r={r + 5} fill="none" stroke={c.accent} strokeOpacity={isSel ? 0.7 : 0.14} />
            <circle r={r} fill="#0c0e11" stroke={c.accent} strokeOpacity={0.55} strokeWidth={1.2} />
            <circle r={r} fill={c.accent} fillOpacity={0.09} />
            <text textAnchor="middle" dy="0.36em" fontSize={isViewer ? 18 : 15} fontWeight={600} fill={c.accent} letterSpacing="-0.02em">
              {monogram(c.name)}
            </text>
            {hasSignal && (
              <g transform={`translate(${r * 0.72},${-r * 0.72})`}>
                <circle r={9} fill="#f5b85c" fillOpacity={0.25} className="pulse-ring" />
                <circle r={4.5} fill="#f5b85c" />
              </g>
            )}
            <text y={r + 20} textAnchor="middle" fontSize={13} fontWeight={500} fill="#e9ebee">
              {c.name}
            </text>
            {!compact && person && (
              <text y={r + 36} textAnchor="middle" fontSize={11} fill="#8d949e">
                {person.name}
                {isViewer ? " · you" : ""}
              </text>
            )}
            {!compact && rel && (
              <text y={r + 51} textAnchor="middle" fontSize={9.5} fill="#5c636d" fontFamily="var(--font-geist-mono)" letterSpacing="0.08em">
                {rel.status === "unevaluated" ? "AGENTS NOT CONNECTED" : rel.status === "dormant" ? "NO STRONG OPPORTUNITY YET" : rel.status.toUpperCase()}
              </text>
            )}
          </g>
        );
      })}

      {opps.map((o) => (
        <OppNode
          key={o.id}
          p={oppPoint(pos, o.companyIds)}
          label={o.title}
          labelAbove={o.kind === "multi"}
          color={oppColor(o)}
          multi={o.kind === "multi"}
          compact={compact}
          selected={selected?.id === o.id}
          dimmed={dim([o.id, ...o.companyIds]) && focusId !== o.id}
          onHover={(h) => setHover(h ? o.id : undefined)}
          onClick={() => onSelect?.({ kind: "opportunity", id: o.id })}
        />
      ))}

      {proposal && proposal.status === "proposed" && (
        <OppNode
          p={oppPoint(pos, proposal.opportunity.companyIds)}
          label="Proposed · 3-way opportunity"
          labelAbove
          color="#f5b85c"
          multi
          ghost
          compact={compact}
          selected={selected?.id === proposal.id}
          dimmed={false}
          onHover={(h) => setHover(h ? proposal.id : undefined)}
          onClick={() => onSelect?.({ kind: "proposal", id: proposal.id })}
        />
      )}
    </svg>
  );
}

function OppNode({
  p,
  label,
  labelAbove,
  color,
  multi,
  ghost,
  compact,
  selected,
  dimmed,
  onHover,
  onClick,
}: {
  p: Pt;
  label: string;
  labelAbove?: boolean;
  color: string;
  multi?: boolean;
  ghost?: boolean;
  compact?: boolean;
  selected: boolean;
  dimmed: boolean;
  onHover: (h: boolean) => void;
  onClick: () => void;
}) {
  const s = multi ? 17 : 12;
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{ opacity: dimmed ? 0.25 : 1, scale: 1, x: p.x, y: p.y }}
      transition={{ type: "spring", stiffness: 140, damping: 16 }}
      className="cursor-pointer"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {(selected || multi) && <circle r={s + 16} fill={multi && !ghost ? "url(#halo-match)" : "none"} />}
      {ghost && <rect x={-s - 6} y={-s - 6} width={(s + 6) * 2} height={(s + 6) * 2} rx={6} transform="rotate(45)" fill="none" stroke={color} strokeOpacity={0.5} className="pulse-ring" />}
      <rect
        x={-s}
        y={-s}
        width={s * 2}
        height={s * 2}
        rx={multi ? 5 : 3.5}
        transform="rotate(45)"
        fill="#0c0e11"
        stroke={color}
        strokeWidth={selected ? 2 : 1.3}
        strokeDasharray={ghost ? "3 3" : undefined}
      />
      <rect x={-s * 0.42} y={-s * 0.42} width={s * 0.84} height={s * 0.84} rx={1.5} transform="rotate(45)" fill={color} fillOpacity={ghost ? 0.5 : 0.9} />
      {!compact && (
        <text y={labelAbove ? -s - 14 : s + 20} textAnchor="middle" fontSize={11.5} fontWeight={500} fill={color}>
          {label}
        </text>
      )}
    </motion.g>
  );
}

export function GraphLegend() {
  const item = (el: React.ReactNode, label: string) => (
    <span className="flex items-center gap-2">
      {el}
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">
      {item(<span className="h-2.5 w-2.5 rounded-full border border-muted" />, "Company")}
      {item(<span className="h-2 w-2 rotate-45 bg-accent" />, "Opportunity")}
      {item(<span className="h-2 w-2 rotate-45 bg-match" />, "Business match")}
      {item(<span className="h-2 w-2 rotate-45 border border-dashed border-signal" />, "Proposed")}
      {item(<span className="h-px w-5 border-t border-dashed border-white/40" />, "Dormant relationship")}
      {item(<span className="h-1.5 w-1.5 rounded-full bg-signal" />, "New signal")}
    </div>
  );
}
