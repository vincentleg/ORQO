import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDay, validationQuestion } from "@/components/orqo/analysis";
import { TargetDetailsForm, TargetStatusButtons } from "@/components/orqo/event-forms";
import { PreparationView, PriorityBadge, PrivateLabel, PublicLabel, TargetStatusBadge, eventDates } from "@/components/orqo/events";
import { StageBadge, dueText, originLabel } from "@/components/orqo/network";
import { Card, CardHeader, cx, focusRing, Monogram, Page } from "@/components/orqo/ui";
import { prepareTarget, suggestPriority, type TargetContext } from "@/lib/events/model";
import { createTranslator } from "@/lib/i18n/translate";
import { analyzeRelevance } from "@/lib/intelligence/relevance";
import { isoDay, nextBestAction } from "@/lib/network/model";
import { websiteDomain } from "@/lib/search/query";
import { getOwnCompanyProfile, toOwnContext } from "@/lib/server/repositories/companies";
import { getEvent, getEventTarget } from "@/lib/server/repositories/events";
import { getCompanyMemory, getNetworkCompany, listCompanyOpportunities } from "@/lib/server/repositories/network-memory";
import { findIntelligence } from "@/lib/server/research/repository";
import { loadSignalsView } from "@/lib/server/signals/view";
import { isOpenSignal } from "@/lib/signals/model";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * Preparing to meet one target at an event. Everything is read from what
 * ORQO already stores — Network relationship memory (PRIVATE), the stored
 * public analysis and public signals (PUBLIC) — and combined by the pure,
 * deterministic prepareTarget / suggestPriority. Nothing is copied into
 * event storage except the team's own "why" and preparation notes; no fetch,
 * provider or model is called.
 */
export default async function EventTargetPage({ params }: PageProps<"/workspace/events/[eventId]/targets/[targetId]">) {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const { eventId, targetId } = await params;
  const org = active.organizationId;
  const [event, target] = await Promise.all([getEvent(db, org, eventId), getEventTarget(db, org, targetId)]);
  if (!event || !target || target.eventId !== event.id) notFound();
  const company = await getNetworkCompany(db, org, target.companyId);
  if (!company) notFound();

  const domain = company.website ? websiteDomain(company.website) : null;
  const [memory, opportunities, intel, own, signals, originEvent] = await Promise.all([
    getCompanyMemory(db, org, company.id),
    listCompanyOpportunities(db, org, company.id),
    findIntelligence(db, org, domain ? { domain } : { name: company.name }),
    getOwnCompanyProfile(db, org),
    loadSignalsView(db, org, { companyId: company.id }),
    company.originEventId ? getEvent(db, org, company.originEventId) : Promise.resolve(null),
  ]);
  const today = isoDay(new Date());
  const canWrite = roleAtLeast(active.role, "member") && !event.archivedAt;

  // The stored public analysis' unresolved questions (Phase 3, deterministic; phrased as inferences to validate).
  const analysis = intel ? analyzeRelevance(own ? toOwnContext(own) : null, intel.profile, intel.hypotheses) : null;
  const questions = analysis ? [...analysis.opportunities, ...analysis.hypotheses].flatMap((h) => validationQuestion(h, intel?.profile.name ?? company.name, own?.name ?? "", locale) ?? []).slice(0, 2) : [];
  // Exactly the Network page's input to the Next Best Action, so both pages show the same action.
  const top = analysis?.opportunities[0] ?? analysis?.hypotheses[0];
  const nbaQuestion = top ? validationQuestion(top, intel?.profile.name ?? company.name, own?.name ?? "", locale) : null;
  const openSignals = signals.items.filter((x) => isOpenSignal(x.signal));

  const ctx: TargetContext = {
    stage: company.stage,
    opportunities: opportunities.length,
    contacts: memory.contacts,
    interactions: memory.interactions,
    followUps: memory.followUps,
    openSignals: openSignals.map((x) => ({ headline: x.signal.headline, relevant: x.assessment.state === "relevant" })),
    validationQuestions: questions,
    hasPublicAnalysis: Boolean(intel),
  };
  const prep = prepareTarget(target, ctx);
  const suggestion = suggestPriority(ctx, target.why);
  // The canonical Phase 6 Next Best Action, unchanged: Events add no competing engine.
  const nba = nextBestAction({ stage: company.stage, contacts: memory.contacts, interactions: memory.interactions, followUps: memory.followUps, validationQuestion: nbaQuestion, today });
  const nbaText =
    nba.kind === "follow_up"
      ? `${t("network.nba.followUp", { title: nba.followUp.title })} — ${dueText(locale, nba.followUp, today)}`
      : nba.kind === "interaction_next_step"
        ? t("network.nba.nextStep", { step: nba.interaction.nextStep })
        : nba.kind === "validate"
          ? t("network.nba.validate", { question: nba.question })
          : nba.kind === "add_contact"
            ? t("network.nba.addContact", { company: company.name })
            : nba.kind === "record_first_contact"
              ? t("network.nba.firstContact", { name: nba.contact.name })
              : nba.kind === "inactive"
                ? t("network.nba.inactive")
                : t("network.nba.none");

  return (
    <Page>
      <div>
        <Link href={`/workspace/events/${event.id}?tab=before`} className={cx("inline-flex items-center gap-1 rounded text-[13px] text-fg-muted hover:text-fg", focusRing)}>
          ← {t("events.prep.back")} · {event.name} · <span className="tabular-nums">{eventDates(locale, event)}</span>
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Monogram name={company.name} size={44} />
            <div className="min-w-0">
              <h1 className="truncate text-[24px] font-semibold tracking-tight text-fg" data-testid="target-company">
                {company.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <PriorityBadge locale={locale} priority={target.priority} />
                <TargetStatusBadge locale={locale} status={target.status} />
                <span className="text-[12px] text-fg-faint">{t(`events.attendance.${target.attendance}`)}</span>
              </div>
            </div>
          </div>
          <Link href={`/workspace/network/${company.id}`} className={cx("rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
            {t("events.prep.openNetwork")} →
          </Link>
        </div>
        {canWrite && (
          <div className="mt-3">
            <TargetStatusButtons locale={locale} organizationId={org} target={target} />
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card data-testid="target-preparation">
            <CardHeader title={t("events.targets.prepare")} description={event.objective || undefined} />
            <PreparationView locale={locale} prep={prep} suggestion={suggestion} priority={target.priority} />
          </Card>

          <Card data-testid="target-prep-notes">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {t("events.prep.prepNotesTitle")} <PrivateLabel locale={locale} />
                </span>
              }
              description={t("events.prep.privateNote")}
            />
            <p className={cx("px-5 pb-4 text-[13.5px] whitespace-pre-line", target.prepNotes ? "text-fg" : "text-fg-faint")}>{target.prepNotes || t("events.prep.noPrepNotes")}</p>
            {canWrite && (
              <div className="min-w-0 border-t border-edge px-5 py-3">
                <TargetDetailsForm locale={locale} organizationId={org} target={target} />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card data-testid="target-known">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {t("events.prep.knownTitle")} <PrivateLabel locale={locale} />
                </span>
              }
              description={t("events.prep.privateNote")}
            />
            <dl className="space-y-3 px-5 pb-4 text-[13.5px]">
              <div>
                <dt className="text-[12px] font-medium text-fg-faint">{t("events.prep.stage")}</dt>
                <dd className="mt-0.5">
                  <StageBadge locale={locale} stage={company.stage} />
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium text-fg-faint">{t("events.prep.origin")}</dt>
                <dd className="mt-0.5 text-fg" data-testid="target-origin">
                  {formatDay(company.addedAt, locale)} · {originLabel(locale, company.origin)}
                  {originEvent && <div className="text-[12.5px] text-fg-muted">{t("events.prep.originEvent", { event: originEvent.name })}</div>}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium text-fg-faint">{t("events.prep.contacts")}</dt>
                <dd className="mt-0.5">
                  {memory.contacts.length === 0 ? (
                    <span className="text-fg-faint">{t("events.prep.noContacts")}</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {memory.contacts.map((c) => (
                        <li key={c.id} className="text-fg">
                          {c.name}
                          {c.role && <span className="text-fg-muted"> · {c.role}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium text-fg-faint">{t("events.prep.latest")}</dt>
                <dd className="mt-0.5">
                  {prep.latestInteraction ? (
                    <>
                      <div className="text-fg">{prep.latestInteraction.title}</div>
                      <div className="text-[12px] text-fg-faint">{formatDate(prep.latestInteraction.occurredAt, locale)}</div>
                    </>
                  ) : (
                    <span className="text-fg-faint">{t("events.prep.noInteraction")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium text-fg-faint">{t("events.prep.openFollowUp")}</dt>
                <dd className="mt-0.5">{prep.openFollowUp ? <span className="text-fg">{prep.openFollowUp.title}</span> : <span className="text-fg-faint">{t("events.prep.noFollowUp")}</span>}</dd>
              </div>
              <div data-testid="target-nba" data-kind={nba.kind}>
                <dt className="text-[12px] font-medium text-fg-faint">{t("events.prep.nba")}</dt>
                <dd className="mt-0.5 text-fg">{nbaText}</dd>
                <dd className="text-[11.5px] text-fg-faint">{t("events.prep.nbaNote")}</dd>
              </div>
            </dl>
          </Card>

          <Card data-testid="target-public">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {t("events.prep.publicTitle")} <PublicLabel locale={locale} />
                </span>
              }
              description={t("network.publicNote")}
            />
            <div className="space-y-3 px-5 pb-4 text-[13.5px]">
              {intel ? (
                <div>
                  <p className="text-fg">{t("events.prep.analysisOnFile", { date: formatDate(intel.researchedAt, locale) })}</p>
                  <Link href={`/workspace?q=${encodeURIComponent(intel.profile.domain)}`} className={cx("rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
                    {t("events.prep.openAnalysis")} →
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-fg-muted">{t("events.prep.noAnalysis")}</p>
                  <Link href={`/workspace?q=${encodeURIComponent(domain ?? company.name)}`} className={cx("rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
                    {t("events.prep.runSearch")} →
                  </Link>
                </div>
              )}
              <div>
                <h3 className="text-[12px] font-medium text-fg-faint">{t("events.prep.signals")}</h3>
                {openSignals.length === 0 ? (
                  <p className="mt-0.5 text-fg-faint">{t("events.prep.noSignals")}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {openSignals.slice(0, 3).map((x) => (
                      <li key={x.signal.id} className="text-fg">
                        {x.signal.headline}
                        {x.assessment.state === "relevant" && <span className="text-[12px] text-fg-faint"> · {t("events.prep.relevantSignal")}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
