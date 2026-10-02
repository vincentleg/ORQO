/**
 * ORQO CEO and the Work briefing (Phase 16B). Server components, read-only.
 * The CEO answers with ORQO's own objects: the company dossier, a tracked opportunity, the briefing. Never
 * free prose, never simulated thinking or progress. Every sentence comes from labels and stored records.
 */
import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import type { CeoAnswer, ClarifyOption } from "@/lib/server/ceo/answer";
import type { Briefing, BriefingItem, BriefingQuestion, ContinueItem } from "@/lib/server/ceo/briefing";
import { NOT_SURE } from "@/lib/understanding/types";
import { formatDay } from "./analysis";
import { DossierView, investigationText, questionText, scenarioTitle, type DossierActions } from "./dossier";
import { Icon } from "./icons";
import { RelationshipQuestion } from "./opportunity-forms";
import { mainUnknown, trackedTitle, TrackedOpportunityView } from "./tracked-opportunity";
import { NextQuestionCard } from "./understanding";
import { Badge, ButtonLink, cx, focusRing, inputClass } from "./ui";

type T = ReturnType<typeof createTranslator>;

const H2 = ({ id, children }: { id?: string; children: string }) => (
  <h2 id={id} className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
    {children}
  </h2>
);

/** The CEO input: one field, one obvious action. A plain GET form: nothing streams, nothing pretends to think. */
export function CeoInput({ locale, value, autoFocus }: { locale: Locale; value: string; autoFocus: boolean }) {
  const t = createTranslator(locale);
  return (
    <form action="/workspace" method="get" role="search" data-testid="ceo-form">
      <label htmlFor="ceo-ask" className="sr-only">
        {t("work.inputLabel")}
      </label>
      <div className="flex flex-col gap-2 sm:relative sm:block">
        <input
          id="ceo-ask"
          name="ask"
          type="text"
          defaultValue={value}
          maxLength={500}
          placeholder={t("work.placeholder")}
          autoComplete="off"
          autoFocus={autoFocus}
          className={cx(inputClass, "h-14 rounded-2xl px-5 text-[16px] shadow-raised sm:pr-40")}
        />
        <button type="submit" className={cx("h-12 rounded-xl bg-brand px-5 text-[15px] font-medium text-white hover:bg-brand-strong sm:absolute sm:top-1/2 sm:right-2 sm:h-10 sm:-translate-y-1/2", focusRing)}>
          {t("work.submit")}
        </button>
      </div>
    </form>
  );
}

export function CeoExamples({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t("work.examplesLabel")} role="group">
      {(["priorities", "next", "find"] as const).map((k) => (
        <Link key={k} href={`/workspace?ask=${encodeURIComponent(t(`work.examples.${k}`))}`} className={cx("inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-[13.5px] text-fg-muted hover:border-brand/40 hover:text-fg", focusRing)}>
          {t(`work.examples.${k}`)}
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Briefing parts

function itemView(t: T, item: BriefingItem) {
  if (item.kind === "tracked") {
    const o = item.opportunity;
    return { key: o.id, title: trackedTitle(t, o), company: o.targetName, href: `/workspace/opportunities/${o.id}`, status: t("work.trackedStatus", { status: t(`opportunities.status.${o.status}`) }), tracked: true, unknown: mainUnknown(t, o) };
  }
  const q = item.dossier.nextQuestion;
  return { key: `${item.companyId}:${item.scenario.key}`, title: scenarioTitle(t, item.dossier, item.scenario), company: item.companyName, href: `/workspace/companies/${item.companyId}`, status: t("work.notTracked"), tracked: false, unknown: q ? questionText(t, item.dossier, q) : null };
}

export function TopOpportunities({ items, locale, headingId }: { items: BriefingItem[]; locale: Locale; headingId: string }) {
  const t = createTranslator(locale);
  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="work-top">
      <H2 id={headingId}>{t("work.topTitle")}</H2>
      {items.length === 0 ? (
        <div className="rounded-2xl bg-surface px-5 py-5 text-[14.5px] leading-relaxed shadow-card" data-testid="work-top-empty">
          <p className="text-fg">{t("work.topEmpty")}</p>
          <p className="mt-1 text-fg-muted">{t("work.topEmptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const v = itemView(t, item);
            return (
              <li key={v.key}>
                <Link href={v.href} className={cx("block rounded-2xl bg-surface px-5 py-4 shadow-card transition-shadow hover:shadow-raised", focusRing)} data-testid="work-top-item" data-kind={item.kind}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-[16px] font-semibold text-fg">{v.title}</span>
                    <Badge tone={v.tracked ? "brand" : "outline"}>{v.status}</Badge>
                  </span>
                  {v.unknown && <span className="mt-1.5 block text-[14px] text-fg-muted">{t("work.decisive", { question: v.unknown })}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function stated(t: T, value: string): string {
  return value
    .split(",")
    .map((v) => t(`dossier.relationship.answers.${v}` as MessageKey))
    .join(", ");
}

export function ContinueWorking({ items, locale, headingId }: { items: ContinueItem[]; locale: Locale; headingId: string }) {
  const t = createTranslator(locale);
  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="work-continue">
      <div className="flex items-baseline justify-between gap-3">
        <H2 id={headingId}>{t("work.continueTitle")}</H2>
        <Link href="/workspace/companies" className={cx("rounded text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
          {t("work.allCompanies")}
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-[14px] text-fg-muted">{t("work.continueEmpty")}</p>
      ) : (
        <ul className="divide-y divide-edge rounded-2xl bg-surface shadow-card">
          {items.map(({ remembered: r, verdict }) => (
            <li key={r.company.id}>
              <Link href={`/workspace/companies/${r.company.id}`} className={cx("flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3", focusRing)} data-testid="work-continue-item">
                <span className="min-w-0 font-medium text-fg">{r.company.name}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
                  {r.research ? <span>{t("work.signals.researched", { date: formatDay(r.research.researchedAt, locale) })}</span> : <span>{t("work.signals.notResearched")}</span>}
                  {r.tracked.length > 0 && <span>{t("work.signals.tracked")}</span>}
                  {r.statedRelationship && r.statedRelationship !== NOT_SURE && <span>{t("work.signals.stated", { role: stated(t, r.statedRelationship) })}</span>}
                  {verdict && <Badge tone={verdict === "opportunity" ? "brand" : "neutral"}>{t(`work.verdict.${verdict}`)}</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OneQuestion({ question, locale, organizationId, canWrite, headingId }: { question: BriefingQuestion | null; locale: Locale; organizationId: string; canWrite: boolean; headingId: string }) {
  const t = createTranslator(locale);
  if (!question || (!canWrite && question.kind !== "own_missing")) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="work-question" data-kind={question.kind}>
      <H2 id={headingId}>{t("work.questionTitle")}</H2>
      {question.kind === "own_missing" ? (
        <div className="rounded-2xl bg-surface px-5 py-5 shadow-card">
          <p className="text-[16px] font-semibold text-fg">{t("work.ownMissing.title")}</p>
          <p className="mt-1 text-[14px] text-fg-muted">{t("work.ownMissing.body")}</p>
          <ButtonLink href="/workspace/company" variant="primary" className="mt-4 min-h-11">
            {t("work.ownMissing.cta")}
          </ButtonLink>
        </div>
      ) : question.kind === "relationship" ? (
        <div className="rounded-2xl bg-surface px-5 py-5 shadow-card">
          <RelationshipQuestion locale={locale} organizationId={organizationId} companyId={question.companyId} ownName={question.ownName} targetName={question.companyName} />
        </div>
      ) : (
        <NextQuestionCard question={question.question} locale={locale} organizationId={organizationId} />
      )}
    </section>
  );
}

export function MemoryLine({ briefing, locale }: { briefing: Briefing; locale: Locale }) {
  const t = createTranslator(locale);
  if (briefing.remembered === 0) return null;
  return (
    <p className="text-[13.5px] leading-relaxed text-fg-muted" data-testid="work-memory">
      {t("work.memory", { remembered: briefing.remembered, researched: briefing.researched })}
      {briefing.noOpportunity > 0 && ` ${t("work.memoryNegative", { count: briefing.noOpportunity })}`}
    </p>
  );
}

// ---------------------------------------------------------------------------
// CEO answers

function OptionLink({ o, objective, t }: { o: ClarifyOption; objective: string; t: T }) {
  const params = new URLSearchParams({ ask: objective, as: o.as });
  if (o.companyId) params.set("company", o.companyId);
  return (
    <Link href={`/workspace?${params}`} className={cx("inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-[14px] text-fg hover:border-brand/40", focusRing)} data-testid="ceo-option">
      {t(`ceo.options.${o.as}`, { company: o.companyName ?? "" })}
    </Link>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[20px] leading-snug font-semibold tracking-tight text-fg" data-testid="ceo-headline">
      {children}
    </h2>
  );
}

export function CeoAnswerView({ answer: a, locale, actions }: { answer: CeoAnswer; locale: Locale; actions: Omit<DossierActions, "companyId" | "q" | "tracked"> }) {
  const t = createTranslator(locale);
  const body = (() => {
    switch (a.kind) {
      case "company": {
        const d = a.dossier;
        const company = a.company.name;
        const lead = d.scenarios[0] ?? d.novel[0] ?? null;
        const companyHref = a.company.id ? `/workspace/companies/${a.company.id}` : `/workspace/companies?q=${encodeURIComponent(a.company.domain ?? company)}`;
        const verdictLine = d.verdict === "opportunity" && lead ? t("ceo.headline.opportunity", { company, title: scenarioTitle(t, d, lead) }) : d.verdict === "no_credible_opportunity" ? t("ceo.headline.none", { company }) : t("ceo.headline.insufficient", { company });
        const dossierActions: DossierActions = { ...actions, companyId: a.company.id, q: a.company.id ? null : (a.company.domain ?? company), tracked: Object.fromEntries(a.tracked.map((o) => [o.scenarioKey, o.id])) };
        const open = (
          <Link href={companyHref} className={cx("inline-flex min-h-11 items-center gap-1.5 rounded text-[14px] font-medium text-brand hover:underline", focusRing)} data-testid="ceo-open-company">
            {t("ceo.open", { company })} <Icon name="arrow" size={14} />
          </Link>
        );
        if (a.focus === "missing") {
          const unknowns = d.verdict === "no_credible_opportunity" ? (d.negative?.unknowns ?? []) : d.questions;
          const facets = d.targetDna.unknowns.filter((f) => !["certifications", "case_studies", "identity", "strategic_signals"].includes(f)).slice(0, 5);
          return (
            <>
              <Headline>{t("ceo.missingTitle", { company })}</Headline>
              <ul className="list-disc space-y-1.5 pl-5 text-[15px] text-fg" data-testid="ceo-missing">
                {d.relationship.status === "unknown" && <li>{t("ceo.missingRelationship", { company, own: d.ownName })}</li>}
                {unknowns.map((q) => (
                  <li key={q.key}>{questionText(t, d, q)}</li>
                ))}
                {facets.length > 0 && <li>{t("ceo.missingFacets", { list: facets.map((f) => t(`understanding.facets.${f}` as MessageKey).toLowerCase()).join(", ") })}</li>}
                {d.relationship.status !== "unknown" && unknowns.length === 0 && facets.length === 0 && <li>{t("ceo.missingNone")}</li>}
              </ul>
              {d.askRelationship && actions.canWrite && a.company.id && (
                <div className="rounded-2xl bg-surface px-5 py-5 shadow-card">
                  <RelationshipQuestion locale={locale} organizationId={actions.organizationId} companyId={a.company.id} ownName={d.ownName} targetName={company} />
                </div>
              )}
              {open}
            </>
          );
        }
        if (a.focus === "next") {
          return (
            <>
              <Headline>{t("ceo.nextTitle", { company })}</Headline>
              <p className="text-[16px] text-fg" data-testid="ceo-next">
                {investigationText(t, d, d.next)}
              </p>
              <p className="text-[14px] text-fg-muted">{verdictLine}</p>
              {open}
            </>
          );
        }
        if (a.focus === "meeting") {
          const asks = d.verdict === "no_credible_opportunity" ? (d.negative?.unknowns ?? []) : d.questions;
          return (
            <>
              <Headline>{t("ceo.meetingTitle", { company })}</Headline>
              <p className="rounded-xl bg-caution-soft px-4 py-3 text-[14px] text-caution" data-testid="ceo-limitation">
                {t("ceo.meetingLimit")}
              </p>
              <p className="text-[15px] font-medium text-fg">{verdictLine}</p>
              {asks.length > 0 && (
                <div>
                  <p className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">{t("ceo.meetingAsk")}</p>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[15px] text-fg">
                    {asks.map((q) => (
                      <li key={q.key}>{questionText(t, d, q)}</li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4">
                {d.asOf && (
                  <ButtonLink href={`/workspace/report?q=${encodeURIComponent(a.company.domain ?? company)}`} variant="primary" className="min-h-11" data-testid="ceo-report">
                    {t("ceo.meetingReport")}
                  </ButtonLink>
                )}
                {open}
              </div>
            </>
          );
        }
        return (
          <>
            <Headline>{verdictLine}</Headline>
            {d.verdict === "no_credible_opportunity" && <p className="text-[15px] text-fg-muted">{t("ceo.noneBody")}</p>}
            {open}
            <DossierView dossier={d} locale={locale} reportHref={d.asOf ? `/workspace/report?q=${encodeURIComponent(a.company.domain ?? company)}` : null} actions={dossierActions} />
          </>
        );
      }
      case "not_researched":
        return a.company.name ? (
          <>
            <Headline>{t("ceo.notResearched", { company: a.company.name })}</Headline>
            <p className="text-[15px] text-fg-muted">{t("ceo.notResearchedBody")}</p>
            <ButtonLink href={`/workspace/companies?q=${encodeURIComponent(a.company.domain ?? a.company.name)}`} variant="primary" className="min-h-11 self-start" data-testid="ceo-lookup">
              {t("ceo.notResearchedCta", { company: a.company.name })}
            </ButtonLink>
          </>
        ) : (
          <Headline>{t("ceo.whichCompanyMissing")}</Headline>
        );
      case "own_missing":
        return (
          <>
            <Headline>{t("ceo.ownMissing")}</Headline>
            <ButtonLink href="/workspace/company" variant="primary" className="min-h-11 self-start">
              {t("work.ownMissing.cta")}
            </ButtonLink>
          </>
        );
      case "priorities":
        return (
          <>
            <Headline>{t("ceo.prioritiesTitle")}</Headline>
            <TopOpportunities items={a.briefing.top} locale={locale} headingId="ceo-top" />
          </>
        );
      case "next_investigation": {
        const lead = a.briefing.top[0];
        const v = lead ? itemView(t, lead) : null;
        const cont = a.briefing.continue[0];
        return (
          <>
            <Headline>{t("ceo.nextInvestigationTitle")}</Headline>
            {v ? (
              <Link href={v.href} className={cx("block rounded-2xl bg-surface px-5 py-4 text-[15.5px] text-fg shadow-card hover:shadow-raised", focusRing)} data-testid="ceo-next-lead">
                {t("ceo.nextInvestigationLead", { company: v.company, question: v.unknown ?? v.title })}
              </Link>
            ) : cont ? (
              <Link href={`/workspace/companies/${cont.remembered.company.id}`} className={cx("block rounded-2xl bg-surface px-5 py-4 text-[15.5px] text-fg shadow-card hover:shadow-raised", focusRing)}>
                {t("ceo.nextInvestigationContinue", { company: cont.remembered.company.name })}
              </Link>
            ) : (
              <p className="text-[15px] text-fg-muted">{t("ceo.nextInvestigationNone")}</p>
            )}
          </>
        );
      }
      case "opportunity": {
        const o = a.opportunity;
        return (
          <>
            <Headline>{trackedTitle(t, o)}</Headline>
            <p className={cx("rounded-xl px-4 py-3 text-[14px]", a.now === "same" ? "bg-positive-soft text-positive" : "bg-caution-soft text-caution")} data-testid="ceo-opportunity-now" data-now={a.now}>
              {t(`opportunities.now.${a.now}`, { target: o.targetName })}
            </p>
            <Link href={`/workspace/opportunities/${o.id}`} className={cx("inline-flex min-h-11 items-center gap-1.5 self-start rounded text-[14px] font-medium text-brand hover:underline", focusRing)}>
              {t("dossier.track.open")} <Icon name="arrow" size={14} />
            </Link>
            <TrackedOpportunityView o={o} scenario={a.scenario} locale={locale} />
          </>
        );
      }
      case "prospects":
        return (
          <>
            <Headline>{t("ceo.prospects")}</Headline>
            <ButtonLink href={a.href} variant="primary" className="min-h-11 self-start" data-testid="ceo-discover">
              {t("ceo.prospectsCta")}
            </ButtonLink>
          </>
        );
      case "future":
        return (
          <>
            <Headline>{t(`ceo.future.${a.capability}`)}</Headline>
            <div data-testid="ceo-future" data-capability={a.capability}>
              <p className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">{t("ceo.canDo")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {a.companies.slice(0, 3).map((name) => (
                  <OptionLink key={name} o={{ as: "evaluate_partnership", companyName: name }} objective={name} t={t} />
                ))}
                <OptionLink o={{ as: "show_priorities" }} objective={t("work.examples.priorities")} t={t} />
                <OptionLink o={{ as: "find_prospects" }} objective={t("work.examples.find")} t={t} />
              </div>
            </div>
          </>
        );
      case "clarify":
        return (
          <>
            <Headline>{t(`ceo.clarify.${a.reason}`)}</Headline>
            <div className="flex flex-wrap gap-2" data-testid="ceo-clarify">
              {a.options.map((o) => (
                <OptionLink key={`${o.as}:${o.companyId ?? ""}`} o={o} objective={a.objective} t={t} />
              ))}
            </div>
          </>
        );
    }
  })();
  return (
    <section className="flex flex-col gap-4" aria-live="polite" data-testid="ceo-answer" data-kind={a.kind} data-intent={"intent" in a ? a.intent.type : a.kind === "future" ? "future" : "clarify"}>
      {body}
    </section>
  );
}
