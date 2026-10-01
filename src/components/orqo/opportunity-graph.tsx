/**
 * Opportunity Graph section of Network (Phase 10): provider/projection status,
 * a bounded connection map, and connections worth investigating. Rendered on
 * the server from loadOpportunityGraph(); every failure degrades to a notice
 * inside this section, never to a workspace error.
 */
import Link from "next/link";
import type { OpportunityCandidate } from "@/lib/graph/opportunity/candidates";
import type { GraphNode } from "@/lib/graph/opportunity/projection";
import type { Locale } from "@/lib/i18n/config";
import { conceptLabel } from "@/lib/intelligence/concepts";
import { assess, fromGraph } from "@/lib/opportunity/intelligence";
import { createTranslator, type MessageKey, type Translator } from "@/lib/i18n/translate";
import { loadOpportunityGraph, type GraphStatus, type OpportunityGraphView } from "@/lib/server/graph/service";
import type { Db } from "@/lib/server/supabase/types";
import { formatDate } from "./analysis";
import { RebuildGraphButton } from "./opportunity-graph-rebuild";
import { OpportunityGraphMap, type MapNode } from "./opportunity-graph-map";
import { OpportunityBrief } from "./opportunity-intelligence";
import { Badge, buttonClass, Card, CardHeader, cx, focusRing, inputClass, Stat } from "./ui";

const EPI_KEY = { fact: "evidence.fact", inference: "evidence.inference", assumption: "evidence.assumption" } as const satisfies Record<string, MessageKey>;

/** Concept labels in the reader's language (the evidence-store lexicon is bilingual; capability tags are English terms). */
function localizedLabel(n: Pick<GraphNode, "kind" | "label" | "attrs">, locale: Locale): string {
  return n.kind === "concept" && n.attrs.vocabulary === "concept" ? conceptLabel(String(n.attrs.term), locale) : n.label;
}

export async function OpportunityGraphSection({
  db,
  locale,
  organizationId,
  canRebuild,
  focusCompanyId,
  candidateId,
}: {
  db: Db;
  locale: Locale;
  organizationId: string;
  canRebuild: boolean;
  focusCompanyId?: string;
  candidateId?: string;
}) {
  const t = createTranslator(locale);
  let view: OpportunityGraphView;
  try {
    view = await loadOpportunityGraph(db, organizationId, { focusCompanyId });
  } catch (e) {
    console.error("[orqo] opportunity graph failed", e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : typeof e);
    return (
      <Card data-testid="graph-unavailable">
        <p className="px-5 py-6 text-[13.5px] text-fg-muted">{t("graph.unavailable")}</p>
      </Card>
    );
  }

  const selected = candidateId ? view.candidates.find((c) => c.id === candidateId) : undefined;
  const nodes: MapNode[] = (view.neighborhood?.nodes ?? []).map((n) => ({ key: n.key, kind: n.kind, label: localizedLabel(n, locale), depth: n.depth, canonicalId: n.canonicalId, attrs: n.attrs }));
  const edges = (view.neighborhood?.edges ?? []).map((e) => ({ key: e.key, kind: e.kind, from: e.from, to: e.to, epistemic: e.epistemic, basis: e.basis, provenance: e.provenance, attrs: e.attrs }));
  const focus = view.companies.find((c) => c.key === view.focus);
  const b = view.summary.byKind;

  return (
    <div className="space-y-4" data-testid="opportunity-graph">
      <StatusCard locale={locale} status={view.status} source={view.source} truncated={view.summary.truncated} organizationId={organizationId} canRebuild={canRebuild} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="graph-summary">
        <Stat label={t("graph.summary.companies")} value={b.company} />
        <Stat label={t("graph.summary.capabilities")} value={b.capability} />
        <Stat label={t("graph.summary.needs")} value={b.need} />
        <Stat label={t("graph.summary.candidates")} value={view.candidateTotal} />
        <Stat label={t("graph.summary.context")} value={`${b.signal} · ${b.event}`} />
      </div>

      <Card>
        <CardHeader
          title={t("graph.map.title")}
          description={t("graph.map.hint")}
          action={
            view.companies.length > 0 && (
              <form method="get" action="/workspace/network" className="flex items-center gap-2" data-testid="graph-focus">
                <input type="hidden" name="view" value="graph" />
                <label className="text-[12.5px] text-fg-muted" htmlFor="graph-focus">
                  {t("graph.map.focus")}
                </label>
                <select id="graph-focus" name="focus" defaultValue={focus?.id} className={cx(inputClass, "h-9 w-56")}>
                  {view.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.isOwnCompany ? t("graph.candidates.you", { name: c.name }) : c.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className={buttonClass("secondary", "sm")}>
                  {t("graph.map.show")}
                </button>
              </form>
            )
          }
        />
        <div className="px-5 pb-5">
          {view.companies.length === 0 ? (
            <p className="text-[13.5px] text-fg-muted">{t("graph.map.empty")}</p>
          ) : nodes.length <= 1 ? (
            <p className="text-[13.5px] text-fg-muted" data-testid="graph-lonely">
              {t("graph.map.lonely")}
            </p>
          ) : (
            <>
              <OpportunityGraphMap locale={locale} nodes={nodes} edges={edges} highlight={selected ? [...selected.path.nodes, ...selected.path.edges] : []} />
              {(view.neighborhood?.omitted ?? 0) > 0 && <p className="mt-2 text-[12px] text-fg-faint">{t("graph.map.omitted", { n: view.neighborhood!.omitted })}</p>}
            </>
          )}
        </div>
      </Card>

      <Card data-testid="graph-candidates">
        <CardHeader
          title={t("graph.candidates.title")}
          description={t("graph.candidates.description")}
          action={view.candidateTotal > 0 && <span className="text-[12.5px] text-fg-faint tabular-nums">{t("graph.candidates.count", { shown: view.candidates.length, total: view.candidateTotal })}</span>}
        />
        {view.candidates.length === 0 ? (
          <p className="px-5 pb-5 text-[13.5px] text-fg-muted">{t("graph.candidates.empty")}</p>
        ) : (
          <ul className="divide-y divide-edge">
            {view.candidates.map((c) => (
              <CandidateItem key={c.id} locale={locale} candidate={c} selected={c.id === selected?.id} />
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[12px] text-fg-faint">{t("graph.canonical")}</p>
    </div>
  );
}

function StatusCard({
  locale,
  status,
  source,
  truncated,
  organizationId,
  canRebuild,
}: {
  locale: Locale;
  status: GraphStatus;
  source: OpportunityGraphView["source"];
  truncated: boolean;
  organizationId: string;
  canRebuild: boolean;
}) {
  const t = createTranslator(locale);
  const cat = (c: GraphStatus["errorCategory"]) => (c ? t(`graph.errorCategory.${c}`) : "");
  const synced = status.synced ? formatDate(status.synced.syncedAt, locale) : "";
  const copy: Record<GraphStatus["state"], { title: MessageKey; body: string; tone: "neutral" | "positive" | "caution" | "critical" }> = {
    unconfigured: { title: "graph.status.unconfigured", body: t("graph.status.unconfiguredBody"), tone: "neutral" },
    unavailable: { title: "graph.status.unavailable", body: t("graph.status.unavailableBody", { category: cat(status.errorCategory) }), tone: "critical" },
    not_synced: { title: "graph.status.notSynced", body: t("graph.status.notSyncedBody"), tone: "caution" },
    stale: { title: "graph.status.stale", body: t("graph.status.staleBody", { date: synced }), tone: "caution" },
    in_sync: {
      title: "graph.status.inSync",
      body: t("graph.status.inSyncBody", { date: synced, nodes: status.synced?.nodes ?? 0, edges: status.synced?.edges ?? 0, checked: status.checkedAt ? formatDate(status.checkedAt, locale) : "" }),
      tone: "positive",
    },
  };
  const c = copy[status.state];
  const configured = status.state !== "unconfigured" && status.errorCategory !== "config";
  return (
    <Card data-testid="graph-status" data-state={status.state} data-source={source}>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 space-y-1">
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">{t("graph.title")}</h2>
          <p className="text-[13.5px] text-fg-muted">{t("graph.description")}</p>
          <div className="pt-1">
            <Badge tone={c.tone}>{t(c.title)}</Badge>
          </div>
          <p className="text-[12.5px] text-fg-muted">{c.body}</p>
          <p className="text-[12px] text-fg-faint">
            {t(source === "store" ? "graph.status.sourceStore" : "graph.status.sourcePreview")} · {t("graph.status.version", { version: status.projectionVersion })}
          </p>
          {truncated && <p className="text-[12px] text-caution">{t("graph.status.truncated")}</p>}
          {status.lastSyncError && <p className="text-[12px] text-critical">{t("graph.status.lastSyncFailed", { category: cat(status.lastSyncError.category), date: formatDate(status.lastSyncError.at, locale) })}</p>}
        </div>
        {canRebuild && configured && <RebuildGraphButton locale={locale} organizationId={organizationId} />}
      </div>
    </Card>
  );
}

function names(t: Translator, c: OpportunityCandidate, role: OpportunityCandidate["companies"][number]["role"]): string {
  return c.companies
    .filter((x) => x.role === role)
    .map((x) => (x.isOwnCompany ? t("graph.candidates.you", { name: x.name }) : x.name))
    .join(", ");
}

function CandidateItem({ locale, candidate: c, selected }: { locale: Locale; candidate: OpportunityCandidate; selected: boolean }) {
  const t = createTranslator(locale);
  const concepts = c.concepts.map((x) => (x.vocabulary === "concept" ? conceptLabel(x.term, locale) : x.label)).join(", ");
  const vars = { provider: names(t, c, "provider"), seeker: names(t, c, "seeker"), complement: names(t, c, "complement"), opportunity: c.opportunity?.title ?? "", concepts };
  const tone = c.support === "supported" ? "positive" : c.support === "partial" ? "brand" : "caution";
  const others = c.companies.filter((x) => !x.isOwnCompany);
  // Plan the follow-up where the open question lies: the side that needs or could complete.
  const followUp = others.find((x) => x.role === "seeker" || x.role === "complement") ?? others[0];
  const anchor = c.companies[0];
  return (
    <li className={cx("space-y-3 px-5 py-4", selected && "bg-brand-soft/40")} data-testid="graph-candidate" data-rule={c.rule} data-support={c.support} id={`candidate-${c.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="outline">{t(`graph.candidates.rules.${c.rule}`)}</Badge>
        <Badge tone={tone}>{t(`graph.candidates.support.${c.support}`)}</Badge>
      </div>
      <p className="text-[14px] text-fg">{t(`graph.candidates.why.${c.rule}`, vars)}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h4 className="text-[12px] font-medium text-fg-faint">{t("graph.candidates.fit")}</h4>
          <ul className="mt-1 space-y-0.5 text-[13px]">
            {c.companies
              .filter((x) => x.role !== "participant")
              .map((x) => (
                <li key={x.key}>
                  <span className="font-medium text-fg">{x.isOwnCompany ? t("graph.candidates.you", { name: x.name }) : x.name}</span>{" "}
                  <span className="text-fg-muted">· {t(`graph.candidates.roles.${x.role}`)} · </span>
                  <span className="text-fg-muted" data-testid="candidate-epistemic">
                    {x.epistemic ? t(EPI_KEY[x.epistemic]) : t("graph.panel.recorded")}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-1 font-mono text-[11px] text-fg-faint" title={c.evidence.join("\n")}>
            {t("graph.candidates.evidenceRefs", {
              n: c.evidence.length,
              refs: c.evidence
                .slice(0, 3)
                .map((r) => `${r.split(":")[0]}·${r.split(":")[1]?.slice(0, 8)}`)
                .join(", "),
            })}
          </p>
        </section>
        <section>
          <h4 className="text-[12px] font-medium text-fg-faint">{t("graph.candidates.unknowns")}</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-fg-muted" data-testid="candidate-unknowns">
            {c.unknowns.map((u, i) => (
              <li key={`${u.key}-${i}`}>{t(`graph.candidates.unknown.${u.key}`, { company: u.company ?? "" })}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="rounded-lg border border-edge bg-subtle/60 px-3 py-2" data-testid="candidate-question">
        <div className="text-[12px] font-medium text-fg-faint">{t("graph.candidates.question")}</div>
        <p className="text-[13.5px] text-fg">{t(`graph.candidates.questions.${c.rule}`, vars)}</p>
      </div>

      {(c.context.timing.length > 0 || c.context.relationship.length > 0 || c.context.events.length > 0) && (
        <div className="grid gap-3 text-[12.5px] md:grid-cols-3">
          {c.context.timing.length > 0 && (
            <section data-testid="candidate-timing">
              <h4 className="font-medium text-fg-faint">{t("graph.candidates.timing")}</h4>
              <ul className="mt-0.5 space-y-0.5 text-fg-muted">
                {c.context.timing.map((s) => (
                  <li key={s.signalId}>
                    {s.companyName}: {s.headline}
                    {s.publishedOn ? ` · ${s.publishedOn}` : ""} · {t(`signals.kinds.${s.kind}` as MessageKey)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {c.context.relationship.length > 0 && (
            <section data-testid="candidate-relationship">
              <h4 className="font-medium text-fg-faint">{t("graph.candidates.relationship")}</h4>
              <ul className="mt-0.5 space-y-0.5 text-fg-muted">
                {c.context.relationship.map((r) => (
                  <li key={r.companyName}>
                    {r.companyName}: {r.stage ? t(`network.stages.${r.stage}` as MessageKey) : t("graph.candidates.noStage")}
                    {r.lastInteractionOn ? ` · ${t("graph.candidates.lastInteraction", { date: r.lastInteractionOn })}` : ""}
                    {r.openFollowUps > 0 ? ` · ${t("graph.candidates.openFollowUps", { n: r.openFollowUps })}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {c.context.events.length > 0 && (
            <section data-testid="candidate-events">
              <h4 className="font-medium text-fg-faint">{t("graph.candidates.events")}</h4>
              <ul className="mt-0.5 space-y-0.5 text-fg-muted">
                {c.context.events.map((e) => (
                  <li key={`${e.eventId}-${e.companyName}`}>
                    {e.companyName} · {e.eventName} · {t(`events.statuses.${e.status}` as MessageKey)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Phase 11: the same candidate as an intelligence brief — still a connection worth investigating, never a qualified opportunity. */}
      <div data-testid="candidate-brief">
        <div className="mb-1 text-[12px] font-medium text-fg-faint">
          {t("opportunityIntel.graph.open")} · {t("opportunityIntel.graph.note")}
        </div>
        <OpportunityBrief brief={assess(fromGraph(c, locale), { relationships: [], signals: [] })} locale={locale} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {others.map((x) => (
          <Link key={x.key} href={`/workspace/network/${x.id}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
            {t("graph.candidates.actions.open", { company: x.name })} →
          </Link>
        ))}
        {followUp && (
          <Link href={`/workspace/network/${followUp.id}`} className={cx("rounded text-fg-muted hover:text-fg hover:underline", focusRing)} data-testid="candidate-follow-up">
            {t("graph.candidates.actions.followUp", { company: followUp.name })}
          </Link>
        )}
        {anchor && (
          <Link href={`/workspace/network?view=graph&focus=${anchor.id}&candidate=${encodeURIComponent(c.id)}#candidate-${c.id}`} className={cx("rounded text-fg-muted hover:text-fg hover:underline", focusRing)}>
            {t("graph.candidates.actions.map")}
          </Link>
        )}
      </div>
    </li>
  );
}
