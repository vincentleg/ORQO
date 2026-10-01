import Link from "next/link";
import { formatDay } from "@/components/orqo/analysis";
import { dueText, formatIsoDay } from "@/components/orqo/network";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type Translator } from "@/lib/i18n/translate";
import { conceptLabel } from "@/lib/intelligence/concepts";
import type { ContactView } from "@/lib/network/model";
import { isOpenSignal, type EvidenceQuality, type SignalView } from "@/lib/signals/model";
import type { Reevaluation, RelevanceReason, RelevanceState, SignalAssessment } from "@/lib/signals/relevance";
import { SignalFollowUpForm, SignalStatusButton } from "./signal-forms";
import { Badge, cx, focusRing, type BadgeTone } from "./ui";

/*
 * Signal display (Phase 7). Server components. A card keeps three things
 * visibly apart: the PUBLIC change and its source, ORQO's deterministic
 * reasoning (fact / inference), and PRIVATE context from the team's own
 * records (labeled, never shown as evidence). Nothing here calls a model.
 */

const RELEVANCE_TONE: Record<RelevanceState, BadgeTone> = { relevant: "positive", potentially_relevant: "brand", needs_validation: "caution", no_clear_link: "outline" };
const QUALITY_DOT: Record<EvidenceQuality, string> = { strong: "bg-positive", moderate: "bg-brand", limited: "bg-caution" };

function concepts(keys: readonly string[], locale: Locale): string {
  return keys.map((k) => conceptLabel(k, locale)).join(", ");
}

export function RelevanceBadge({ locale, state }: { locale: Locale; state: RelevanceState }) {
  return <Badge tone={RELEVANCE_TONE[state]}>{createTranslator(locale)(`signals.relevance.${state}`)}</Badge>;
}

/** The organization's own words, quoted — never a lexicon label standing in for them. */
function quoted(items: readonly string[], locale: Locale): string {
  return items.map((s) => (locale === "fr" ? `« ${s} »` : `“${s}”`)).join(", ");
}

function reasonText(t: Translator, r: RelevanceReason, locale: Locale, stage: string | null): string {
  if (r.dimension === "capability_fit") {
    const own = r.ownTerms ?? [];
    // "Your stated offering includes" only with declared offerings, as written.
    if (r.build && own.length) return t("signals.reasons.capability_fit_build", { offers: quoted(own, locale) });
    return own.length ? t("signals.reasons.capability_fit", { concepts: concepts(r.concepts, locale), profile: quoted(own, locale) }) : t("signals.reasons.capability_fit_summary", { concepts: concepts(r.concepts, locale) });
  }
  if (r.dimension === "relationship") return t("signals.reasons.relationship", { stage: stage ?? "" });
  return t(`signals.reasons.${r.dimension}`, { concepts: concepts(r.concepts, locale) });
}

function ReevaluationLine({ locale, reevaluation, today }: { locale: Locale; reevaluation: Reevaluation; today: string }) {
  const t = createTranslator(locale);
  if (reevaluation.kind === "no_material_change") return <p className="text-[13px] text-fg-muted">{t(reevaluation.why === "closed" ? "signals.reeval.closed" : "signals.reeval.no_material_change")}</p>;
  const followUp = reevaluation.kind === "review" ? null : reevaluation.followUp;
  return (
    <div className="space-y-0.5 text-[13px]" data-testid="signal-reevaluation" data-kind={reevaluation.kind}>
      <p className="font-medium text-fg">{t(`signals.reeval.${reevaluation.kind}`)}</p>
      {reevaluation.kind !== "review" && <p className="text-fg-muted">{followUp ? t("signals.reeval.followUpExisting", { title: followUp.title, due: dueText(locale, followUp, today) }) : t("signals.reeval.noFollowUp")}</p>}
    </div>
  );
}

export interface SignalCardProps {
  locale: Locale;
  signal: SignalView;
  assessment: SignalAssessment;
  reevaluation: Reevaluation;
  company: { id: string; name: string };
  ownName: string | null;
  stageLabel: string | null;
  canWrite: boolean;
  organizationId: string;
  contacts: readonly ContactView[];
  today: string;
  /** On the Intelligence page the company is named and linked; on the company page it is implicit. */
  showCompany: boolean;
}

export function SignalCard({ locale, signal: s, assessment: a, reevaluation, company, ownName, stageLabel, canWrite, organizationId, contacts, today, showCompany }: SignalCardProps) {
  const t = createTranslator(locale);
  const open = isOpenSignal(s);
  const kindLabel = t(`signals.kinds.${s.kind}`);
  return (
    <article className={cx("min-w-0 px-5 py-4", !open && "opacity-80")} data-testid="signal" data-status={s.status} data-relevance={a.state}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{kindLabel}</Badge>
        <RelevanceBadge locale={locale} state={a.state} />
        {s.status !== "new" && <Badge tone="outline">{t(`signals.statuses.${s.status}`)}</Badge>}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{t("signals.publicLabel")}</span>
        {showCompany && (
          <Link href={`/workspace/network/${company.id}`} className={cx("ml-auto rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
            {company.name}
          </Link>
        )}
      </div>

      <div className="mt-2">
        {s.epistemic === "fact" ? (
          <blockquote className="border-l-2 border-edge-strong pl-3 text-[14.5px] leading-snug font-medium text-fg" data-testid="signal-headline">
            {s.headline}
          </blockquote>
        ) : (
          <p className="text-[14.5px] leading-snug font-medium text-fg" data-testid="signal-headline">
            {t("signals.mentioned", { concepts: concepts(s.concepts, locale) })}
          </p>
        )}
        {s.detail && <p className="mt-1 text-[13px] whitespace-pre-line text-fg-muted">{s.detail}</p>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-faint tabular-nums">
        <span data-testid="signal-published">{s.publishedOn ? t("signals.published", { date: formatIsoDay(s.publishedOn, locale) }) : t("signals.publishedUnknown")}</span>
        <span>{t("signals.firstSeen", { date: formatDay(s.firstSeenAt, locale) })}</span>
        <span>{t(`signals.authority.${s.sourceAuthority}`)}</span>
        <span className="inline-flex items-center gap-1">
          <span className={cx("h-1.5 w-1.5 rounded-full", QUALITY_DOT[s.evidenceQuality])} aria-hidden />
          {t(`signals.quality.${s.evidenceQuality}`)}
        </span>
      </div>

      <div className="mt-3 rounded-lg bg-subtle/70 px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{t("signals.reeval.title")}</div>
        <ReevaluationLine locale={locale} reevaluation={reevaluation} today={today} />
        {s.followUpId && <p className="mt-0.5 text-[12.5px] text-fg-muted">{t("signals.reeval.linkedFollowUp")}</p>}
        <p className="mt-1 text-[11.5px] text-fg-faint">{t("signals.reeval.human")}</p>
      </div>

      <details className="group mt-3">
        <summary className={cx("cursor-pointer rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>{t("signals.details")}</summary>
        <div className="mt-3 grid gap-4 text-[13px] md:grid-cols-2">
          <section className="min-w-0" data-testid="signal-why">
            <h4 className="text-[12px] font-medium text-fg-faint">{ownName ? t("signals.whyTitle", { own: ownName }) : t("signals.whyTitleNoOwn")}</h4>
            {a.reasons.filter((r) => r.basis !== "private").length === 0 ? (
              <p className="mt-1 text-fg-muted">{t("signals.noReasons")}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {a.reasons
                  .filter((r) => r.basis !== "private")
                  .map((r) => (
                    <li key={r.dimension} className="flex gap-2">
                      <span className="mt-0.5 shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">{t(`signals.basis.${r.basis}`)}</span>
                      <span className="text-fg">{reasonText(t, r, locale, stageLabel)}</span>
                    </li>
                  ))}
              </ul>
            )}
            <h4 className="mt-3 text-[12px] font-medium text-fg-faint">{t("signals.unknownsTitle")}</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fg-muted" data-testid="signal-unknowns">
              {a.unknowns.map((u) => (
                <li key={u}>{t(`signals.unknowns.${u}`, { company: company.name })}</li>
              ))}
            </ul>
          </section>

          <section className="min-w-0" data-testid="signal-evidence">
            <h4 className="text-[12px] font-medium text-fg-faint">
              {t("signals.evidenceTitle")} · {t("signals.publicLabel")}
            </h4>
            <p className="mt-1 text-[12px] text-fg-faint">{t(`signals.epistemic.${s.epistemic}`)}</p>
            {s.excerpt && s.excerpt !== s.headline && <blockquote className="mt-1 border-l-2 border-edge pl-3 text-fg-muted italic">“{s.excerpt}”</blockquote>}
            <p className="mt-1.5">
              <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className={cx("rounded break-all text-brand hover:underline", focusRing)}>
                {s.sourceLabel || s.sourceUrl}
              </a>
            </p>
            <p className="mt-0.5 text-[12px] text-fg-faint">
              {t(`signals.authority.${s.sourceAuthority}`)} · {t(`signals.origin.${s.origin}`)}
              {s.retrievedAt && ` · ${t("signals.retrieved", { date: formatDay(s.retrievedAt, locale) })}`}
            </p>
            {s.previousResearchedAt && (
              <p className="mt-1.5 text-[12.5px] text-fg-muted" data-testid="signal-before">
                {s.previousConcepts.length
                  ? t("signals.before", { date: formatDay(s.previousResearchedAt, locale), concepts: concepts(s.previousConcepts, locale) })
                  : t("signals.beforeNothing", { date: formatDay(s.previousResearchedAt, locale) })}
              </p>
            )}
            {s.lastSeenAt.slice(0, 10) !== s.firstSeenAt.slice(0, 10) && <p className="mt-0.5 text-[12px] text-fg-faint">{t("signals.seenAgain", { date: formatDay(s.lastSeenAt, locale) })}</p>}
          </section>
        </div>

        {(a.privateMatches.length > 0 || a.reasons.some((r) => r.dimension === "relationship")) && (
          <section className="mt-4 rounded-lg border border-dashed border-edge-strong px-3 py-2.5 text-[13px]" data-testid="signal-private-context">
            <h4 className="flex items-center gap-2 text-[12px] font-medium text-fg-faint">
              <span className="font-semibold uppercase tracking-wide">{t("signals.privateLabel")}</span>
              {t("signals.privateTitle")}
            </h4>
            <ul className="mt-1 space-y-0.5 text-fg">
              {a.reasons
                .filter((r) => r.basis === "private")
                .map((r) => (
                  <li key={r.dimension}>{reasonText(t, r, locale, stageLabel)}</li>
                ))}
              {a.privateMatches.map((m, i) => (
                <li key={`${m.kind}-${m.id ?? i}`} className="text-fg-muted">
                  {m.kind === "interaction"
                    ? t("signals.privateMatch.interaction", { title: m.title, date: m.at ? formatDay(m.at, locale) : "" })
                    : m.kind === "follow_up"
                      ? t("signals.privateMatch.follow_up", { title: m.title })
                      : t("signals.privateMatch.reason")}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11.5px] text-fg-faint">{t("signals.privateExplain")}</p>
          </section>
        )}
      </details>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {canWrite && s.status === "new" && <SignalStatusButton locale={locale} organizationId={organizationId} signalId={s.id} status="reviewed" label="signals.actions.reviewed" />}
        {canWrite && open && <SignalStatusButton locale={locale} organizationId={organizationId} signalId={s.id} status="dismissed" label="signals.actions.dismissed" />}
        {canWrite && s.status === "dismissed" && <SignalStatusButton locale={locale} organizationId={organizationId} signalId={s.id} status="new" label="signals.actions.restore" />}
        {canWrite && (s.status === "reviewed" || s.status === "acted_on") && <SignalStatusButton locale={locale} organizationId={organizationId} signalId={s.id} status="new" label="signals.actions.reopen" />}
        {showCompany && (
          <Link href={`/workspace/network/${company.id}`} className={cx("inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-fg-muted hover:bg-subtle hover:text-fg", focusRing)}>
            {t("signals.actions.openCompany")} →
          </Link>
        )}
      </div>
      {canWrite && open && reevaluation.kind !== "no_material_change" && (
        <div className="mt-2 min-w-0">
          <SignalFollowUpForm
            locale={locale}
            organizationId={organizationId}
            signalId={s.id}
            contacts={contacts}
            title={t("signals.actions.followUpTitle", { company: company.name, kind: kindLabel.toLowerCase() })}
            description={t("signals.actions.followUpDescription", { headline: s.epistemic === "fact" ? s.headline : t("signals.mentioned", { concepts: concepts(s.concepts, locale) }), url: s.sourceUrl })}
          />
        </div>
      )}
    </article>
  );
}
