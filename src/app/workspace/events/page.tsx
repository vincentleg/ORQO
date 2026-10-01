import Link from "next/link";
import { CreateEventForm } from "@/components/orqo/event-forms";
import { EventCard, attentionText } from "@/components/orqo/events";
import { Icon } from "@/components/orqo/icons";
import { FeatureCard } from "@/components/orqo/plan";
import { Card, CardHeader, cx, EmptyState, focusRing, Page, PageHeader } from "@/components/orqo/ui";
import { eventAttention, groupEvents, type EventPhase } from "@/lib/events/model";
import { createTranslator } from "@/lib/i18n/translate";
import { isoDay } from "@/lib/network/model";
import { listEventSummaries } from "@/lib/server/repositories/events";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const SECTIONS: readonly EventPhase[] = ["active", "upcoming", "undated", "past"];

/**
 * Events (Phase 8): the events this workspace is working on, what each one
 * produced, and what needs attention. Stored records only — this page fetches
 * no URL and calls no provider or model. Phases derive from calendar dates.
 */
export default async function EventsPage() {
  const { db, active, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const canWrite = roleAtLeast(active.role, "member");
  const summaries = await listEventSummaries(db, active.organizationId, isoDay(new Date()));
  const live = summaries.filter((s) => !s.event.archivedAt);
  const archived = summaries.filter((s) => s.event.archivedAt);
  const groups = groupEvents(live);
  const attention = eventAttention(live);

  return (
    <Page>
      <PageHeader title={t("events.title")} description={t("events.description")} />
      {canWrite && (
        <div className="min-w-0" data-testid="create-event-composer">
          <CreateEventForm locale={locale} organizationId={active.organizationId} />
        </div>
      )}

      {summaries.length === 0 ? (
        <Card>
          <EmptyState icon="events" title={t("events.emptyTitle")} body={t("events.emptyBody")} />
        </Card>
      ) : (
        <>
          {attention.length > 0 && (
            <Card data-testid="events-attention">
              <CardHeader title={t("events.attentionTitle")} />
              <ul className="divide-y divide-edge border-t border-edge">
                {attention.map(({ summary, reason }) => (
                  <li key={`${summary.event.id}-${reason}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" data-reason={reason}>
                    <Link href={`/workspace/events/${summary.event.id}${reason === "upcoming_without_targets" ? "?tab=before" : "?tab=after"}`} className={cx("rounded text-[14px] font-medium text-brand hover:underline", focusRing)}>
                      {summary.event.name}
                    </Link>
                    <span className="text-[13px] text-fg-muted">{attentionText(locale, reason, summary)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {SECTIONS.map((phase) =>
            groups[phase].length === 0 ? null : (
              <section key={phase} data-testid={`events-${phase}`}>
                <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-fg-faint">{t(`events.sections.${phase}`)}</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {groups[phase].map((s) => (
                    <EventCard key={s.event.id} locale={locale} summary={s} />
                  ))}
                </div>
              </section>
            ),
          )}

          {archived.length > 0 && (
            <details data-testid="events-archived">
              <summary className={cx("cursor-pointer text-[13px] font-semibold uppercase tracking-wide text-fg-faint hover:text-fg", focusRing)}>
                {t("events.sections.archived")} · {archived.length}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {archived.map((s) => (
                  <EventCard key={s.event.id} locale={locale} summary={s} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <FeatureCard plan={plan} feature="events.automation" title={t("events.agent.automationTitle")} body={t("events.agent.automationBody")} icon="events" locale={locale} />
        <Card data-testid="event-agent-status">
          <div className="flex items-start gap-3 px-5 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-fg-faint">
              <Icon name="agents" size={17} />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-fg">{t("events.agent.title")}</div>
              <p className="mt-0.5 text-[13px] text-fg-muted">{t("events.agent.body")}</p>
              <Link href="/workspace/agents/event" className={cx("mt-1 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
                {t("nav.agents")} →
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </Page>
  );
}
