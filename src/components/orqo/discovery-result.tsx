import Link from "next/link";
import type { DiscoveredCompany, DiscoveryResult } from "@/lib/agents/contracts";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type Translator } from "@/lib/i18n/translate";
import { driversText } from "@/lib/intelligence/wording";
import { formatDay } from "./analysis";
import { AddDiscoveredButton } from "./discover-form";
import { Icon } from "./icons";
import { Badge, cx, focusRing, type BadgeTone } from "./ui";

const PRIORITY_TONE: Record<DiscoveredCompany["priority"], BadgeTone> = { high: "positive", worth_investigating: "brand", weak: "caution" };
const linkClass = cx("rounded text-brand hover:underline", focusRing);

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{children}</div>;
}

function ruleVars(c: DiscoveredCompany, own: string, locale: Locale): Record<string, string> {
  const m = c.mechanism;
  return {
    target: c.name,
    own,
    drivers: driversText(m.drivers.filter((d) => !m.ownServices.includes(d)), locale) || "—",
    services: driversText(m.ownServices, locale) || "—",
    geos: m.geographies.slice(0, 4).join(", ") || "—",
  };
}

/** The decisive validation question, worded in the VIEWER's language from the stored key (the stored text is the run's language). */
function nextQuestionText(c: DiscoveredCompany, t: Translator, own: string, locale: Locale): string | null {
  if (c.nextQuestion === null) return null;
  const key = c.mechanism.validation[0];
  return key ? t(`analysis.validation.${key}`, ruleVars(c, own, locale)) : c.nextQuestion;
}

function CompanyCard({ c, t, locale, own, organizationId, runId, canAdd }: { c: DiscoveredCompany; t: Translator; locale: Locale; own: string; organizationId: string; runId: string; canAdd: boolean }) {
  const vars = ruleVars(c, own, locale);
  const question = nextQuestionText(c, t, own, locale);
  const d = c.dimensions;
  const dims = [
    t(`discover.result.dims.${d.mechanism}`),
    t(`discover.result.dims.${d.evidence}`),
    t(`discover.result.dims.${d.alignment}`),
    t(`discover.result.dims.${d.timing}`),
    t("discover.result.dims.openQuestions", { n: d.openQuestions }),
    ...(d.competitorRisk ? [t("discover.result.dims.competitorRisk")] : []),
  ];
  return (
    <article className="rounded-xl border border-edge bg-surface p-5 shadow-card" data-testid="discovered-company" data-domain={c.domain} data-priority={c.priority}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold text-fg">{c.name}</h3>
          <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className={cx("text-[13px]", linkClass)}>
            {c.domain}
          </a>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
            {c.network ? (
              <Badge tone="neutral" icon="network">
                <span data-testid="in-network">{t("discover.result.inNetwork", { date: formatDay(c.network.addedAt, locale) })}</span>
              </Badge>
            ) : null}
            <Badge tone="outline" icon="clock">
              {c.research.reused ? t("discover.result.analysisReused", { date: formatDay(c.research.researchedAt, locale) }) : t("discover.result.analysisNew", { date: formatDay(c.research.researchedAt, locale) })}
            </Badge>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge tone={PRIORITY_TONE[c.priority]}>{t(`discover.result.priority.${c.priority}`)}</Badge>
          {canAdd && !c.network && <AddDiscoveredButton locale={locale} organizationId={organizationId} runId={runId} domain={c.domain} />}
        </div>
      </header>

      <div className="mt-4 grid gap-4 text-[13.5px] md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <Label>{t("discover.result.why")}</Label>
            <p className="mt-1 text-fg-muted">{c.source === "web_search" ? t("discover.result.fromWeb") : t("discover.result.fromWorkspace")}</p>
            {c.hints.map((h, i) => (
              <p key={i} className="mt-1 text-[12.5px] text-fg-faint">
                <span className="font-medium">{t("discover.result.hint")}:</span> “{h}”
              </p>
            ))}
          </div>
          <div>
            <Label>{t("discover.result.opportunity")}</Label>
            <p className="mt-1 font-medium text-fg">{t(`analysis.rules.${c.mechanism.rule}.title`, vars)}</p>
            <p className="mt-1 text-fg-muted">{t(`analysis.rules.${c.mechanism.rule}.why`, vars)}</p>
            <p className="mt-1 text-[12.5px] text-fg-faint">
              {t(`analysis.relationships.${c.mechanism.relationship}`)} · {t("analysis.confidence.label")}: {t(`analysis.confidence.${c.mechanism.confidence}`)}
            </p>
          </div>
          {c.mechanism.ownBrings.length > 0 && (
            <div>
              <Label>{t("discover.result.youBring")}</Label>
              <p className="mt-1 text-fg-muted">{c.mechanism.ownBrings.join(" · ")}</p>
            </div>
          )}
          <div>
            <Label>{t("discover.result.theyShow")}</Label>
            <ul className="mt-1 space-y-1.5" data-testid="discover-evidence">
              {c.evidence.map((e, i) => (
                <li key={i} className="text-fg-muted">
                  <Badge tone={e.epistemic === "fact" ? "positive" : "neutral"} className="mr-1.5 align-middle">
                    {e.epistemic === "fact" ? t("discover.result.fact") : t("discover.result.inference")}
                  </Badge>
                  “{e.text}”{" "}
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className={cx("text-[12px]", linkClass)}>
                      {e.source ?? e.url}
                    </a>
                  ) : null}
                  {e.selfDescribed && <span className="ml-1 text-[11.5px] text-fg-faint">({t("discover.result.statedByCompany")})</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <Label>{t("discover.result.whyNow")}</Label>
            {c.whyNow.length > 0 ? (
              <ul className="mt-1 space-y-1 text-fg-muted" data-testid="why-now">
                {c.whyNow.map((e, i) => (
                  <li key={i}>
                    “{e.text}”{" "}
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className={cx("text-[12px]", linkClass)}>
                        {e.source ?? e.url}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-fg-faint" data-testid="why-now-unknown">
                {t("discover.result.whyNowUnknown")}
              </p>
            )}
          </div>
          <div>
            <Label>{t("discover.result.assumption")}</Label>
            <p className="mt-1 text-fg-muted">{t(`analysis.rules.${c.mechanism.rule}.assumption`, vars)}</p>
          </div>
          <div>
            <Label>{t("discover.result.doesNotKnow")}</Label>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-fg-muted">
              {c.mechanism.validation.slice(0, 3).map((k) => (
                <li key={k}>{t(`analysis.validation.${k}`, vars)}</li>
              ))}
              {c.unknowns.slice(0, 3).map((u) => (
                <li key={u}>{t(`analysis.unknownFields.${u}`)}</li>
              ))}
            </ul>
          </div>
          {question && (
            <div>
              <Label>{t("discover.result.nextValidation")}</Label>
              <p className="mt-1 font-medium text-fg">{question}</p>
            </div>
          )}
          <div>
            <Label>{t("discover.result.priorityWhy")}</Label>
            <p className="mt-1 text-[12.5px] text-fg-muted" data-testid="priority-dimensions">
              {dims.join(" · ")}
            </p>
          </div>
          <Link href={`/workspace?q=${encodeURIComponent(c.domain)}`} className={cx("inline-block text-[13px] font-medium", linkClass)}>
            {t("discover.result.openAnalysis")} →
          </Link>
        </div>
      </div>
    </article>
  );
}

/** Localized view of a validated discovery result. Presentation only: everything shown comes from the stored, contract-checked result. */
export function DiscoveryResultView({ result: r, locale, ownName, organizationId, runId, canAdd }: { result: DiscoveryResult; locale: Locale; ownName: string; organizationId: string; runId: string; canAdd: boolean }) {
  const t = createTranslator(locale);
  const p = r.plan;
  const list = (items: string[]) => (items.length > 0 ? items.join(" · ") : "—");
  const fieldText = (f: string) => t(`analysis.ownGaps.${f as "offerings"}`);
  const next = r.nextAction;
  const top = next?.kind === "investigate" ? r.companies.find((c) => c.domain === next.domain) : undefined;
  const topQuestion = top ? nextQuestionText(top, t, ownName, locale) : next?.kind === "investigate" ? next.question : null;
  return (
    <div className="space-y-5" data-testid="discovery-result" data-status={r.status}>
      <div className="space-y-1 text-[13.5px]">
        <p className="text-fg">
          <span className="font-semibold">{t("discover.result.objective")}:</span> {t(`discover.intents.${r.objective.intent}`)}
          {r.objective.text ? ` — “${r.objective.text}”` : ""}
          {r.objective.market ? ` · ${r.objective.market}` : ""}
          {r.objective.geography ? ` · ${r.objective.geography}` : ""}
        </p>
        <p className="text-fg-muted" data-testid="discover-source">
          {r.source.id === "web_search" ? t("discover.result.sourceWeb", { provider: r.source.provider ?? "—" }) : t("discover.result.sourceWorkspace")}
        </p>
        <p className="text-[12.5px] text-fg-faint tabular-nums" data-testid="discover-funnel">
          {t("discover.result.funnel", r.funnel)}
        </p>
        {r.partialReason && (
          <p className="text-[12.5px] text-caution" data-testid="discover-partial">
            {t(`discover.result.partial.${r.partialReason}`)}
          </p>
        )}
      </div>

      <details className="rounded-xl border border-edge bg-subtle/40 px-4 py-3 text-[13px]" data-testid="discovery-plan">
        <summary className={cx("cursor-pointer font-semibold text-fg", focusRing)}>{t("discover.result.planTitle")}</summary>
        <p className="mt-1 text-[12.5px] text-fg-faint">{t("discover.result.planBody")}</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-fg-faint">{t("discover.result.mechanisms")}</dt>
            <dd className="text-fg">{list(p.mechanisms.map((m) => t(`discover.mechanisms.${m}`)))}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">{t("discover.result.characteristics")}</dt>
            <dd className="text-fg">{list(p.characteristics.map((c) => t(`discover.characteristics.${c}`)))}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">{t("discover.result.concepts")}</dt>
            <dd className="text-fg">{driversText(p.concepts.slice(0, 8), locale) || "—"}</dd>
          </div>
          {r.source.id === "web_search" && (
            <div>
              <dt className="text-fg-faint">{t("discover.result.queries")}</dt>
              <dd className="text-fg">{list(p.queries.map((q) => `“${q}”`))}</dd>
            </div>
          )}
          <div>
            <dt className="text-fg-faint">{t("discover.result.evidenceRequired")}</dt>
            <dd className="text-fg">{list(p.evidenceRequired.map((e) => t(`discover.evidenceRequired.${e}`)))}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">{t("discover.result.exclusions")}</dt>
            <dd className="text-fg">{list(p.exclusions.map((e) => t(`discover.exclusions.${e}`)))}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-fg-faint">{t("discover.result.unknowns")}</dt>
            <dd className="text-fg">{list(p.unknowns.map((k) => t(`analysis.validation.${k}`, { target: t("discover.result.theCompany"), own: ownName, services: t("discover.result.yourServices"), geos: t("discover.result.yourRegions"), drivers: "—" })))}</dd>
          </div>
          {p.unsupported.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-fg-faint">{t("discover.result.unsupported")}</dt>
              <dd className="text-fg">{list(p.unsupported.map((u) => t("discover.result.unsupportedItem", { mechanism: t(`discover.mechanisms.${u.mechanism}`), field: fieldText(u.field) })))}</dd>
            </div>
          )}
        </dl>
      </details>

      {r.status === "plan_infeasible" ? (
        <p className="rounded-lg bg-caution-soft px-4 py-3 text-[13.5px] text-caution">{t("discover.result.planInfeasible")}</p>
      ) : r.status === "no_candidates" ? (
        <p className="rounded-lg bg-subtle px-4 py-3 text-[13.5px] text-fg-muted">{t("discover.result.noCandidates")}</p>
      ) : r.companies.length === 0 ? (
        <p className="rounded-lg bg-subtle px-4 py-3 text-[13.5px] text-fg-muted" data-testid="discover-empty">
          {t("discover.result.empty")}
        </p>
      ) : (
        <section className="space-y-3">
          <h3 className="text-[15px] font-semibold text-fg">{t("discover.result.companiesTitle")}</h3>
          {r.companies.map((c) => (
            <CompanyCard key={c.domain} c={c} t={t} locale={locale} own={ownName} organizationId={organizationId} runId={runId} canAdd={canAdd} />
          ))}
        </section>
      )}

      <section className="rounded-xl border border-brand/30 bg-brand-soft/40 px-5 py-4" data-testid="discover-next-action">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          <Icon name="arrow" size={14} />
          {t("discover.result.nextTitle")}
        </h3>
        <p className="mt-1 text-[13.5px] text-fg">
          {!r.nextAction
            ? t("discover.result.observeNoAction")
            : r.nextAction.kind === "investigate"
              ? topQuestion
                ? t("discover.result.next.investigate", { name: r.nextAction.name, question: topQuestion })
                : t("discover.result.next.investigateShort", { name: r.nextAction.name })
              : r.nextAction.kind === "complete_profile"
                ? t("discover.result.next.complete_profile", { fields: r.nextAction.fields.map(fieldText).join(" ") })
                : t(`discover.result.next.${r.nextAction.kind}`)}
        </p>
        {r.nextAction?.kind === "complete_profile" && (
          <Link href="/workspace/company" className={cx("mt-1 inline-block text-[13px] font-medium", linkClass)}>
            {t("analysis.completeProfile")} →
          </Link>
        )}
      </section>

      {r.rejected.length > 0 && (
        <details className="rounded-xl border border-edge px-4 py-3 text-[13px]" data-testid="discover-rejected">
          <summary className={cx("cursor-pointer font-semibold text-fg", focusRing)}>{t("discover.result.rejectedTitle", { n: r.funnel.rejected })}</summary>
          <p className="mt-1 text-[12.5px] text-fg-faint">{t("discover.result.rejectedBody")}</p>
          <ul className="mt-2 space-y-1">
            {r.rejected.map((x) => (
              <li key={`${x.stage}-${x.domain}`} className="text-fg-muted" data-reason={x.reason}>
                <span className="text-fg">{x.name}</span> <span className="text-fg-faint">({x.domain})</span> — {t(`discover.rejections.${x.reason}`)}
                {x.previous && <span className="text-fg-faint"> · {t("discover.result.previous", { reason: t(`discover.rejections.${x.previous.reason}`), date: formatDay(x.previous.at, locale) })}</span>}
                {x.inNetwork && <span className="ml-1 text-[11.5px] text-fg-faint">· {t("discover.result.inNetworkShort")}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {r.unverified.length > 0 && (
        <details className="rounded-xl border border-edge px-4 py-3 text-[13px]" data-testid="discover-unverified">
          <summary className={cx("cursor-pointer font-semibold text-fg", focusRing)}>{t("discover.result.unverifiedTitle", { n: r.funnel.unverified })}</summary>
          <p className="mt-1 text-[12.5px] text-fg-faint">{t("discover.result.unverifiedBody")}</p>
          <ul className="mt-2 space-y-1">
            {r.unverified.map((x) => (
              <li key={x.domain} className="text-fg-muted">
                <span className="text-fg">{x.name}</span> <span className="text-fg-faint">({x.domain})</span> — {t(`discover.unverifiedReasons.${x.reason}`)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Short label for a discovery run in history lists. */
export function discoveryRunLabel(t: Translator, input: Record<string, unknown>): string {
  const intent = typeof input.intent === "string" && ["profile", "customers", "suppliers", "technology_partners", "channels", "market_entry"].includes(input.intent) ? t(`discover.intents.${input.intent as "profile"}`) : t("discover.intents.profile");
  return typeof input.objective === "string" ? `${intent} — ${input.objective}` : intent;
}

