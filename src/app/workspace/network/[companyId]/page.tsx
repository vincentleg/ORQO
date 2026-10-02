import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatDate, formatDay, validationQuestion } from "@/components/orqo/analysis";
import { Icon } from "@/components/orqo/icons";
import { DueLabel, FollowUpItem, StageBadge, dueText, originLabel } from "@/components/orqo/network";
import { ContactForm, FollowUpForm, FollowUpStatusButton, InteractionForm, RelationshipForm } from "@/components/orqo/network-forms";
import { RecordSignalForm } from "@/components/orqo/signal-forms";
import { SignalCard } from "@/components/orqo/signals";
import { Badge, Card, CardHeader, cx, focusRing, Monogram, Page } from "@/components/orqo/ui";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { analyzeRelevance } from "@/lib/intelligence/relevance";
import { buildTimeline, compareFollowUps, discoverRunId, isoDay, nextBestAction, type ContactView, type NextAction, type TimelineEntry } from "@/lib/network/model";
import { websiteDomain } from "@/lib/search/query";
import { getOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { getCompanyMemory, getNetworkCompany, listCompanyOpportunities, type NetworkCompany } from "@/lib/server/repositories/network-memory";
import { findIntelligence } from "@/lib/server/research/repository";
import { loadSignalsView } from "@/lib/server/signals/view";
import { loadCompanyGraphContext, type CompanyGraphContext } from "@/lib/server/graph/service";
import { conceptLabel } from "@/lib/intelligence/concepts";
import { getEvent, listCompanyEvents } from "@/lib/server/repositories/events";
import { PhaseBadge, TargetStatusBadge, eventDates } from "@/components/orqo/events";
import { eventPhase } from "@/lib/events/model";
import { isOpenSignal } from "@/lib/signals/model";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { OpportunityIntelligenceCard } from "@/components/orqo/opportunity-intelligence";
import { companyIntelligence, fromCanonical, fromGraph, fromSearch, relationshipFrom } from "@/lib/opportunity/intelligence";
import { listOpportunityRecords } from "@/lib/server/repositories/opportunities";
import { loadWorkspace } from "@/lib/server/workspace";
import { loadOwnContext } from "@/lib/server/repositories/understanding";

export const dynamic = "force-dynamic";

/**
 * One Network company as a relationship record: identity, relationship
 * context, people, follow-ups, activity history and business context.
 * PRIVATE relationship memory (recorded by people) and PUBLIC analysis (from
 * official sources) are shown in separate, labeled places. The Next Best
 * Action is deterministic (src/lib/network/model.ts); nothing calls a model.
 */
export default async function NetworkCompanyPage({ params }: PageProps<"/workspace/network/[companyId]">) {
  const { db, active, user, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const { companyId } = await params;
  const company = await getNetworkCompany(db, active.organizationId, companyId);
  if (!company) notFound();
  if (company.isOwnCompany) redirect("/workspace/company");

  const domain = company.website ? websiteDomain(company.website) : null;
  const [memory, opportunities, intel, own, signals, companyEvents, originEvent, graph, records] = await Promise.all([
    getCompanyMemory(db, active.organizationId, company.id),
    listCompanyOpportunities(db, active.organizationId, company.id),
    findIntelligence(db, active.organizationId, domain ? { domain } : { name: company.name }),
    getOwnCompanyProfile(db, active.organizationId),
    // Phase 7: PUBLIC signals, shown in their own card. They do not feed the Next Best Action below.
    loadSignalsView(db, active.organizationId, { companyId }),
    // Phase 8: the events this company appears in, and the one it entered the Network through (if any).
    listCompanyEvents(db, active.organizationId, company.id),
    company.originEventId ? getEvent(db, active.organizationId, company.originEventId) : Promise.resolve(null),
    // Phase 10: derived graph context. A failure degrades to a notice (undefined), never breaks the page.
    loadCompanyGraphContext(db, active.organizationId, company.id).catch((e: unknown): undefined => {
      console.error("[orqo] company graph context failed", e instanceof Error ? e.name : typeof e);
      return undefined;
    }),
    // Phase 11: canonical opportunities (read only) for the intelligence briefs. A failure hides them, never breaks the page.
    listOpportunityRecords(db, active.organizationId, company.id).catch((e: unknown) => {
      console.error("[orqo] opportunity records failed", e instanceof Error ? e.name : typeof e);
      return [];
    }),
  ]);
  const eventNames = new Map([...companyEvents.map((x) => [x.event.id, x.event.name] as const), ...(originEvent ? [[originEvent.id, originEvent.name] as const] : [])]);
  const canWrite = roleAtLeast(active.role, "member");
  const today = isoDay(new Date());

  // Public analysis (stored, deterministic): its most important open question feeds the Next Best Action as an inference to validate.
  const ownCtx = own ? await loadOwnContext(db, active.organizationId, own) : null;
  const analysis = intel ? analyzeRelevance(ownCtx, intel.profile, intel.hypotheses) : null;
  const top = analysis?.opportunities[0] ?? analysis?.hypotheses[0];
  const question = top ? validationQuestion(top, intel?.profile.name ?? company.name, own?.name ?? "", locale) : null;

  // Phase 11: Opportunity Intelligence — computed from the records above (deterministic, no model, no write).
  // It reuses the Search critic and the graph candidates; it does not replace the relationship Next Best Action.
  const intelligence = companyIntelligence({
    drafts: [
      ...records.map(fromCanonical),
      ...(analysis && intel && own && ownCtx
        ? [...analysis.opportunities, ...analysis.hypotheses]
            .slice(0, 3)
            .map((c) => fromSearch({ candidate: c, profile: intel.profile, own: ownCtx, ownCompany: { id: own.id, name: own.name }, target: { id: company.id, name: company.name }, insights: analysis.insights, locale }))
        : []),
      ...(graph?.candidates ?? []).slice(0, 3).map((c) => fromGraph(c, locale)),
    ],
    context: {
      relationships: [relationshipFrom({ company: { id: company.id, name: company.name, stage: company.stage }, contacts: memory.contacts, interactions: memory.interactions, followUps: memory.followUps, events: companyEvents, today })],
      signals: signals.items
        .filter((x) => isOpenSignal(x.signal))
        .map(({ signal: x }) => ({ id: x.id, companyId: x.companyId, companyName: company.name, headline: x.headline, kind: x.kind, publishedOn: x.publishedOn, epistemic: x.epistemic })),
    },
    hasAnalysis: Boolean(intel),
    analysisStatus: analysis?.status ?? null,
    hasGraphPattern: (graph?.candidates.length ?? 0) > 0,
  });
  const knownFacts = [
    ...(company.stage ? [`${t("network.relationship.title")}: ${t(`network.stages.${company.stage}`)}`] : []),
    ...(intel ? [t("network.business.researchOnFile", { date: formatDate(intel.researchedAt, locale) })] : []),
    ...(graph && graph.offers.length > 0 ? [`${t("graph.company.offers")}: ${graph.offers.map((x) => (x.vocabulary === "concept" ? conceptLabel(x.term, locale) : x.label)).join(", ")}`] : []),
    ...(graph && graph.seeks.length > 0 ? [`${t("graph.company.seeks")}: ${graph.seeks.map((x) => (x.vocabulary === "concept" ? conceptLabel(x.term, locale) : x.label)).join(", ")}`] : []),
  ];

  const action = nextBestAction({ stage: company.stage, contacts: memory.contacts, interactions: memory.interactions, followUps: memory.followUps, validationQuestion: question, today });
  const timeline = buildTimeline({ addedAt: company.addedAt, origin: company.origin, interactions: memory.interactions, events: memory.events });
  const openFollowUps = memory.followUps.filter((f) => f.status === "open").sort(compareFollowUps);
  const closedFollowUps = memory.followUps.filter((f) => f.status !== "open").sort(compareFollowUps);
  const contactName = new Map(memory.contacts.map((c) => [c.id, c.name]));
  const runId = discoverRunId(company.externalRef);
  const ctx = { locale, organizationId: active.organizationId, companyId: company.id };

  return (
    <Page>
      <div>
        <Link href="/workspace/network" className={cx("inline-flex items-center gap-1 rounded text-[13px] text-fg-muted hover:text-fg", focusRing)}>
          ← {t("network.back")}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Monogram name={company.name} size={44} />
            <div className="min-w-0">
              <h1 className="truncate text-[24px] font-semibold tracking-tight text-fg" data-testid="company-name">
                {company.name}
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
                {company.website ? (
                  <a href={company.website} target="_blank" rel="noopener noreferrer nofollow" className={cx("rounded text-brand hover:underline", focusRing)}>
                    {domain ?? company.website}
                  </a>
                ) : (
                  <span className="text-fg-faint">{t("network.detail.noWebsite")}</span>
                )}
                <span>· {t("network.detail.added", { date: formatDay(company.addedAt, locale) })}</span>
              </div>
            </div>
          </div>
          <div data-testid="company-stage">
            <StageBadge locale={locale} stage={company.stage} />
          </div>
        </div>
        {company.summary && <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-fg-muted">{company.summary}</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <NextActionCard action={action} company={company} contacts={memory.contacts} today={today} canWrite={canWrite} {...ctx} />

          <OpportunityIntelligenceCard
            intel={intelligence}
            locale={locale}
            searchHref={`/workspace?q=${encodeURIComponent(domain ?? company.name)}`}
            profileHref={!ownCtx || analysis?.status === "own_profile_missing" ? "/workspace/company" : null}
            knownFacts={knownFacts}
          />

          <SignalsCard locale={locale} items={signals.items} ownName={signals.ownName} canWrite={canWrite} contacts={memory.contacts} today={today} company={company} organizationId={active.organizationId} reanalyzeHref={`/workspace?q=${encodeURIComponent(domain ?? company.name)}`} />

          <Card data-testid="follow-ups">
            <CardHeader title={t("network.followUps.title")} />
            {canWrite && (
              // In the card body, not the header's shrink-0 action slot: an open form takes the column's width, never its own intrinsic width.
              <div className="min-w-0 px-5 pt-3" data-testid="follow-up-composer">
                <FollowUpForm {...ctx} contacts={memory.contacts} />
              </div>
            )}
            {openFollowUps.length === 0 ? (
              <p className="px-5 py-4 text-[13.5px] text-fg-muted">{t("network.followUps.empty")}</p>
            ) : (
              <ul className={cx("divide-y divide-edge border-t border-edge", canWrite && "mt-3")}>
                {openFollowUps.map((f) => (
                  <FollowUpItem key={f.id} locale={locale} followUp={f} today={today} organizationId={active.organizationId} canWrite={canWrite} contactName={f.contactId ? contactName.get(f.contactId) : null} currentUserId={user.id} />
                ))}
              </ul>
            )}
            {closedFollowUps.length > 0 && (
              <details className="border-t border-edge">
                <summary className={cx("cursor-pointer px-5 py-3 text-[13px] font-medium text-fg-muted hover:text-fg", focusRing)}>
                  {t("network.followUps.showCompleted")} · {closedFollowUps.length}
                </summary>
                <ul className="divide-y divide-edge border-t border-edge" data-testid="completed-follow-ups">
                  {closedFollowUps.map((f) => (
                    <FollowUpItem key={f.id} locale={locale} followUp={f} today={today} organizationId={active.organizationId} canWrite={canWrite} contactName={f.contactId ? contactName.get(f.contactId) : null} currentUserId={user.id} />
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card data-testid="activity">
            <CardHeader title={t("network.interactions.title")} description={t("network.privateNote")} action={canWrite ? <InteractionForm {...ctx} contacts={memory.contacts} /> : undefined} />
            <Timeline locale={locale} entries={timeline} contacts={contactName} followUps={new Map(memory.followUps.map((f) => [f.id, f.title]))} events={eventNames} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card data-testid="relationship">
            <CardHeader title={t("network.relationship.title")} />
            <dl className="space-y-3 px-5 pb-4 text-[13.5px]">
              <div>
                <dt className="text-[12px] font-medium text-fg-faint">{t("network.relationship.stage")}</dt>
                <dd className="mt-0.5">
                  <StageBadge locale={locale} stage={company.stage} />
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium text-fg-faint">{t("network.relationship.origin")}</dt>
                <dd className="mt-0.5 text-fg" data-testid="company-origin">
                  {originLabel(locale, company.origin)}
                  {company.origin && !company.originRecorded && <span className="text-fg-faint"> · {t("network.originDerived")}</span>}
                  {originEvent && (
                    <div className="mt-0.5 text-[12.5px]" data-testid="company-origin-event">
                      <Link href={`/workspace/events/${originEvent.id}`} className={cx("rounded text-brand hover:underline", focusRing)}>
                        {t("events.network.originEvent", { event: originEvent.name })}
                      </Link>
                    </div>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium text-fg-faint">{t("network.relationship.reason")}</dt>
                <dd className={cx("mt-0.5 whitespace-pre-line", company.reason ? "text-fg" : "text-fg-faint")}>{company.reason || t("network.relationship.noReason")}</dd>
              </div>
            </dl>
            {canWrite && (
              <div className="border-t border-edge px-5 py-3">
                <RelationshipForm {...ctx} stage={company.stage} origin={company.originRecorded ? company.origin : null} reason={company.reason} />
              </div>
            )}
          </Card>

          <Card data-testid="company-events">
            <CardHeader title={t("events.network.title")} />
            {companyEvents.length === 0 ? (
              <p className="px-5 pb-4 text-[13.5px] text-fg-muted">{t("events.network.empty")}</p>
            ) : (
              <ul className="divide-y divide-edge border-t border-edge">
                {companyEvents.map(({ event, target }) => (
                  <li key={target.id} className="space-y-1 px-5 py-3">
                    <Link href={`/workspace/events/${event.id}/targets/${target.id}`} className={cx("rounded text-[14px] font-medium text-brand hover:underline", focusRing)}>
                      {event.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
                      <span className="tabular-nums">{eventDates(locale, event)}</span>
                      <PhaseBadge locale={locale} phase={eventPhase(event, today)} />
                      <TargetStatusBadge locale={locale} status={target.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="people">
            <CardHeader title={t("network.contacts.title")} />
            {memory.contacts.length === 0 ? (
              <p className="px-5 pb-4 text-[13.5px] text-fg-muted">{t("network.contacts.empty")}</p>
            ) : (
              <ul className="divide-y divide-edge border-t border-edge">
                {memory.contacts.map((c) => (
                  <li key={c.id} className="px-5 py-3" data-testid="contact">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-fg">{c.name}</span>
                      {c.isPrimary && <Badge tone="brand">{t("network.contacts.primaryBadge")}</Badge>}
                    </div>
                    {c.role && <div className="text-[12.5px] text-fg-muted">{c.role}</div>}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px]">
                      {c.email && (
                        <a href={`mailto:${c.email}`} className={cx("rounded text-brand hover:underline", focusRing)}>
                          {c.email}
                        </a>
                      )}
                      {c.phone && <span className="text-fg-muted">{c.phone}</span>}
                      {c.profileUrl && (
                        <a href={c.profileUrl} target="_blank" rel="noopener noreferrer nofollow" className={cx("rounded text-brand hover:underline", focusRing)}>
                          {websiteDomain(c.profileUrl) ?? c.profileUrl}
                        </a>
                      )}
                    </div>
                    {c.notes && <p className="mt-1 text-[12.5px] whitespace-pre-line text-fg-muted">{c.notes}</p>}
                    {canWrite && (
                      <div className="mt-2">
                        <ContactForm {...ctx} contact={c} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <div className="border-t border-edge px-5 py-3">
                <ContactForm {...ctx} />
              </div>
            )}
          </Card>

          <Card data-testid="business-context">
            <CardHeader title={t("network.business.title")} />
            <div className="space-y-4 px-5 pb-4 text-[13.5px]">
              <section>
                <h3 className="text-[12px] font-medium text-fg-faint">{t("network.business.opportunities")}</h3>
                {opportunities.length === 0 ? (
                  <p className="mt-0.5 text-fg-muted">{t("network.business.noOpportunities")}</p>
                ) : (
                  <ul className="mt-1 space-y-1.5">
                    {opportunities.map((o) => (
                      <li key={o.id}>
                        <div className="font-medium text-fg">{o.title}</div>
                        {o.nextStep && <div className="text-[12.5px] text-fg-muted">{o.nextStep}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section data-testid="public-analysis">
                <h3 className="text-[12px] font-medium text-fg-faint">{t("network.business.research")}</h3>
                {intel ? (
                  <>
                    <p className="mt-0.5 text-fg">{t("network.business.researchOnFile", { date: formatDate(intel.researchedAt, locale) })}</p>
                    <p className="text-[12px] text-fg-faint">{t("network.publicNote")}</p>
                    <Link href={`/workspace?q=${encodeURIComponent(intel.profile.domain)}`} className={cx("mt-1 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
                      {t("network.business.openAnalysis")} →
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="mt-0.5 text-fg-muted">{t("network.business.noResearch")}</p>
                    <Link href={`/workspace?q=${encodeURIComponent(domain ?? company.name)}`} className={cx("mt-1 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
                      {t("network.business.runSearch")} →
                    </Link>
                  </>
                )}
              </section>
              <GraphContext locale={locale} companyId={company.id} graph={graph} />
              {runId && (
                <section>
                  <h3 className="text-[12px] font-medium text-fg-faint">{t("network.business.discover")}</h3>
                  <Link href={`/workspace/agents/runs/${runId}`} className={cx("mt-0.5 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
                    {t("network.business.openRun")} →
                  </Link>
                </section>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

/**
 * PUBLIC business changes about this company, apart from the private activity
 * history. Open signals first; closed ones folded away.
 */
/** Phase 10: what the Opportunity Graph derives for this company. Structure only; the graph view explains each connection. */
function GraphContext({ locale, companyId, graph }: { locale: Locale; companyId: string; graph: CompanyGraphContext | null | undefined }) {
  const t = createTranslator(locale);
  const label = (x: CompanyGraphContext["offers"][number]) => (x.vocabulary === "concept" ? conceptLabel(x.term, locale) : x.label);
  return (
    <section data-testid="graph-context">
      <h3 className="text-[12px] font-medium text-fg-faint">{t("graph.company.title")}</h3>
      {graph === undefined ? (
        <p className="mt-0.5 text-fg-muted">{t("graph.company.unavailable")}</p>
      ) : (
        <>
          {!graph || (graph.offers.length === 0 && graph.seeks.length === 0) ? (
            <p className="mt-0.5 text-fg-muted">{t("graph.company.none")}</p>
          ) : (
            <dl className="mt-1 space-y-1 text-[13px]">
              {(["offers", "seeks"] as const)
                .filter((k) => graph[k].length > 0)
                .map((k) => (
                  <div key={k}>
                    <dt className="text-[12px] text-fg-faint">{t(`graph.company.${k}`)}</dt>
                    <dd className="text-fg">
                      {graph[k].map((x, i) => (
                        <span key={`${x.vocabulary}:${x.term}`}>
                          {i > 0 && ", "}
                          {label(x)}
                          {x.epistemic && <span className="text-fg-faint"> ({t(`evidence.${x.epistemic}`)})</span>}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
            </dl>
          )}
          <p className="mt-1 text-[13px] text-fg-muted">{graph && graph.candidates.length > 0 ? t("graph.company.candidates", { n: graph.candidates.length }) : t("graph.company.noCandidates")}</p>
          <Link href={`/workspace/network?view=graph&focus=${companyId}`} className={cx("mt-1 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)} data-testid="graph-context-open">
            {t("graph.company.open")} →
          </Link>
        </>
      )}
    </section>
  );
}

function SignalsCard({
  locale,
  items,
  ownName,
  canWrite,
  contacts,
  today,
  company,
  organizationId,
  reanalyzeHref,
}: {
  locale: Locale;
  items: Awaited<ReturnType<typeof loadSignalsView>>["items"];
  ownName: string | null;
  canWrite: boolean;
  contacts: ContactView[];
  today: string;
  company: NetworkCompany;
  organizationId: string;
  reanalyzeHref: string;
}) {
  const t = createTranslator(locale);
  const open = items.filter((x) => isOpenSignal(x.signal));
  const closed = items.filter((x) => !isOpenSignal(x.signal));
  const card = (x: (typeof items)[number]) => (
    <SignalCard
      key={x.signal.id}
      locale={locale}
      signal={x.signal}
      assessment={x.assessment}
      reevaluation={x.reevaluation}
      company={{ id: company.id, name: company.name }}
      ownName={ownName}
      stageLabel={company.stage ? t(`network.stages.${company.stage}`) : null}
      canWrite={canWrite}
      organizationId={organizationId}
      contacts={contacts}
      today={today}
      showCompany={false}
    />
  );
  return (
    <Card data-testid="company-signals">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {t("signals.company.title")}
            <Badge tone="outline">{t("signals.publicLabel")}</Badge>
          </span>
        }
        description={t("signals.company.description")}
      />
      {open.length === 0 ? (
        <div className="border-t border-edge px-5 py-4 text-[13.5px]">
          <p className="text-fg-muted">{t("signals.company.empty")}</p>
          <p className="mt-0.5 text-[12.5px] text-fg-faint">{t("signals.company.emptyHelp")}</p>
        </div>
      ) : (
        <div className="divide-y divide-edge border-t border-edge">{open.map(card)}</div>
      )}
      {closed.length > 0 && (
        <details className="border-t border-edge">
          <summary className={cx("cursor-pointer px-5 py-3 text-[13px] font-medium text-fg-muted hover:text-fg", focusRing)}>
            {t("signals.company.closed")} · {closed.length}
          </summary>
          <div className="divide-y divide-edge border-t border-edge">{closed.map(card)}</div>
        </details>
      )}
      <div className="flex min-w-0 flex-wrap items-start gap-3 border-t border-edge px-5 py-3">
        {canWrite && (
          <div className="min-w-0 flex-1 basis-full">
            <RecordSignalForm locale={locale} organizationId={organizationId} companyId={company.id} />
          </div>
        )}
        <Link href={reanalyzeHref} className={cx("rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
          {t("signals.company.reanalyze")} →
        </Link>
        <Link href={`/workspace/intelligence?company=${company.id}&status=all`} className={cx("rounded text-[13px] font-medium text-fg-muted hover:text-fg", focusRing)}>
          {t("signals.company.openIntelligence")} →
        </Link>
      </div>
    </Card>
  );
}

function NextActionCard({
  action,
  company,
  contacts,
  today,
  canWrite,
  locale,
  organizationId,
  companyId,
}: {
  action: NextAction;
  company: NetworkCompany;
  contacts: ContactView[];
  today: string;
  canWrite: boolean;
  locale: Locale;
  organizationId: string;
  companyId: string;
}) {
  const t = createTranslator(locale);
  let title: string;
  let body: string;
  let extra: React.ReactNode = null;
  switch (action.kind) {
    case "follow_up":
      title = t("network.nba.followUp", { title: action.followUp.title });
      body = t("network.nba.followUpBody", { due: dueText(locale, action.followUp, today) });
      if (canWrite) extra = <FollowUpStatusButton locale={locale} organizationId={organizationId} followUpId={action.followUp.id} status="done" variant="primary" />;
      break;
    case "interaction_next_step":
      title = t("network.nba.nextStep", { step: action.interaction.nextStep });
      body = t("network.nba.nextStepBody", { title: action.interaction.title, date: formatDay(action.interaction.occurredAt, locale) });
      if (canWrite)
        extra = (
          <FollowUpForm
            locale={locale}
            organizationId={organizationId}
            companyId={companyId}
            contacts={contacts}
            preset={{ title: action.interaction.nextStep.slice(0, 200), interactionId: action.interaction.id, contactId: action.interaction.contactId }}
            label={t("network.nba.createFromStep")}
          />
        );
      break;
    case "validate":
      title = t("network.nba.validate", { question: action.question });
      body = t("network.nba.validateBody");
      break;
    case "add_contact":
      title = t("network.nba.addContact", { company: company.name });
      body = t("network.nba.addContactBody");
      break;
    case "record_first_contact":
      title = t("network.nba.firstContact", { name: action.contact.name });
      body = t("network.nba.firstContactBody");
      break;
    case "inactive":
      title = t("network.nba.inactive");
      body = t("network.nba.inactiveBody", { stage: t(`network.stages.${action.stage}`) });
      break;
    case "none":
      title = t("network.nba.none");
      body = t("network.nba.noneBody");
      break;
  }
  const quiet = action.kind === "none" || action.kind === "inactive";
  return (
    <section className={cx("min-w-0 rounded-xl border px-5 py-4", quiet ? "border-edge bg-surface" : "border-brand/25 bg-brand-soft/60")} data-testid="next-best-action" data-kind={action.kind}>
      <div className="flex flex-wrap items-start gap-4">
        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface shadow-card", quiet ? "text-fg-faint" : "text-brand")}>
          <Icon name={action.kind === "follow_up" ? "clock" : "arrow"} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cx("text-[12px] font-semibold uppercase tracking-wide", quiet ? "text-fg-faint" : "text-brand")}>{t("network.nba.title")}</div>
          <div className="mt-0.5 text-[15px] font-semibold text-fg" data-testid="next-best-action-title">
            {title}
          </div>
          <p className="text-[13px] text-fg-muted">{body}</p>
          {action.kind === "follow_up" && action.followUp.description && <p className="mt-1 text-[13px] whitespace-pre-line text-fg-muted">{action.followUp.description}</p>}
          <p className="mt-1.5 text-[11.5px] text-fg-faint">{t("network.nba.deterministic")}</p>
        </div>
      </div>
      {/* Full-width row under the action (not a flex sibling), so an opened form is bounded by the column. */}
      {extra && (
        <div className="mt-3 min-w-0" data-testid="next-best-action-extra">
          {extra}
        </div>
      )}
      {action.kind === "follow_up" && (
        <div className="mt-2 pl-13 text-[12px]">
          <DueLabel locale={locale} followUp={action.followUp} today={today} />
        </div>
      )}
    </section>
  );
}

function Timeline({ locale, entries, contacts, followUps, events }: { locale: Locale; entries: TimelineEntry[]; contacts: Map<string, string>; followUps: Map<string, string>; events: Map<string, string> }) {
  const t = createTranslator(locale);
  const fu = (id: string | null) => (id && followUps.get(id)) || t("network.timeline.followUpRemoved");
  const label = (e: TimelineEntry): string => {
    if (e.kind === "added") return e.origin ? t("network.timeline.addedFrom", { origin: originLabel(locale, e.origin) }) : t("network.timeline.added");
    if (e.kind === "interaction") return e.interaction.title;
    const ev = e.event;
    switch (ev.kind) {
      case "stage_changed":
        if (!ev.to) return t("network.timeline.stageCleared");
        return ev.from ? t("network.timeline.stageChanged", { from: t(`network.stages.${ev.from}`), to: t(`network.stages.${ev.to}`) }) : t("network.timeline.stageSet", { to: t(`network.stages.${ev.to}`) });
      case "contact_added": {
        const name = ev.subjectId ? contacts.get(ev.subjectId) : undefined;
        return name ? t("network.timeline.contactAdded", { name }) : t("network.timeline.contactRemoved");
      }
      case "follow_up_created":
        return t("network.timeline.followUpCreated", { title: fu(ev.subjectId) });
      case "follow_up_done":
        return t("network.timeline.followUpDone", { title: fu(ev.subjectId) });
      case "follow_up_dismissed":
        return t("network.timeline.followUpDismissed", { title: fu(ev.subjectId) });
      case "follow_up_reopened":
        return t("network.timeline.followUpReopened", { title: fu(ev.subjectId) });
    }
  };
  return (
    <>
      <ol className="relative space-y-0 border-t border-edge px-5 py-4" data-testid="timeline">
        {entries.map((e, i) => (
          <li key={e.kind === "added" ? "added" : e.kind === "interaction" ? `i-${e.interaction.id}` : `e-${e.event.id}`} className="relative flex gap-3 pb-4 last:pb-0" data-testid={`timeline-${e.kind}`}>
            {i < entries.length - 1 && <span className="absolute top-3 bottom-0 left-[5px] w-px bg-edge" aria-hidden />}
            <span className={cx("relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-surface", e.kind === "interaction" ? "bg-brand" : "bg-edge-strong")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {e.kind === "interaction" && <span className="text-[12px] font-semibold uppercase tracking-wide text-brand">{t(`network.interactionKinds.${e.interaction.kind}`)}</span>}
                <span className={cx("text-[13.5px]", e.kind === "interaction" ? "font-medium text-fg" : "text-fg-muted")}>{label(e)}</span>
              </div>
              <div className="text-[12px] text-fg-faint tabular-nums">
                {formatDate(e.at, locale)}
                {e.kind === "interaction" && e.interaction.contactId && contacts.get(e.interaction.contactId) && ` · ${contacts.get(e.interaction.contactId)}`}
                {e.kind === "interaction" && e.interaction.eventId && events.get(e.interaction.eventId) && ` · ${t("events.network.metAt", { event: events.get(e.interaction.eventId) ?? "" })}`}
              </div>
              {e.kind === "interaction" && (
                <div className="mt-1 space-y-1 text-[13px] text-fg-muted">
                  {e.interaction.summary && <p className="whitespace-pre-line">{e.interaction.summary}</p>}
                  {e.interaction.outcome && (
                    <p>
                      <span className="font-medium text-fg">{t("network.interactions.outcomeLabel")}:</span> {e.interaction.outcome}
                    </p>
                  )}
                  {e.interaction.nextStep && (
                    <p>
                      <span className="font-medium text-fg">{t("network.interactions.nextStepLabel")}:</span> {e.interaction.nextStep}
                    </p>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-edge px-5 py-2.5 text-[12px] text-fg-faint">{t("network.timeline.startsHere")}</p>
    </>
  );
}

