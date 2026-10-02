"use client";

/**
 * Opportunity Graph map (Phase 10). A bounded neighborhood drawn in columns by
 * distance from the focus (no physics, no graph library), and a panel that
 * explains the selected node or connection: what it means, why it is there,
 * its fact/inference status and the canonical records behind it.
 */
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { Attrs, EdgeBasis, EdgeKind, Epistemic, NodeKind } from "@/lib/graph/opportunity/projection";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { cx, focusRing } from "./ui";

export interface MapNode {
  key: string;
  kind: NodeKind;
  label: string;
  depth: number;
  canonicalId: string;
  attrs: Attrs;
}

export interface MapEdge {
  key: string;
  kind: EdgeKind;
  from: string;
  to: string;
  epistemic: Epistemic | null;
  basis: EdgeBasis;
  provenance: string[];
  attrs: Attrs;
}

const KIND_COLOR: Record<NodeKind, string> = {
  company: "var(--color-fg)",
  capability: "var(--color-positive)",
  need: "var(--color-caution)",
  concept: "var(--color-fg-faint)",
  opportunity: "var(--color-brand)",
  signal: "var(--color-brand-strong)",
  event: "var(--color-fg-muted)",
};
const EPI_STROKE: Record<Epistemic | "recorded", { color: string; dash?: string }> = {
  fact: { color: "var(--color-positive)" },
  inference: { color: "var(--color-brand)", dash: "5 4" },
  assumption: { color: "var(--color-caution)", dash: "2 4" },
  recorded: { color: "var(--color-edge-strong)" },
};
const EPI_KEY: Record<Epistemic, MessageKey> = { fact: "evidence.fact", inference: "evidence.inference", assumption: "evidence.assumption" };

const COL = 188;
const ROW = 54;
const NODE_W = 150;
const NODE_H = 38;
const PAD = 16;

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function OpportunityGraphMap({ locale, nodes, edges, highlight }: { locale: Locale; nodes: MapNode[]; edges: MapEdge[]; highlight: string[] }) {
  const t = createTranslator(locale);
  const [selected, setSelected] = useState<{ type: "node" | "edge"; key: string } | null>(null);
  const hl = useMemo(() => new Set(highlight), [highlight]);

  const layout = useMemo(() => {
    const columns = new Map<number, MapNode[]>();
    for (const n of nodes) columns.set(n.depth, [...(columns.get(n.depth) ?? []), n]);
    const tallest = Math.max(1, ...[...columns.values()].map((c) => c.length));
    const height = PAD * 2 + tallest * ROW;
    const pos = new Map<string, { x: number; y: number }>();
    for (const [depth, col] of columns) {
      const top = (height - col.length * ROW) / 2;
      col.forEach((n, i) => pos.set(n.key, { x: PAD + depth * COL, y: top + i * ROW + (ROW - NODE_H) / 2 }));
    }
    const width = PAD * 2 + (Math.max(0, ...columns.keys()) * COL + NODE_W);
    return { pos, width, height };
  }, [nodes]);

  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);
  const node = selected?.type === "node" ? byKey.get(selected.key) : undefined;
  const edge = selected?.type === "edge" ? edges.find((e) => e.key === selected.key) : undefined;
  const touching = node ? edges.filter((e) => e.from === node.key || e.to === node.key) : [];
  const active = new Set(node ? [node.key, ...touching.flatMap((e) => [e.key, e.from, e.to])] : edge ? [edge.key, edge.from, edge.to] : []);
  const dim = (k: string) => (active.size > 0 ? !active.has(k) : hl.size > 0 && !hl.has(k));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 overflow-x-auto rounded-lg border border-edge bg-canvas" data-testid="graph-map">
        <svg width={layout.width} height={layout.height} role="img" aria-label={t("graph.map.title")} className="block">
          {edges.map((e) => {
            const a = layout.pos.get(e.from);
            const b = layout.pos.get(e.to);
            if (!a || !b) return null;
            const [l, r] = a.x <= b.x ? [a, b] : [b, a];
            const x1 = l.x + NODE_W;
            const y1 = l.y + NODE_H / 2;
            const x2 = r.x === l.x ? r.x + NODE_W : r.x;
            const y2 = r.y + NODE_H / 2;
            const mid = r.x === l.x ? x1 + 40 : (x1 + x2) / 2;
            const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
            const stroke = EPI_STROKE[e.epistemic ?? "recorded"];
            const on = selected?.key === e.key;
            return (
              <g key={e.key} opacity={dim(e.key) ? 0.18 : 1} data-testid="graph-edge" data-kind={e.kind}>
                <path d={d} fill="none" stroke={stroke.color} strokeWidth={on ? 3 : 1.6} strokeDasharray={stroke.dash} />
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  className="cursor-pointer"
                  onClick={() => setSelected({ type: "edge", key: e.key })}
                  role="button"
                  tabIndex={0}
                  aria-label={`${byKey.get(e.from)?.label} ${t(`graph.edges.${e.kind}.label`)} ${byKey.get(e.to)?.label}`}
                  onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && setSelected({ type: "edge", key: e.key })}
                />
              </g>
            );
          })}
          {nodes.map((n) => {
            const p = layout.pos.get(n.key)!;
            const own = n.attrs.isOwnCompany === true;
            const color = own ? "var(--color-brand)" : KIND_COLOR[n.kind];
            const on = selected?.key === n.key;
            return (
              <g
                key={n.key}
                transform={`translate(${p.x} ${p.y})`}
                opacity={dim(n.key) ? 0.25 : 1}
                className="cursor-pointer"
                onClick={() => setSelected({ type: "node", key: n.key })}
                onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && setSelected({ type: "node", key: n.key })}
                role="button"
                tabIndex={0}
                aria-label={`${t(`graph.kinds.${n.kind}`)}: ${n.label}`}
                data-testid="graph-node"
                data-kind={n.kind}
              >
                <rect width={NODE_W} height={NODE_H} rx={8} fill="var(--color-surface)" stroke={color} strokeWidth={on ? 2.5 : 1.2} strokeDasharray={n.kind === "signal" ? "4 3" : undefined} />
                <rect width={4} height={NODE_H} rx={2} fill={color} />
                <text x={12} y={14} fontSize={9.5} fontWeight={600} letterSpacing={0.4} fill={color} style={{ textTransform: "uppercase" }}>
                  {own ? t("graph.map.own") : t(`graph.kinds.${n.kind}`)}
                </text>
                <text x={12} y={29} fontSize={12} fill="var(--color-fg)">
                  {short(n.label, 21)}
                </text>
                <title>{n.label}</title>
              </g>
            );
          })}
        </svg>
        <Legend locale={locale} />
      </div>
      <aside className="min-w-0 rounded-lg border border-edge bg-surface p-4 text-[13px]" data-testid="graph-panel" aria-live="polite">
        {node ? (
          <NodePanel locale={locale} node={node} touching={touching} byKey={byKey} onSelect={(key) => setSelected({ type: "edge", key })} />
        ) : edge ? (
          <EdgePanel locale={locale} edge={edge} from={byKey.get(edge.from)} to={byKey.get(edge.to)} />
        ) : (
          <p className="text-fg-muted">{t("graph.panel.pick")}</p>
        )}
        <p className="mt-4 border-t border-edge pt-3 text-[11.5px] text-fg-faint">{t("graph.panel.noPrivate")}</p>
      </aside>
    </div>
  );
}

function Legend({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-edge px-3 py-2 text-[11.5px] text-fg-muted">
      {(["company", "capability", "need", "concept", "opportunity", "signal", "event"] as const).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: KIND_COLOR[k] }} aria-hidden />
          {t(`graph.kinds.${k}`)}
        </span>
      ))}
      <span className="mx-1 text-edge-strong">|</span>
      {(["fact", "inference", "assumption"] as const).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke={EPI_STROKE[k].color} strokeWidth="1.6" strokeDasharray={EPI_STROKE[k].dash} />
          </svg>
          {t(EPI_KEY[k])}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden>
          <line x1="0" y1="3" x2="18" y2="3" stroke={EPI_STROKE.recorded.color} strokeWidth="1.6" />
        </svg>
        {t("graph.panel.recorded")}
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-[11.5px] font-medium text-fg-faint">{label}</div>
      <div className="text-fg">{children}</div>
    </div>
  );
}

function hrefFor(n: MapNode): string | null {
  if (n.kind === "company") return n.attrs.isOwnCompany === true ? "/workspace/company" : `/workspace/companies/${n.canonicalId}`;
  if (n.kind === "event") return `/workspace/events/${n.canonicalId}`;
  if (n.kind === "signal") return "/workspace/intelligence";
  return null;
}

function NodePanel({ locale, node, touching, byKey, onSelect }: { locale: Locale; node: MapNode; touching: MapEdge[]; byKey: Map<string, MapNode>; onSelect: (key: string) => void }) {
  const t = createTranslator(locale);
  const a = node.attrs;
  const href = hrefFor(node);
  const linkLabel: MessageKey = node.kind === "event" ? "graph.panel.openEvent" : node.kind === "signal" ? "graph.panel.openSignals" : "graph.panel.open";
  return (
    <div data-testid="graph-node-panel">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">
        {t("graph.panel.node")} · {t(`graph.kinds.${node.kind}`)}
      </div>
      <div className="mt-0.5 text-[15px] font-semibold text-fg">{node.label}</div>
      {node.kind === "company" && a.isOwnCompany !== true && (
        <>
          <Row label={t("graph.panel.stage")}>{typeof a.stage === "string" ? t(`network.stages.${a.stage}` as MessageKey) : t("graph.candidates.noStage")}</Row>
          {typeof a.lastInteractionOn === "string" && <Row label={t("graph.panel.lastInteraction")}>{a.lastInteractionOn}</Row>}
          {Number(a.openFollowUps) > 0 && <Row label={t("graph.panel.openFollowUps")}>{String(a.openFollowUps)}</Row>}
        </>
      )}
      {Array.isArray(a.tags) && a.tags.length > 0 && <Row label={t("graph.panel.tags")}>{a.tags.join(", ")}</Row>}
      {node.kind === "signal" && (
        <>
          <Row label={t("graph.panel.publishedOn")}>{typeof a.publishedOn === "string" ? a.publishedOn : "—"}</Row>
          <Row label={t("graph.panel.sourceAuthority")}>{String(a.sourceAuthority)}</Row>
          <p className="mt-2 rounded-md bg-subtle px-2.5 py-1.5 text-[12px] text-fg-muted">{t("graph.panel.notFit")}</p>
        </>
      )}
      {href && (
        <Link href={href} className={cx("mt-3 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
          {t(linkLabel)} →
        </Link>
      )}
      <Row label={t("graph.panel.connections", { n: touching.length })}>
        <ul className="mt-1 space-y-1">
          {touching.map((e) => {
            const other = byKey.get(e.from === node.key ? e.to : e.from);
            return (
              <li key={e.key}>
                <button type="button" onClick={() => onSelect(e.key)} className={cx("w-full rounded text-left text-[12.5px] text-fg-muted hover:text-fg", focusRing)}>
                  <span className="font-medium text-fg">{t(`graph.edges.${e.kind}.label`)}</span> · {other?.label}
                  {e.epistemic && <span className="text-fg-faint"> · {t(EPI_KEY[e.epistemic])}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Row>
    </div>
  );
}

function EdgePanel({ locale, edge, from, to }: { locale: Locale; edge: MapEdge; from?: MapNode; to?: MapNode }) {
  const t = createTranslator(locale);
  const a = edge.attrs;
  const counts = typeof a.facts === "number";
  return (
    <div data-testid="graph-edge-panel">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("graph.panel.connection")}</div>
      <div className="mt-0.5 text-[14px] text-fg">
        <span className="font-semibold">{from?.label}</span> <span className="text-fg-muted">{t(`graph.edges.${edge.kind}.label`)}</span> <span className="font-semibold">{to?.label}</span>
      </div>
      <Row label={t("graph.panel.meaning")}>{t(`graph.edges.${edge.kind}.meaning`)}</Row>
      <Row label={t("graph.panel.basis")}>{t(`graph.basis.${edge.basis}`)}</Row>
      <Row label={t("graph.panel.status")}>
        <span data-testid="graph-edge-epistemic" data-epistemic={edge.epistemic ?? "recorded"}>
          {edge.epistemic ? t(EPI_KEY[edge.epistemic]) : t("graph.panel.recorded")}
        </span>
        {counts && <div className="text-[12px] text-fg-muted">{t("graph.panel.evidenceCounts", { facts: Number(a.facts), inferences: Number(a.inferences), assumptions: Number(a.assumptions) })}</div>}
        {Number(a.selfDescribed) > 0 && <div className="text-[12px] text-caution">{t("graph.panel.selfDescribed", { n: Number(a.selfDescribed) })}</div>}
      </Row>
      {typeof a.status === "string" && (edge.kind === "TARGETED_AT" || edge.kind === "MET_AT") && <Row label={t("graph.panel.status")}>{t(`events.statuses.${a.status}` as MessageKey)}</Row>}
      <Row label={t("graph.panel.references")}>
        <ul className="mt-0.5 space-y-0.5 font-mono text-[11px] text-fg-muted" data-testid="graph-edge-provenance">
          {edge.provenance.map((r) => {
            const [table, id] = r.split(":");
            return (
              <li key={r} title={r}>
                {table} · {id.slice(0, 8)}
              </li>
            );
          })}
        </ul>
      </Row>
    </div>
  );
}
