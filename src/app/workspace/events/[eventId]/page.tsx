import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/components/orqo/analysis";
import { AddTargetForm, ArchiveEventButton, CaptureForm, EditEventForm, EventFollowUpForm, EventTabLink, RemoveTargetButton, TargetReviewButton, TargetStatusButtons, type ContactOption } from "@/components/orqo/event-forms";
import { PhaseBadge, PriorityBadge, PrivateLabel, TargetStatusBadge, eventDates } from "@/components/orqo/events";
import { FollowUpItem, StageBadge } from "@/components/orqo/network";
import { Badge, Card, CardHeader, cx, focusRing, Monogram, Page, Stat } from "@/components/orqo/ui";
import { canRemoveTarget, compareTargets, eventPhase, missedTargets, reviewCounts, reviewItems, type EventPhase, type EventTargetView } from "@/lib/events/model";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { compareFollowUps, isoDay, type ContactView } from "@/lib/network/model";
import { websiteDomain } from "@/lib/search/query";
import { getEventDetail } from "@/lib/server/repositories/events";
import { listContactRefs, listNetworkCompanies } from "@/lib/server/repositories/network-memory";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const TABS = ["before", "during", "after"] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_TAB: Record<EventPhase, Tab> = { undated: "before", upcoming: "before", active: "during", past: "after" };

/** Contact references as the follow-up form expects them; channels and notes are never sent to the browser. */
const asContactView = (c: ContactOption): ContactView => ({ id: c.id, name: c.name, role: c.role, email: null, phone: null, profileUrl: null, notes: "", isPrimary: false, createdAt: "" });

/**
 * One event as a business-development context: mission, targets (before),
 * encounters and fast capture (during), and a factual review (after). Every
 * company, contact, interaction and follow-up shown here is a canonical
 * Network record; this page only reads them through the event. No fetch,
 * provider or model call; no follow-up without an explicit submit.
 */
export default async function EventPage({ params, searchParams }: PageProps<"/workspace/events/[eventId]">) {
  const { db, active, user, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const { eventId } = await params;
  const query = await searchParams;
  const detail = await getEventDetail(db, active.organizationId, eventId);
  if (!detail) notFound();
  const { event } = detail;

  const today = isoDay(new Date());
  const phase = eventPhase(event, today);
  const tabParam = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : DEFAULT_TAB[phase];
  const canWrite = roleAtLeast(active.role, "member") && !event.archivedAt;
  const org = active.organizationId;

  const network = (await listNetworkCompanies(db, org)).filter((c) => !c.isOwnCompany);
  const companyName = new Map(network.map((c) => [c.id, c.name]));
  const targetIds = new Set(detail.targets.map((x) => x.companyId));
  const contactRefs = await listContactRefs(db, org, { companyIds: network.map((c) => c.id) });
  const contactOptions: ContactOption[] = contactRefs.map((c) => ({ id: c.id, companyId: c.companyId, name: c.name, role: c.role }));
  const contactsOf = (companyId: string) => contactOptions.filter((c) => c.companyId === companyId).map(asContactView);
  const contactName = new Map([...contactRefs, ...detail.contacts].map((c) => [c.id, c.name]));

  const counts = reviewCounts(detail);
  const review = reviewItems(detail, phase);
  const missed = missedTargets(detail.targets);
  const targets = [...detail.targets].sort(compareTargets);
  const openFollowUps = detail.followUps.filter((f) => f.status === "open").sort(compareFollowUps);
  const closedFollowUps = detail.followUps.filter((f) => f.status !== "open").sort(compareFollowUps);
  const tracked = new Set(detail.followUps.map((f) => f.interactionId).filter(Boolean));
  const interactionsOf = (companyId: string) => detail.interactions.filter((i) => i.companyId === companyId).length;
  const tabHref = (x: Tab) => `/workspace/events/${event.id}?tab=${x}`;

  return (
    <Page>
      <div>
        <Link href="/workspace/events" className={cx("inline-flex items-center gap-1 rounded text-[13px] text-fg-muted hover:text-fg", focusRing)}>
          ← {t("events.detail.back")}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[24px] font-semibold tracking-tight text-fg" data-testid="event-name">
                {event.name}
              </h1>
              <span data-testid="event-phase" data-phase={phase}>
                <PhaseBadge locale={locale} phase={phase} />
              </span>
              {event.archivedAt && <Badge tone="outline">{t("events.archivedBadge")}</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
              <span className="tabular-nums">{eventDates(locale, event)}</span>
              {event.location && <span>· {event.location}</span>}
              {event.website && (
                <span>
                  ·{" "}
                  <a href={event.website} target="_blank" rel="noopener noreferrer nofollow" className={cx("rounded text-brand hover:underline", focusRing)}>
                    {websiteDomain(event.website) ?? t("events.detail.websiteLink")}
                  </a>{" "}
                  <span className="text-fg-faint">({t("events.detail.notVisited")})</span>
                </span>
              )}
            </div>
          </div>
          {roleAtLeast(active.role, "member") && (
            <div className="flex flex-wrap items-start gap-2">
              <ArchiveEventButton locale={locale} organizationId={org} eventId={event.id} archived={Boolean(event.archivedAt)} />
            </div>
          )}
        </div>
        {event.archivedAt && <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-[13px] text-fg-muted">{t("events.form.archivedNote")}</p>}
      </div>

      <Card data-testid="event-mission">
        <CardHeader title={t("events.detail.mission")} />
        <div className="space-y-2 px-5 pb-4 text-[13.5px]">
          {event.objectiveKind && <div className="font-medium text-fg">{t(`events.objectives.${event.objectiveKind}`)}</div>}
          <p className={cx("whitespace-pre-line", event.objective ? "text-fg" : "text-fg-faint")}>{event.objective || t("events.detail.noMission")}</p>
          {event.topics.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-fg-faint">{t("events.detail.topics")}:</span>
              {event.topics.map((x) => (
                <Badge key={x} tone="outline">
                  {x}
                </Badge>
              ))}
            </div>
          )}
          {event.description && <p className="whitespace-pre-line text-fg-muted">{event.description}</p>}
          {canWrite && (
            <div className="pt-1">
              <EditEventForm locale={locale} organizationId={org} event={event} />
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7" data-testid="event-stats">
        <Stat label={t("events.stats.targets")} value={counts.targets} />
        <Stat label={t("events.stats.met")} value={counts.met} />
        <Stat label={t("events.stats.missed")} value={counts.missed} />
        <Stat label={t("events.stats.notRecorded")} value={counts.notRecorded} />
        <Stat label={t("events.stats.contacts")} value={counts.contactsAdded} />
        <Stat label={t("events.stats.interactions")} value={counts.interactions} />
        <Stat label={t("events.stats.openFollowUps")} value={counts.openFollowUps} />
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-edge pb-2" aria-label={t("events.title")} data-testid="event-tabs">
        {TABS.map((x) => (
          <EventTabLink key={x} href={tabHref(x)} active={tab === x}>
            {t(`events.detail.tabs.${x}`)}
          </EventTabLink>
        ))}
      </nav>

      {tab === "before" && (
        <Card data-testid="event-targets">
          <CardHeader title={t("events.targets.title")} description={t("events.targets.description")} />
          {canWrite && (
            <div className="min-w-0 px-5 pt-1 pb-3">
              <AddTargetForm locale={locale} organizationId={org} eventId={event.id} companies={network.filter((c) => !targetIds.has(c.id)).map((c) => ({ id: c.id, name: c.name }))} />
            </div>
          )}
          {targets.length === 0 ? (
            <p className="border-t border-edge px-5 py-4 text-[13.5px] text-fg-muted">{t("events.targets.empty")}</p>
          ) : (
            <ul className="divide-y divide-edge border-t border-edge">
              {targets.map((x) => (
                <TargetRow key={x.id} locale={locale} target={x} canWrite={canWrite} organizationId={org} eventId={event.id} removable={canWrite && canRemoveTarget(x, interactionsOf(x.companyId))} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "during" && (
        <>
          {canWrite && (
            <Card data-testid="event-capture">
              <CardHeader title={t("events.capture.title")} description={t("events.capture.description")} />
              <div className="min-w-0 px-5 pb-4">
                <CaptureForm
                  locale={locale}
                  organizationId={org}
                  event={{ id: event.id, name: event.name }}
                  targets={targets.map((x) => ({ id: x.companyId, name: x.companyName }))}
                  companies={network.map((c) => ({ id: c.id, name: c.name }))}
                  contacts={contactOptions}
                  initiallyOpen={phase === "active"}
                />
              </div>
            </Card>
          )}
          <Card data-testid="event-encounters">
            <CardHeader title={t("events.encounters.title")} description={t("network.privateNote")} />
            {detail.interactions.length === 0 ? (
              <p className="border-t border-edge px-5 py-4 text-[13.5px] text-fg-muted">{t("events.encounters.empty")}</p>
            ) : (
              <ul className="divide-y divide-edge border-t border-edge">
                {detail.interactions.map((i) => (
                  <li key={i.id} className="space-y-1 px-5 py-3.5" data-testid="event-interaction">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={`/workspace/network/${i.companyId}`} className={cx("rounded text-[14px] font-medium text-brand hover:underline", focusRing)}>
                        {companyName.get(i.companyId) ?? "—"}
                      </Link>
                      <span className="text-[13.5px] font-medium text-fg">{i.title}</span>
                    </div>
                    <div className="text-[12px] text-fg-faint tabular-nums">
                      {formatDate(i.occurredAt, locale)}
                      {i.contactId && contactName.get(i.contactId) && ` · ${contactName.get(i.contactId)}`}
                    </div>
                    {i.summary && <p className="text-[13px] whitespace-pre-line text-fg-muted">{i.summary}</p>}
                    {i.outcome && (
                      <p className="text-[13px] text-fg-muted">
                        <span className="font-medium text-fg">{t("events.encounters.outcome")}:</span> {i.outcome}
                      </p>
                    )}
                    {i.nextStep && (
                      <p className="text-[13px] text-fg-muted">
                        <span className="font-medium text-fg">{t("events.encounters.nextStep")}:</span> {i.nextStep}
                      </p>
                    )}
                    {i.nextStep &&
                      (tracked.has(i.id) ? (
                        <Badge tone="positive" icon="check">
                          {t("events.encounters.tracked")}
                        </Badge>
                      ) : (
                        canWrite && (
                          <div className="min-w-0 pt-1">
                            <EventFollowUpForm
                              locale={locale}
                              organizationId={org}
                              eventId={event.id}
                              companyId={i.companyId}
                              contacts={contactsOf(i.companyId)}
                              preset={{ title: i.nextStep.slice(0, 200), interactionId: i.id, contactId: i.contactId }}
                              label={t("events.encounters.makeFollowUp")}
                            />
                          </div>
                        )
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card data-testid="event-contacts">
            <CardHeader title={t("events.encounters.contactsTitle")} description={t("network.privateNote")} />
            {detail.contacts.length === 0 ? (
              <p className="border-t border-edge px-5 py-4 text-[13.5px] text-fg-muted">{t("events.encounters.noContacts")}</p>
            ) : (
              <ul className="divide-y divide-edge border-t border-edge">
                {detail.contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 px-5 py-2.5 text-[13.5px]">
                    <span className="font-medium text-fg">{c.name}</span>
                    {c.role && <span className="text-fg-muted">{c.role}</span>}
                    <Link href={`/workspace/network/${c.companyId}`} className={cx("rounded text-[13px] text-brand hover:underline", focusRing)}>
                      {companyName.get(c.companyId) ?? "—"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {tab === "after" && (
        <>
          <Card data-testid="event-review">
            <CardHeader title={t("events.review.title")} description={t("events.review.note")} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-edge px-5 py-4 text-[13.5px] sm:grid-cols-3 lg:grid-cols-4" data-testid="review-counts">
              {(
                [
                  ["events.stats.targets", counts.targets],
                  ["events.stats.met", counts.met],
                  ["events.stats.missed", counts.missed],
                  ["events.review.skipped", counts.skipped],
                  ["events.stats.notRecorded", counts.notRecorded],
                  ["events.review.companiesMet", counts.companiesMet],
                  ["events.review.newCompanies", counts.newCompanies],
                  ["events.stats.contacts", counts.contactsAdded],
                  ["events.stats.interactions", counts.interactions],
                  ["events.stats.openFollowUps", counts.openFollowUps],
                  ["events.review.completedFollowUps", counts.completedFollowUps],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-[12px] text-fg-faint">{t(key)}</dt>
                  <dd className="text-[18px] font-semibold text-fg tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card data-testid="event-requires-review">
            <CardHeader title={t("events.review.requiresTitle")} />
            {review.length === 0 ? (
              <p className="border-t border-edge px-5 py-4 text-[13.5px] text-fg-muted">{t("events.review.requiresEmpty")}</p>
            ) : (
              <ul className="divide-y divide-edge border-t border-edge">
                {review.map((r) => (
                  <li key={`${r.reason}-${r.companyId}-${r.interaction?.id ?? ""}`} className="space-y-2 px-5 py-3.5" data-reason={r.reason}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/workspace/network/${r.companyId}`} className={cx("rounded text-[14px] font-medium text-brand hover:underline", focusRing)}>
                        {r.target?.companyName ?? companyName.get(r.companyId) ?? "—"}
                      </Link>
                      {r.target && <PriorityBadge locale={locale} priority={r.target.priority} />}
                      <span className="text-[13px] text-fg-muted">{t(`events.review.reasons.${r.reason}`, { step: r.interaction?.nextStep ?? "" })}</span>
                    </div>
                    {canWrite && (
                      <div className="flex min-w-0 flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1 basis-full">
                          <EventFollowUpForm
                            locale={locale}
                            organizationId={org}
                            eventId={event.id}
                            companyId={r.companyId}
                            contacts={contactsOf(r.companyId)}
                            preset={r.interaction ? { title: r.interaction.nextStep.slice(0, 200), interactionId: r.interaction.id, contactId: r.interaction.contactId } : undefined}
                            label={t("events.review.createFollowUp")}
                          />
                        </div>
                        {r.target && r.reason !== "next_step_without_follow_up" && <TargetReviewButton locale={locale} organizationId={org} targetId={r.target.id} reviewed={false} />}
                        {r.target && r.reason === "outcome_not_recorded" && <TargetStatusButtons locale={locale} organizationId={org} target={r.target} />}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="event-missed">
            <CardHeader title={t("events.review.missedTitle")} description={t("events.review.missedNote")} />
            {missed.length === 0 ? (
              <p className="border-t border-edge px-5 py-4 text-[13.5px] text-fg-muted">{t("events.review.missedEmpty")}</p>
            ) : (
              <ul className="divide-y divide-edge border-t border-edge">
                {missed.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 px-5 py-3" data-testid="missed-target">
                    <Link href={`/workspace/events/${event.id}/targets/${x.id}`} className={cx("rounded text-[14px] font-medium text-brand hover:underline", focusRing)}>
                      {x.companyName}
                    </Link>
                    <PriorityBadge locale={locale} priority={x.priority} />
                    {x.reviewedAt && <Badge tone="outline">{t("events.review.reviewedBadge")}</Badge>}
                    {canWrite && x.reviewedAt && <TargetReviewButton locale={locale} organizationId={org} targetId={x.id} reviewed />}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="event-follow-ups">
            <CardHeader title={t("events.review.followUpsTitle")} />
            {detail.followUps.length === 0 ? (
              <p className="border-t border-edge px-5 py-4 text-[13.5px] text-fg-muted">{t("events.review.followUpsEmpty")}</p>
            ) : (
              <ul className="divide-y divide-edge border-t border-edge">
                {[...openFollowUps, ...closedFollowUps].map((f) => (
                  <FollowUpItem key={f.id} locale={locale} followUp={f} today={today} organizationId={org} canWrite={canWrite} companyName={companyName.get(f.companyId)} contactName={f.contactId ? contactName.get(f.contactId) : null} currentUserId={user.id} />
                ))}
              </ul>
            )}
          </Card>
          <p className="text-[12.5px] text-fg-faint">{t("events.review.memoryNote")}</p>
        </>
      )}
    </Page>
  );
}

function TargetRow({ locale, target, canWrite, organizationId, eventId, removable }: { locale: Locale; target: EventTargetView; canWrite: boolean; organizationId: string; eventId: string; removable: boolean }) {
  const t = createTranslator(locale);
  return (
    <li className="space-y-2 px-5 py-3.5" data-testid="event-target" data-status={target.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Monogram name={target.companyName} size={32} />
          <div className="min-w-0">
            <Link href={`/workspace/events/${eventId}/targets/${target.id}`} className={cx("rounded text-[14px] font-medium text-fg hover:text-brand hover:underline", focusRing)}>
              {target.companyName}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <PriorityBadge locale={locale} priority={target.priority} />
              <TargetStatusBadge locale={locale} status={target.status} />
              <span className="text-[12px] text-fg-faint">{t(`events.attendance.${target.attendance}`)}</span>
              <span className="text-[12px] text-fg-faint">· {t("events.targets.stage")}:</span>
              <StageBadge locale={locale} stage={target.companyStage} />
            </div>
          </div>
        </div>
        <Link href={`/workspace/events/${eventId}/targets/${target.id}`} className={cx("shrink-0 rounded text-[13px] font-medium text-brand hover:underline", focusRing)} data-testid="prepare-target">
          {t("events.targets.prepare")} →
        </Link>
      </div>
      <p className={cx("flex flex-wrap items-baseline gap-2 text-[13px]", target.why ? "text-fg-muted" : "text-fg-faint")}>
        <PrivateLabel locale={locale} />
        <span className="whitespace-pre-line">{target.why || t("events.targets.noReason")}</span>
      </p>
      {canWrite && (
        <div className="flex flex-wrap items-start gap-2">
          <TargetStatusButtons locale={locale} organizationId={organizationId} target={target} />
          {removable && <RemoveTargetButton locale={locale} organizationId={organizationId} targetId={target.id} />}
        </div>
      )}
    </li>
  );
}
