import Link from "next/link";
import { Icon } from "@/components/orqo/icons";
import { FeatureCard } from "@/components/orqo/plan";
import { SignalCard } from "@/components/orqo/signals";
import { Card, CardHeader, cx, EmptyState, focusRing, inputClass, Page, PageHeader } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { isoDay } from "@/lib/network/model";
import { SIGNAL_KINDS, SIGNAL_STATUSES, isOpenSignal } from "@/lib/signals/model";
import { RELEVANCE_STATES, needsAttention } from "@/lib/signals/relevance";
import { loadSignalsView, type AssessedSignal } from "@/lib/server/signals/view";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/**
 * Intelligence (Phase 7): public changes at Network companies, why they may
 * matter to this organization, and what deserves a review. Stored signals
 * only — this page triggers no fetch, provider or model call. Relevance and
 * re-evaluation are deterministic and computed at read time.
 */
export default async function IntelligencePage({ searchParams }: PageProps<"/workspace/intelligence">) {
  const { db, active, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const params = await searchParams;
  const view = await loadSignalsView(db, active.organizationId);
  const canWrite = roleAtLeast(active.role, "member");
  const today = isoDay(new Date());

  const filters = {
    company: one(params.company),
    kind: (SIGNAL_KINDS as readonly string[]).includes(one(params.kind)) ? one(params.kind) : "",
    status: one(params.status) === "all" || (SIGNAL_STATUSES as readonly string[]).includes(one(params.status)) ? one(params.status) : "open",
    relevance: (RELEVANCE_STATES as readonly string[]).includes(one(params.relevance)) ? one(params.relevance) : "",
  };
  const filtered = view.items.filter(
    (x) =>
      (!filters.company || x.company.id === filters.company) &&
      (!filters.kind || x.signal.kind === filters.kind) &&
      (filters.status === "all" || (filters.status === "open" ? isOpenSignal(x.signal) : x.signal.status === filters.status)) &&
      (!filters.relevance || x.assessment.state === filters.relevance),
  );
  const attention = needsAttention(view.items).slice(0, 5);
  const attentionIds = new Set(attention.map((x) => x.signal.id));
  const isFiltered = Boolean(filters.company || filters.kind || filters.relevance || filters.status !== "open");
  const companiesWithSignals = [...new Map(view.items.map((x) => [x.company.id, x.company])).values()].sort((a, b) => a.name.localeCompare(b.name));

  const card = (x: AssessedSignal) => (
    <SignalCard
      key={x.signal.id}
      locale={locale}
      signal={x.signal}
      assessment={x.assessment}
      reevaluation={x.reevaluation}
      company={{ id: x.company.id, name: x.company.name }}
      ownName={view.ownName}
      stageLabel={x.company.stage ? t(`network.stages.${x.company.stage}`) : null}
      canWrite={canWrite}
      organizationId={active.organizationId}
      contacts={[]}
      today={today}
      showCompany
    />
  );

  return (
    <Page>
      <PageHeader title={t("intelligence.title")} description={t("intelligence.description")} />

      {view.items.length === 0 ? (
        <Card>
          <EmptyState icon="intelligence" title={t("intelligence.emptyTitle")} body={t("intelligence.emptyBody")} />
        </Card>
      ) : (
        <>
          <Card data-testid="needs-attention">
            <CardHeader title={t("intelligence.attentionTitle")} description={t("intelligence.attentionBody")} />
            {attention.length === 0 ? (
              <p className="border-t border-edge px-5 py-4 text-[13.5px] text-fg-muted">{t("intelligence.attentionEmpty")}</p>
            ) : (
              <div className="divide-y divide-edge border-t border-edge">{attention.map(card)}</div>
            )}
          </Card>

          <Card data-testid="all-signals">
            <CardHeader title={t("intelligence.allTitle")} description={t("intelligence.allBody")} action={<span className="text-[12.5px] text-fg-faint tabular-nums">{t("intelligence.count", { count: filtered.length })}</span>} />
            <form method="get" action="/workspace/intelligence" className="flex flex-wrap items-end gap-2 border-y border-edge px-5 py-3" role="search" aria-label={t("intelligence.filters.label")} data-testid="signal-filters">
              <label>
                <span className="sr-only">{t("intelligence.filters.company")}</span>
                <select name="company" defaultValue={filters.company} className={cx(inputClass, "h-9 w-auto max-w-56")}>
                  <option value="">{t("intelligence.filters.companyAll")}</option>
                  {companiesWithSignals.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">{t("intelligence.filters.kind")}</span>
                <select name="kind" defaultValue={filters.kind} className={cx(inputClass, "h-9 w-auto")}>
                  <option value="">{t("intelligence.filters.kindAll")}</option>
                  {SIGNAL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`signals.kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">{t("intelligence.filters.status")}</span>
                <select name="status" defaultValue={filters.status} className={cx(inputClass, "h-9 w-auto")}>
                  <option value="open">{t("intelligence.filters.statusOpen")}</option>
                  {SIGNAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`signals.statuses.${s}`)}
                    </option>
                  ))}
                  <option value="all">{t("intelligence.filters.statusAll")}</option>
                </select>
              </label>
              <label>
                <span className="sr-only">{t("intelligence.filters.relevance")}</span>
                <select name="relevance" defaultValue={filters.relevance} className={cx(inputClass, "h-9 w-auto")}>
                  <option value="">{t("intelligence.filters.relevanceAll")}</option>
                  {RELEVANCE_STATES.map((r) => (
                    <option key={r} value={r}>
                      {t(`signals.relevance.${r}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={cx("h-9 rounded-lg border border-edge-strong bg-surface px-3 text-[13px] font-medium text-fg shadow-card hover:bg-subtle", focusRing)}>
                {t("intelligence.filters.apply")}
              </button>
              {isFiltered && (
                <Link href="/workspace/intelligence" className={cx("rounded px-1 text-[13px] text-fg-muted hover:text-fg", focusRing)}>
                  {t("intelligence.filters.clear")}
                </Link>
              )}
            </form>
            {filtered.length === 0 ? (
              <p className="px-5 py-4 text-[13.5px] text-fg-muted">{t("intelligence.filteredEmpty")}</p>
            ) : (
              // Signals already shown under "Needs attention" stay listed here too (chronological view), without duplicating their forms' state.
              <div className="divide-y divide-edge">{filtered.map((x) => (attentionIds.has(x.signal.id) ? <CompactSignal key={x.signal.id} item={x} locale={locale} /> : card(x)))}</div>
            )}
          </Card>
        </>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card data-testid="signal-sources">
          <CardHeader title={t("intelligence.howTitle")} />
          <ul className="space-y-2 px-5 pb-4 text-[13.5px] text-fg-muted">
            <li className="flex gap-2">
              <Icon name="refresh" size={15} className="mt-0.5 shrink-0 text-fg-faint" />
              {t("intelligence.how.research")}
            </li>
            <li className="flex gap-2">
              <Icon name="plus" size={15} className="mt-0.5 shrink-0 text-fg-faint" />
              {t("intelligence.how.manual")}
            </li>
            <li className="flex gap-2">
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-fg-faint" />
              {t("intelligence.how.cost")}
            </li>
          </ul>
        </Card>
        <div className="space-y-2">
          <FeatureCard plan={plan} feature="intelligence.monitoring" title={t("intelligence.monitoringTitle")} body={t("intelligence.monitoringBody")} icon="intelligence" locale={locale} />
          <p className="px-1 text-[12px] text-fg-faint" data-testid="signals-agent-status">
            {t("intelligence.agentStatus")}
          </p>
        </div>
      </div>
    </Page>
  );
}

/** A one-line entry for a signal already expanded under "Needs attention". */
function CompactSignal({ item: x, locale }: { item: AssessedSignal; locale: "en" | "fr" }) {
  const t = createTranslator(locale);
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-[13.5px]" data-testid="signal-compact">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-fg-faint">{t(`signals.kinds.${x.signal.kind}`)}</span>
      <Link href={`/workspace/companies/${x.company.id}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
        {x.company.name}
      </Link>
      <span className="min-w-0 flex-1 truncate text-fg-muted">{x.signal.epistemic === "fact" ? x.signal.headline : t(`signals.relevance.${x.assessment.state}`)}</span>
      <span className="text-[12px] text-fg-faint">↑ {t("intelligence.attentionTitle")}</span>
    </div>
  );
}
