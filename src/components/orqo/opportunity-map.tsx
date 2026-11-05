/**
 * Opportunity map (Nov 2026), rendered from opportunityMap(dossier): HTML nodes over an SVG edge layer, laid
 * out in fixed lanes (positions in %), so text wraps and the map scales. Read-only, no hooks: used by the company
 * page and by the public guided tour (progressive `reveal`). Rejected ideas are dashed, with the critic's reason.
 */
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { conceptLabel } from "@/lib/intelligence/concepts";
import type { Dossier } from "@/lib/understanding/dossier";
import { opportunityMap, type MapNode } from "@/lib/understanding/opportunity-map";
import { scenarioTitle } from "./dossier";
import { Card, CardHeader, cx } from "./ui";

/** Reveal order: companies, contributions, the scenario, shared context, evidence, rejected ideas. */
const ORDER: MapNode["kind"][] = ["company", "contribution", "scenario", "shared", "evidence", "rejected"];

function layout(nodes: MapNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const spread = (ids: string[], y: number, from: number, to: number) => ids.forEach((id, i) => pos.set(id, { x: ids.length === 1 ? (from + to) / 2 : from + ((to - from) * i) / (ids.length - 1), y }));
  for (const n of nodes) {
    if (n.id === "own") pos.set(n.id, { x: 9, y: 40 });
    if (n.id === "target") pos.set(n.id, { x: 91, y: 40 });
    if (n.id === "scenario") pos.set(n.id, { x: 50, y: 40 });
    if (n.kind === "contribution") pos.set(n.id, { x: n.side === "own" ? 28 : 72, y: 40 });
  }
  spread(nodes.filter((n) => n.kind === "shared").map((n) => n.id), 10, 28, 72);
  spread(nodes.filter((n) => n.kind === "evidence").map((n) => n.id), 65, 38, 62);
  spread(nodes.filter((n) => n.kind === "rejected").map((n) => n.id), 90, 17, 83);
  return pos;
}

const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function OpportunityMapView({ dossier: d, locale, reveal }: { dossier: Dossier; locale: Locale; reveal?: number }) {
  const t = createTranslator(locale);
  const map = opportunityMap(d);
  const ordered = ORDER.flatMap((k) => map.nodes.filter((n) => n.kind === k));
  const visible = new Set(ordered.slice(0, reveal ?? ordered.length).map((n) => n.id));
  const pos = layout(map.nodes);
  const names = (provider: "own" | "target") => (provider === "own" ? { provider: d.ownName, partner: d.targetName } : { provider: d.targetName, partner: d.ownName });
  const label = (n: MapNode): { title: string; sub?: string } => {
    switch (n.kind) {
      case "company":
        return { title: n.ref, sub: n.side === "own" ? t("map.you") : t("map.target") };
      case "contribution":
        return { title: t(`dossier.mechanisms.${n.mechanism}.${n.ref}` as MessageKey, names(map.lead?.provider ?? "own")), sub: n.side === "own" ? d.ownName : d.targetName };
      case "scenario":
        return { title: map.lead ? scenarioTitle(t, d, map.lead) : n.ref, sub: map.lead ? t(`dossier.labels.${map.lead.verdict}` as MessageKey) : undefined };
      case "shared":
        return { title: conceptLabel(n.ref, locale), sub: t("map.shared") };
      case "evidence":
        return { title: clip(n.ref, 90), sub: t("map.evidence") };
      case "rejected": {
        const provider = n.ref.endsWith(":target") ? "target" : "own";
        return { title: t(`dossier.mechanisms.${n.mechanism}.title` as MessageKey, names(provider)), sub: n.critic ? t(`dossier.critic.${n.critic}` as MessageKey, { name: provider === "own" ? d.targetName : d.ownName }) : undefined };
      }
    }
  };
  const tone: Record<MapNode["kind"], string> = {
    company: "border-fg/20 bg-surface font-semibold",
    contribution: "border-brand/30 bg-brand-soft",
    scenario: "border-positive/50 bg-positive-soft ring-2 ring-positive/20",
    shared: "border-edge-strong bg-subtle",
    evidence: "border-caution/40 bg-caution-soft",
    rejected: "border-dashed border-edge-strong bg-surface text-fg-muted",
  };
  return (
    <Card data-testid="opportunity-map">
      <CardHeader title={t("map.title")} description={map.lead ? t("map.description") : t("map.descriptionNone")} />
      <div className="overflow-x-auto px-3 pb-4">
        <div className="relative mx-auto h-[560px] min-w-[760px] max-w-[1100px]" role="img" aria-label={t("map.aria", { own: d.ownName, target: d.targetName })}>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {map.edges.map((e, i) => {
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              const on = visible.has(e.from) && visible.has(e.to);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={e.kind === "provides" || e.kind === "needs" ? 2 : 1.25}
                  strokeDasharray={e.kind === "rejected" ? "5 5" : undefined}
                  className={cx("transition-opacity duration-700", e.kind === "rejected" ? "stroke-fg-faint" : e.kind === "supports" ? "stroke-caution" : e.kind === "context" ? "stroke-edge-strong" : "stroke-brand")}
                  opacity={on ? 1 : 0}
                />
              );
            })}
          </svg>
          {map.nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const l = label(n);
            const on = visible.has(n.id);
            return (
              <div
                key={n.id}
                data-map-node={n.id}
                data-kind={n.kind}
                aria-hidden={!on || undefined}
                className={cx(
                  "absolute w-[136px] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-2.5 py-2 text-center shadow-card transition-all duration-700 motion-reduce:transition-none",
                  n.kind === "scenario" && "w-[178px]",
                  (n.kind === "rejected" || n.kind === "evidence") && "w-[200px]",
                  tone[n.kind],
                  on ? "scale-100 opacity-100" : "scale-90 opacity-0",
                )}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <div className="text-[12.5px] leading-snug text-fg">{l.title}</div>
                {l.sub && <div className="mt-0.5 text-[11px] leading-snug text-fg-muted">{l.sub}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
