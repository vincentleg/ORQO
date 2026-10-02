import Link from "next/link";
import { formatDay } from "@/components/orqo/analysis";
import { mainUnknown, trackedTitle } from "@/components/orqo/tracked-opportunity";
import { Badge, ButtonLink, Card, cx, EmptyState, focusRing, Page, PageHeader } from "@/components/orqo/ui";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { listTrackedOpportunities, type TrackedOpportunity } from "@/lib/server/repositories/tracked-opportunities";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * Opportunities (Phase 16A): the commercial possibilities the team chose to remember. Stored records only:
 * this page researches nothing and calls no provider. Not a CRM: no amounts, owners, pipeline or forecast.
 */
export default async function OpportunitiesPage() {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const all = await listTrackedOpportunities(db, active.organizationId);
  const open = all.filter((o) => o.status !== "closed");
  const closed = all.filter((o) => o.status === "closed");

  return (
    <Page width="narrow">
      <PageHeader title={t("opportunities.title")} description={t("opportunities.subtitle")} />
      {all.length === 0 ? (
        <Card data-testid="opportunities-empty">
          <EmptyState
            icon="opportunities"
            title={t("opportunities.empty.title")}
            body={t("opportunities.empty.body")}
            action={
              <ButtonLink href="/workspace" variant="primary">
                {t("opportunities.empty.cta")}
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <>
          <List items={open} title={t("opportunities.groups.active")} locale={locale} />
          {closed.length > 0 && <List items={closed} title={t("opportunities.groups.closed")} locale={locale} />}
        </>
      )}
    </Page>
  );
}

function List({ items, title, locale }: { items: TrackedOpportunity[]; title: string; locale: Locale }) {
  const t = createTranslator(locale);
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">{title}</h2>
      <ul className="space-y-3" data-testid="opportunities-list">
        {items.map((o) => (
          <li key={o.id}>
            <Link
              href={`/workspace/opportunities/${o.id}`}
              className={cx("block rounded-xl border border-edge bg-surface px-5 py-4 shadow-card transition-colors hover:border-brand/40", focusRing)}
              data-testid="opportunity-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 text-[16px] font-semibold text-fg">{trackedTitle(t, o)}</span>
                <Badge tone={o.status === "closed" ? "neutral" : o.status === "validated" ? "positive" : o.status === "paused" ? "caution" : "brand"}>{t(`opportunities.status.${o.status}`)}</Badge>
              </div>
              <p className="mt-1 text-[13.5px] text-fg-muted">
                {t("opportunities.with", { target: o.targetName })} · {t("opportunities.trackedOn", { date: formatDay(o.createdAt, locale) })}
              </p>
              {mainUnknown(t, o) && (
                <p className="mt-2 text-[14px] text-fg">
                  <span className="text-fg-muted">{t("opportunities.mainUnknown")}: </span>
                  {mainUnknown(t, o)}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
