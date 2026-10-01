import Link from "next/link";
import type { ReactNode } from "react";
import { conceptLabel } from "@/lib/intelligence/concepts";
import { isOpennessSignal } from "@/lib/intelligence/extract";
import { candidateVars, driversText, validationQuestion } from "@/lib/intelligence/wording";
import type { Candidate, Check, EvaluatedCandidate, RelevanceAnalysis } from "@/lib/intelligence/relevance";
import type { Claim, ClaimField, Epistemic, TargetProfile } from "@/lib/intelligence/types";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/lib/i18n/translate";
import { Icon } from "./icons";
import { Badge, ButtonLink, Card, cx, focusRing, type BadgeTone } from "./ui";

export { candidateVars, validationQuestion };

/**
 * Company analysis surface (Phase 3). Server component: renders stored
 * evidence and the deterministic relevance analysis. Every statement shows
 * whether it is a FACT or an INFERENCE and links to its numbered source;
 * nothing here is generated at render time except wording from templates.
 */

const DOT: Record<Epistemic, string> = { fact: "bg-positive", inference: "bg-brand", assumption: "bg-caution", unknown: "bg-fg-faint" };
const EPI_KEY: Record<Epistemic, MessageKey> = { fact: "evidence.fact", inference: "evidence.inference", assumption: "evidence.assumption", unknown: "evidence.unknown" };

export function formatDate(iso: string, locale: Locale): string {
  return `${new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso))} UTC`;
}

export function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

function Epi({ kind, t }: { kind: Epistemic; t: Translator }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint" title={t(EPI_KEY[kind])}>
      <span className={cx("h-1.5 w-1.5 rounded-full", DOT[kind])} aria-hidden />
      {t(EPI_KEY[kind])}
    </span>
  );
}

function SourceRef({ claim, profile }: { claim: Claim; profile: TargetProfile }) {
  const i = profile.sources.findIndex((s) => s.key === claim.sourceKey);
  if (i < 0) return null;
  return (
    <a href={`#source-${i + 1}`} className={cx("rounded text-[11.5px] font-medium text-brand tabular-nums hover:underline", focusRing)} aria-label={`source ${i + 1}`}>
      [{i + 1}]
    </a>
  );
}

function ClaimLine({ claim, profile, t, quote = true }: { claim: Claim; profile: TargetProfile; t: Translator; quote?: boolean }) {
  return (
    <li className="flex items-start gap-2 text-[13.5px] leading-snug">
      <Epi kind={claim.epistemic} t={t} />
      <span className="min-w-0 flex-1 text-fg">
        {quote && claim.excerpt ? <q className="text-fg-muted">{claim.excerpt}</q> : claim.statement} <SourceRef claim={claim} profile={profile} />
      </span>
    </li>
  );
}

/** Concept chips for inferred categories, each backed by the first sentence it was inferred from. */
function ConceptChips({ claims, profile, locale, t }: { claims: Claim[]; profile: TargetProfile; locale: Locale; t: Translator }) {
  const byConcept = new Map<string, Claim>();
  for (const c of claims) for (const k of c.concepts) if (!byConcept.has(k)) byConcept.set(k, c);
  if (byConcept.size === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {[...byConcept.entries()].slice(0, 12).map(([k, c]) => (
        <li key={k}>
          <details className="group">
            <summary className={cx("inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-edge bg-subtle px-2.5 py-0.5 text-[12.5px] text-fg", focusRing)}>
              <span className={cx("h-1.5 w-1.5 rounded-full", DOT[c.epistemic])} aria-hidden />
              {conceptLabel(k, locale)}
            </summary>
            <p className="mt-1 max-w-md rounded-lg bg-subtle px-3 py-2 text-[12.5px] text-fg-muted">
              {t("analysis.inferredFrom")} <q>{c.excerpt}</q> <SourceRef claim={c} profile={profile} />
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-fg-faint">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function UnderstandingCard({ profile, locale }: { profile: TargetProfile; locale: Locale }) {
  const t = createTranslator(locale);
  const of = (...fields: ClaimField[]) => profile.claims.filter((c) => fields.includes(c.field));
  const summary = of("summary")[0];
  const products = of("product").slice(0, 10);
  const customers = of("customer").filter((c) => c.epistemic === "fact").slice(0, 3);
  const strategy = of("strategy").slice(0, 3);
  const needs = of("need").slice(0, 3);
  return (
    <Card className="p-5" data-testid="analysis-understanding">
      <h2 className="text-[15px] font-semibold text-fg">{t("analysis.whatTheyDo")}</h2>
      <div className="mt-4 space-y-5">
        {summary && (
          <div className="rounded-lg border border-edge bg-subtle/60 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <Epi kind={summary.epistemic} t={t} />
              <span className="text-[11.5px] text-fg-faint">{t("analysis.statedByCompany")}</span>
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-fg">
              {summary.statement} <SourceRef claim={summary} profile={profile} />
            </p>
          </div>
        )}
        {of("offering").length > 0 && (
          <Block title={t("analysis.offering")}>
            <ConceptChips claims={of("offering")} profile={profile} locale={locale} t={t} />
          </Block>
        )}
        {products.length > 0 && (
          <Block title={t("analysis.products")}>
            <ul className="flex flex-wrap gap-1.5">
              {products.map((c) => (
                <li key={c.id} className="inline-flex items-center gap-1 rounded-md border border-edge px-2 py-0.5 text-[12.5px] text-fg">
                  {c.statement} <SourceRef claim={c} profile={profile} />
                </li>
              ))}
            </ul>
          </Block>
        )}
        {of("technology").length > 0 && (
          <Block title={t("analysis.technologies")}>
            <ConceptChips claims={of("technology")} profile={profile} locale={locale} t={t} />
          </Block>
        )}
        {of("industry", "customer").some((c) => c.concepts.length > 0) && (
          <Block title={t("analysis.industries")}>
            <ConceptChips claims={of("industry", "customer")} profile={profile} locale={locale} t={t} />
          </Block>
        )}
        {customers.length > 0 && (
          <Block title={t("analysis.customers")}>
            <ul className="space-y-1.5">
              {customers.map((c) => (
                <ClaimLine key={c.id} claim={c} profile={profile} t={t} />
              ))}
            </ul>
          </Block>
        )}
        {of("geography").length > 0 && (
          <Block title={t("analysis.geographies")}>
            <ConceptChips claims={of("geography").filter((c) => c.method === "page_text")} profile={profile} locale={locale} t={t} />
            <ul className="mt-2 space-y-1.5">
              {of("geography").filter((c) => c.method === "structured_data" || c.method === "model_extraction").slice(0, 3).map((c) => (
                <ClaimLine key={c.id} claim={c} profile={profile} t={t} quote={false} />
              ))}
            </ul>
          </Block>
        )}
        {of("business_model").length > 0 && (
          <Block title={t("analysis.businessModel")}>
            <ConceptChips claims={of("business_model")} profile={profile} locale={locale} t={t} />
          </Block>
        )}
        {strategy.length > 0 && (
          <Block title={t("analysis.strategy")}>
            <ul className="space-y-1.5">
              {strategy.map((c) => (
                <ClaimLine key={c.id} claim={c} profile={profile} t={t} />
              ))}
            </ul>
          </Block>
        )}
        {needs.length > 0 && (
          <Block title={t("analysis.needs")}>
            <ul className="space-y-1.5">
              {needs.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-[13.5px]">
                  <Epi kind={c.epistemic} t={t} />
                  <span className="text-fg">
                    {isOpennessSignal(c) ? t("analysis.opennessSignal") : c.statement} — <q className="text-fg-muted">{c.excerpt}</q> <SourceRef claim={c} profile={profile} />
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>
    </Card>
  );
}

const CHECK_TONE: Record<Check["result"], string> = { pass: "text-positive", warn: "text-caution", fail: "text-critical", info: "text-fg-faint" };
const CHECK_MARK: Record<Check["result"], string> = { pass: "✓", warn: "!", fail: "✕", info: "–" };
const CONF_TONE: Record<EvaluatedCandidate["confidence"], BadgeTone> = { strong: "positive", moderate: "brand", limited: "neutral" };

function OpportunityCard({ c, profile, own, locale, open, testId }: { c: EvaluatedCandidate; profile: TargetProfile; own: string; locale: Locale; open?: boolean; testId: string }) {
  const t = createTranslator(locale);
  const vars = candidateVars(c, profile.name, own, locale);
  const r = c.rule;
  const title = c.narrative?.title ?? (r ? t(`analysis.rules.${r}.title`, vars) : "");
  const why = c.narrative?.mechanism ?? (r ? t(`analysis.rules.${r}.why`, vars) : "");
  const assumptions = c.narrative ? c.narrative.assumptions : r ? [t(`analysis.rules.${r}.assumption`, vars)] : [];
  const questions = c.narrative ? c.narrative.questions : c.validation.map((k) => t(`analysis.validation.${k}`, vars));
  const next = c.narrative?.nextStep ?? (r ? t(`analysis.rules.${r}.next`, vars) : "");
  const support = profile.claims.filter((x) => c.targetClaimIds.includes(x.id)).slice(0, 3);
  const whyNow = profile.claims.filter((x) => c.whyNowClaimIds.includes(x.id));
  return (
    <details open={open} className="group rounded-xl border border-edge bg-surface shadow-card" data-testid={testId} data-verdict={c.verdict}>
      <summary className={cx("flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-5 py-4", focusRing)}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{t(`analysis.relationships.${c.relationship}`)}</Badge>
            <Badge tone={CONF_TONE[c.confidence]}>
              {t("analysis.confidence.label")}: {t(`analysis.confidence.${c.confidence}`)}
            </Badge>
            <span className="text-[11.5px] text-fg-faint">{t(`analysis.origin.${c.origin}`)}</span>
          </div>
          <h3 className="mt-2 text-[15px] font-semibold text-fg">{title}</h3>
        </div>
        <Icon name="arrow" size={14} className="mt-2 shrink-0 text-fg-faint transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-4 border-t border-edge px-5 py-4 text-[13.5px]">
        <Section2 title={t("analysis.whyItMakesSense")}>
          <p className="text-fg">{why}</p>
          <p className="mt-1">
            <Epi kind={c.origin === "model" ? "assumption" : "inference"} t={t} />
          </p>
        </Section2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Section2 title={t("analysis.ownBrings", { own })}>
            {c.narrative && <p className="mb-1.5 text-fg">{c.narrative.ownBrings}</p>}
            <ul className="space-y-1 text-fg-muted">
              {c.ownBrings.slice(0, 4).map((f, i) => (
                <li key={i}>
                  <span className="text-fg-faint">{t(`company.fields.${f.field}`)}:</span> {f.value}
                </li>
              ))}
            </ul>
          </Section2>
          <Section2 title={t("analysis.targetBrings", { target: profile.name })}>
            {c.narrative && <p className="mb-1.5 text-fg">{c.narrative.targetBrings}</p>}
            <ul className="space-y-1.5">
              {support.map((x) => (
                <ClaimLine key={x.id} claim={x} profile={profile} t={t} />
              ))}
            </ul>
          </Section2>
        </div>
        <Section2 title={t("analysis.whyNow")}>
          {whyNow.length > 0 ? (
            <ul className="space-y-1.5">
              {whyNow.map((x) => (
                <ClaimLine key={x.id} claim={x} profile={profile} t={t} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-fg-muted">
              <Epi kind="unknown" t={t} /> {t("analysis.whyNowUnknown")}
            </p>
          )}
        </Section2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Section2 title={t("analysis.assumptions")}>
            <ul className="space-y-1">
              {assumptions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-fg-muted">
                  <Epi kind="assumption" t={t} /> <span>{a}</span>
                </li>
              ))}
            </ul>
          </Section2>
          <Section2 title={t("analysis.questions")}>
            <ul className="list-disc space-y-1 pl-4 text-fg-muted">
              {questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </Section2>
        </div>
        <div className="rounded-lg bg-brand-soft/60 px-4 py-3">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-brand">{t("analysis.nextStep")}</div>
          <p className="mt-0.5 text-fg">{next}</p>
        </div>
        <Section2 title={t("analysis.critic")}>
          <ul className="grid gap-1 sm:grid-cols-2">
            {c.checks.map((k) => (
              <li key={k.id} className="flex items-start gap-2 text-[12.5px]">
                <span className={cx("w-3 shrink-0 text-center font-bold", CHECK_TONE[k.result])} aria-label={k.result}>
                  {CHECK_MARK[k.result]}
                </span>
                <span className="text-fg-muted">
                  <span className="font-medium text-fg">{t(`analysis.checks.${k.id}.title` as MessageKey, { target: profile.name })}</span> — {t(`analysis.checks.${k.id}.${k.code}` as MessageKey)}
                </span>
              </li>
            ))}
          </ul>
        </Section2>
      </div>
    </details>
  );
}

function Section2({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-fg-faint">{title}</h4>
      {children}
    </div>
  );
}

export function RelevanceSection({ analysis, profile, own, locale, canEditProfile }: { analysis: RelevanceAnalysis; profile: TargetProfile; own: string | null; locale: Locale; canEditProfile: boolean }) {
  const t = createTranslator(locale);
  const ownName = own ?? "";
  return (
    <section className="space-y-3" data-testid="analysis-relevance" data-status={analysis.status}>
      <h2 className="text-[17px] font-semibold tracking-tight text-fg">{own ? t("analysis.whyMatters", { target: profile.name, own }) : t("analysis.whyMattersNoOwn")}</h2>
      {analysis.status === "own_profile_missing" ? (
        <Card className="p-5">
          <h3 className="text-[14.5px] font-semibold text-fg">{t("analysis.ownMissing")}</h3>
          <p className="mt-1 text-[13.5px] text-fg-muted">{t("analysis.ownMissingBody")}</p>
          {canEditProfile && (
            <ButtonLink href="/workspace/company" size="sm" variant="primary" className="mt-3">
              {t("analysis.completeProfile")}
            </ButtonLink>
          )}
        </Card>
      ) : (
        <>
          {analysis.opportunities.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[13px] font-semibold text-fg">{t("analysis.opportunities")}</h3>
              {analysis.opportunities.map((c, i) => (
                <OpportunityCard key={c.id} c={c} profile={profile} own={ownName} locale={locale} open={i === 0} testId="opportunity" />
              ))}
            </div>
          )}
          {analysis.status === "none" && (
            <Card className="p-5" data-testid="no-opportunity">
              <h3 className="text-[14.5px] font-semibold text-fg">{t("analysis.none")}</h3>
              <p className="mt-1 text-[13.5px] text-fg-muted">{t("analysis.noneBody", { target: profile.name, own: ownName })}</p>
            </Card>
          )}
          {analysis.hypotheses.length > 0 && (
            <div className="space-y-3">
              <div>
                <h3 className="text-[13px] font-semibold text-fg">{t("analysis.hypotheses")}</h3>
                <p className="text-[12.5px] text-fg-muted">{t("analysis.hypothesesBody")}</p>
              </div>
              {analysis.hypotheses.map((c) => (
                <OpportunityCard key={c.id} c={c} profile={profile} own={ownName} locale={locale} testId="hypothesis" />
              ))}
            </div>
          )}
          {analysis.observations.length > 0 && (
            <div className="space-y-3" data-testid="observations">
              <div>
                <h3 className="text-[13px] font-semibold text-fg">{t("analysis.observations")}</h3>
                <p className="text-[12.5px] text-fg-muted">{t("analysis.observationsBody")}</p>
              </div>
              {analysis.observations.map((c) => (
                <OpportunityCard key={c.id} c={c} profile={profile} own={ownName} locale={locale} testId="observation" />
              ))}
            </div>
          )}
          {analysis.insights.map((ins) => (
            <p key={ins.code} className="rounded-lg border border-edge bg-subtle px-4 py-3 text-[13px] text-fg-muted">
              <Epi kind="inference" t={t} /> {t("analysis.possibleCompetitor", { target: profile.name, drivers: driversText(ins.drivers, locale) })}
            </p>
          ))}
          {analysis.rejected.length > 0 && <RejectedList rejected={analysis.rejected} profile={profile} own={ownName} locale={locale} />}
        </>
      )}
    </section>
  );
}

function RejectedList({ rejected, profile, own, locale }: { rejected: EvaluatedCandidate[]; profile: TargetProfile; own: string; locale: Locale }) {
  const t = createTranslator(locale);
  const titleOf = (c: Candidate) => c.narrative?.title ?? (c.rule ? t(`analysis.rules.${c.rule}.title`, candidateVars(c, profile.name, own, locale)) : "");
  return (
    <details className="rounded-xl border border-dashed border-edge-strong px-5 py-3" data-testid="rejected">
      <summary className={cx("cursor-pointer text-[13px] font-medium text-fg-muted", focusRing)}>{t("analysis.rejected", { n: rejected.length })}</summary>
      <p className="mt-2 text-[12.5px] text-fg-faint">{t("analysis.rejectedBody")}</p>
      <ul className="mt-2 space-y-2">
        {rejected.map((c) => (
          <li key={c.id} className="text-[13px]">
            <span className="text-fg line-through decoration-fg-faint">{titleOf(c)}</span>
            <span className="block text-[12.5px] text-critical">
              {c.checks
                .filter((k) => k.result === "fail")
                .map((k) => t(`analysis.checks.${k.id}.${k.code}` as MessageKey))
                .join(" ")}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function UnknownsCard({ analysis, locale, canEditProfile }: { analysis: RelevanceAnalysis; locale: Locale; canEditProfile: boolean }) {
  const t = createTranslator(locale);
  if (analysis.targetUnknowns.length === 0 && analysis.ownGaps.length === 0) return null;
  return (
    <Card className="p-5" data-testid="analysis-unknowns">
      <h2 className="text-[15px] font-semibold text-fg">{t("analysis.unknownsTitle")}</h2>
      <p className="mt-0.5 text-[13px] text-fg-muted">{t("analysis.unknownsBody")}</p>
      {analysis.targetUnknowns.length > 0 && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {analysis.targetUnknowns.map((u) => (
            <li key={u} className="flex items-center gap-2 text-[13.5px] text-fg">
              <Epi kind="unknown" t={t} /> {t(`analysis.unknownFields.${u}`)}
            </li>
          ))}
        </ul>
      )}
      {analysis.ownGaps.length > 0 && analysis.status !== "own_profile_missing" && (
        <div className="mt-4 border-t border-edge pt-4">
          <h3 className="text-[13px] font-semibold text-fg">{t("analysis.ownGapsTitle")}</h3>
          <ul className="mt-1.5 space-y-1 text-[13px] text-fg-muted">
            {analysis.ownGaps.map((g) => (
              <li key={g}>• {t(`analysis.ownGaps.${g}`)}</li>
            ))}
          </ul>
          {canEditProfile && (
            <Link href="/workspace/company" className={cx("mt-2 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
              {t("analysis.completeProfile")} →
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

export function EvidenceCard({ profile, locale, deep }: { profile: TargetProfile; locale: Locale; deep: boolean }) {
  const t = createTranslator(locale);
  const facts = profile.claims.filter((c) => c.epistemic === "fact").length;
  const inferences = profile.claims.filter((c) => c.epistemic === "inference").length;
  return (
    <details className="rounded-xl border border-edge bg-surface shadow-card" data-testid="analysis-evidence">
      <summary className={cx("cursor-pointer list-none px-5 py-4", focusRing)}>
        <h2 className="text-[15px] font-semibold text-fg">{t("analysis.evidenceTitle")}</h2>
        <p className="mt-0.5 text-[13px] text-fg-muted">{t("analysis.evidenceBody", { facts, inferences, sources: profile.sources.length })}</p>
      </summary>
      <div className="space-y-4 border-t border-edge px-5 py-4">
        <ol className="space-y-2">
          {profile.sources.map((s, i) => (
            <li key={s.key} id={`source-${i + 1}`} className="flex items-start gap-3 text-[13px]">
              <span className="w-6 shrink-0 text-right font-medium text-fg-faint tabular-nums">[{i + 1}]</span>
              <div className="min-w-0">
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className={cx("block truncate rounded font-medium text-brand hover:underline", focusRing)}>
                  {s.title || s.url}
                </a>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-faint">
                  <Badge tone={s.authority === "official" ? "positive" : "outline"}>{t(`analysis.authority.${s.authority}`)}</Badge>
                  <span className="truncate">{s.url}</span>
                  <span>· {t("analysis.retrieved", { date: formatDate(s.retrievedAt, locale) })}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="rounded-lg bg-subtle px-4 py-3 text-[12.5px] text-fg-muted">
          <span className="font-semibold text-fg">{t("analysis.methodNote")}. </span>
          {deep ? t("analysis.methodBodyDeep") : t("analysis.methodBody", { target: profile.name })}
        </p>
      </div>
    </details>
  );
}
