/**
 * Company Intelligence 2.0 view (Phase 15): the commercial dossier on a target
 * company, personalized for the user's company. Server component, read-only:
 * every sentence is rendered from structured parts and labels; scenarios,
 * critic findings and revenue hypotheses come from the deterministic engine.
 * Used on the Search result and, fully expanded, in the Deal Intelligence Report.
 */
import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import type { Dossier, Investigation, QuestionRef } from "@/lib/understanding/dossier";
import type { CriticFinding, Scenario, Side, SupportItem } from "@/lib/understanding/scenarios";
import { MarketModelCard } from "./understanding";
import { Badge, Card, CardHeader, cx, focusRing } from "./ui";

type T = ReturnType<typeof createTranslator>;

const isDim = (facet: string) => ["offering_form", "customer_scope", "revenue_model", "sales_motion", "regulation", "value_chain_role"].includes(facet);

function list(t: T, items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${t("dossier.and")} ${items[items.length - 1]}`;
}

function names(d: Dossier, s: Scenario) {
  const n = (side: Side) => (side === "own" ? d.ownName : d.targetName);
  return { provider: n(s.provider), partner: n(s.partner) };
}

export function scenarioTitle(t: T, d: Dossier, s: Scenario): string {
  return t(`dossier.mechanisms.${s.mechanism}.title` as MessageKey, names(d, s));
}

export function questionText(t: T, d: Dossier, q: QuestionRef): string {
  return t(`dossier.questions.${q.key}` as MessageKey, { about: q.about === "own" ? d.ownName : d.targetName, own: d.ownName });
}

function findingText(t: T, d: Dossier, f: CriticFinding): string {
  return t(`dossier.critic.${f.code}` as MessageKey, { name: f.side === "own" ? d.ownName : f.side === "target" ? d.targetName : "" });
}

function investigationText(t: T, d: Dossier, n: Investigation): string {
  switch (n.kind) {
    case "read_own_company":
      return t("dossier.next.read_own_company");
    case "learn_target":
      return t("dossier.next.learn_target", { target: d.targetName, list: n.dimensions.map((x) => t(`understanding.facets.${x}`).toLowerCase()).join(", ") });
    case "no_business_now":
      return t("dossier.next.no_business_now");
    case "verify": {
      const s = [...d.scenarios, ...d.novel].find((x) => x.key === n.scenario);
      const f = s?.critic.find((x) => x.code === n.finding);
      return t("dossier.next.verify", { finding: f ? findingText(t, d, f) : "" });
    }
    case "ask":
      return questionText(t, d, n.question);
  }
}

function Support({ item, t }: { item: SupportItem; t: T }) {
  const label = isDim(item.facet) ? t(`understanding.values.${item.facet}.${item.value}` as MessageKey) : item.value;
  const state = item.origin === "user" ? t("understanding.states.stated") : t(`understanding.states.${item.state}`);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1 text-[13.5px] text-fg" data-testid="scenario-support" data-state={item.state}>
      <Badge tone={item.state === "fact" ? "brand" : "neutral"}>{state}</Badge>
      <span className="min-w-0 break-words">{label.length > 220 ? label.slice(0, 217) + "…" : label}</span>
      {item.sourceUrl && (
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[12.5px] text-brand underline-offset-2 hover:underline">
          {t("understanding.actions.source")}
        </a>
      )}
    </li>
  );
}

function ScenarioCard({ d, s, t, open }: { d: Dossier; s: Scenario; t: T; open: boolean }) {
  const n = names(d, s);
  const m = (k: string) => t(`dossier.mechanisms.${s.mechanism}.${k}` as MessageKey, n);
  const label = s.novelty === "new_offering" ? t("dossier.labels.novel") : s.state === "inference" ? t("dossier.labels.evidenced") : t("dossier.labels.hypothesis");
  const findings = [...s.critic].sort((a, b) => ["kill", "major", "minor"].indexOf(a.severity) - ["kill", "major", "minor"].indexOf(b.severity));
  return (
    <details open={open} className="group rounded-xl border border-edge bg-surface shadow-card" data-testid="scenario" data-mechanism={s.mechanism} data-verdict={s.verdict} data-novelty={s.novelty}>
      <summary className={cx("cursor-pointer list-none rounded-xl px-5 py-4", focusRing)}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={s.novelty === "new_offering" ? "caution" : s.state === "inference" ? "positive" : "outline"}>{label}</Badge>
          <Badge tone={s.verdict === "credible" ? "brand" : "caution"}>{t(`dossier.labels.${s.verdict === "credible" ? "credible" : "weak"}`)}</Badge>
        </div>
        <h3 className="mt-2 text-[16px] font-semibold text-fg">{scenarioTitle(t, d, s)}</h3>
        <p className="mt-1 text-[13.5px] text-fg-muted">{m("joint")}</p>
      </summary>
      <div className="space-y-5 border-t border-edge px-5 py-4 text-[13.5px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {([["provider", s.contributions.provider, n.provider], ["partner", s.contributions.partner, n.partner]] as const).map(([role, c, name]) => (
            <div key={role}>
              <h4 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.brings", { name })}</h4>
              <p className="mt-1 text-fg">{m(role)}</p>
              <ul className="mt-1">
                {c.support.slice(0, 4).map((x) => (
                  <Support key={x.key} item={x} t={t} />
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div>
          <h4 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.whyWork")}</h4>
          <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-[150px_1fr]">
            <dt className="text-fg-muted">{t("understanding.market.relations.customer")}</dt>
            <dd className="text-fg">{m("beneficiary")}</dd>
            <dt className="text-fg-muted">{t("understanding.facets.problems_solved")}</dt>
            <dd className="text-fg">
              {m("problem")} <Badge tone="outline">{t("dossier.labels.hypothesis")}</Badge>
            </dd>
            <dt className="text-fg-muted">{n.provider}</dt>
            <dd className="text-fg">{m("valueProvider")}</dd>
            <dt className="text-fg-muted">{n.partner}</dt>
            <dd className="text-fg">{m("valuePartner")}</dd>
          </dl>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("dossier.dimensionsTitle")}>
            {(Object.keys(s.dimensions) as (keyof Scenario["dimensions"])[]).map((k) => (
              <li key={k}>
                <Badge tone="outline">{t(`dossier.dimensions.${k}.${s.dimensions[k]}` as MessageKey)}</Badge>
              </li>
            ))}
          </ul>
        </div>
        <div data-testid="scenario-critic">
          <h4 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.whyFail")}</h4>
          {findings.length === 0 ? (
            <p className="mt-1 text-fg-muted">{t("dossier.noFindings")}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {findings.map((f) => (
                <li key={f.code} className="flex flex-wrap items-baseline gap-2" data-severity={f.severity}>
                  <Badge tone={f.severity === "minor" ? "neutral" : "critical"}>{t(`dossier.severity.${f.severity}`)}</Badge>
                  <span className="text-fg">{findingText(t, d, f)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.whyNow")}</h4>
          {s.whyNow.length === 0 ? (
            <p className="mt-1 text-fg-muted">{t("dossier.whyNowUnknown")}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {s.whyNow.map((w) => (
                <li key={w.key} className="text-fg">
                  <Badge tone="brand">{t(`dossier.signals.${w.signal}` as MessageKey)}</Badge> <q>{w.statement}</q>{" "}
                  {w.sourceUrl && (
                    <a href={w.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[12.5px] text-brand underline-offset-2 hover:underline">
                      {t("understanding.actions.source")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg bg-subtle px-4 py-3" data-testid="revenue-hypothesis">
          <h4 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.revenueTitle")}</h4>
          <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-[150px_1fr]">
            <dt className="text-fg-muted">{t("dossier.revenueWho")}</dt>
            <dd className="text-fg">{t(`dossier.payers.${s.revenue.payer}`, n)}</dd>
            <dt className="text-fg-muted">{t("dossier.revenueFor")}</dt>
            <dd className="text-fg">{m("paysFor")}</dd>
            <dt className="text-fg-muted">{t("dossier.revenueHow")}</dt>
            <dd className="text-fg">{t(`dossier.structures.${s.revenue.structure}`)}</dd>
          </dl>
          <p className="mt-2 text-[12.5px] text-fg-muted">{t("dossier.revenueNote")}</p>
        </div>
        <div>
          <h4 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.toValidate")}</h4>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-fg">
            {s.questions.map((key) => (
              <li key={key}>{questionText(t, d, { key, scenario: s.key, about: s.partner, resolve: "ask" })}</li>
            ))}
          </ol>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.experiment")}</h4>
            <p className="mt-1 text-fg">{m("experiment")}</p>
          </div>
          <div>
            <h4 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.path")}</h4>
            <p className="mt-1 text-fg">{t("dossier.pathSteps", { structure: t(`dossier.structures.${s.revenue.structure}`) })}</p>
          </div>
        </div>
      </div>
    </details>
  );
}

export function DossierView({ dossier: d, locale, reportHref, expanded = false }: { dossier: Dossier; locale: Locale; reportHref: string | null; expanded?: boolean }) {
  const t = createTranslator(locale);
  const e = d.executive;
  const lower = (k: string) => t(k as MessageKey).toLowerCase();
  const roles = e.roles.map((r) => lower(`understanding.values.value_chain_role.${r}`));
  const forms = e.forms.map((f) => lower(`understanding.values.offering_form.${f}`));
  const scopes = e.scopes.map((s) => lower(`understanding.values.customer_scope.${s}`));
  const lead = d.scenarios[0] ?? d.novel[0] ?? null;

  return (
    <section className="space-y-4" data-testid="dossier" data-status={d.status}>
      <Card data-testid="dossier-executive">
        <CardHeader
          title={t("dossier.executiveTitle")}
          action={
            reportHref && (
              <Link href={reportHref} className={cx("text-[13px] font-medium text-brand hover:underline print:hidden", focusRing)} data-testid="dossier-report">
                {t("dossier.reportLink")} →
              </Link>
            )
          }
        />
        <div className="space-y-2 px-5 py-4 text-[14.5px] leading-relaxed text-fg">
          <p>{forms.length ? t(scopes.length ? "dossier.identity" : "dossier.identityNoScope", { target: d.targetName, roles: list(t, roles), forms: list(t, forms), scopes: list(t, scopes) }) : t("dossier.identityUnknown", { target: d.targetName })}</p>
          {e.routes.length > 0 && <p>{t("dossier.routes", { routes: list(t, e.routes.map((r) => lower(`understanding.market.entries.route.${r}`))) })}</p>}
          {d.status === "ready" ? (
            <p className="font-medium">{lead ? t(lead.novelty === "new_offering" ? "dossier.leadNovel" : "dossier.lead", { own: d.ownName, title: scenarioTitle(t, d, lead) }) : t("dossier.noLead", { own: d.ownName, target: d.targetName })}</p>
          ) : (
            <p className="font-medium">{t(`dossier.status.${d.status}`, { target: d.targetName })}</p>
          )}
          <div className="mt-3 rounded-lg border border-brand/30 bg-brand-soft/40 px-4 py-3" data-testid="dossier-next" data-kind={d.next.kind}>
            <p className="text-[12.5px] font-semibold tracking-wide text-brand uppercase">{t("dossier.nextTitle")}</p>
            <p className="mt-1 text-fg">{investigationText(t, d, d.next)}</p>
            {d.status === "own_missing" && (
              <Link href="/workspace/company" className={cx("mt-1 inline-block text-[13px] font-medium text-brand hover:underline print:hidden", focusRing)}>
                {t("dossier.readOwn")} →
              </Link>
            )}
          </div>
        </div>
      </Card>

      {d.status === "ready" && (
        <>
          <div className="space-y-3" data-testid="dossier-scenarios">
            <div>
              <h2 className="text-[17px] font-semibold text-fg">{t("dossier.scenariosTitle")}</h2>
              <p className="text-[13px] text-fg-muted">{t("dossier.scenariosBody")}</p>
            </div>
            {d.scenarios.length === 0 && d.novel.length === 0 && <p className="rounded-xl border border-edge bg-surface px-5 py-4 text-[14px] text-fg-muted">{t("dossier.noScenarios")}</p>}
            {d.scenarios.map((s, i) => (
              <ScenarioCard key={s.key} d={d} s={s} t={t} open={expanded || i === 0} />
            ))}
          </div>

          {d.novel.length > 0 && (
            <div className="space-y-3" data-testid="dossier-novel">
              <div>
                <h2 className="text-[17px] font-semibold text-fg">{t("dossier.novelTitle")}</h2>
                <p className="text-[13px] text-fg-muted">{t("dossier.novelBody")}</p>
              </div>
              {d.novel.map((s) => (
                <ScenarioCard key={s.key} d={d} s={s} t={t} open={expanded} />
              ))}
            </div>
          )}

          <Card>
            <div className="grid gap-5 px-5 py-4 text-[13.5px] sm:grid-cols-2">
              <div data-testid="dossier-needs">
                <h3 className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.needsTitle", { target: d.targetName })}</h3>
                {d.needs.length === 0 ? (
                  <p className="mt-1 text-fg-muted">{t("dossier.needsUnknown")}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {d.needs.map((x) => (
                      <li key={x.mechanism} className="flex flex-wrap items-baseline gap-2 text-fg">
                        <Badge tone={x.state === "inference" ? "positive" : "outline"}>{t(`dossier.needState.${x.state}`)}</Badge>
                        {t(`dossier.mechanisms.${x.mechanism}.problem` as MessageKey)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {d.nextQuestion && (
                <div data-testid="dossier-question">
                  <h3 className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.questionTitle")}</h3>
                  <p className="mt-1 text-[15px] font-medium text-fg">{questionText(t, d, d.nextQuestion)}</p>
                  <p className="mt-1 text-fg-muted">{t(d.nextQuestion.resolve === "ask" ? "dossier.askThem" : "dossier.research", { about: d.nextQuestion.about === "own" ? d.ownName : d.targetName })}</p>
                </div>
              )}
            </div>
          </Card>

          {d.discarded.length > 0 && (
            <details open={expanded} className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-card" data-testid="dossier-discarded">
              <summary className="cursor-pointer text-[14px] font-medium text-fg">{t("dossier.discardedTitle", { count: d.discarded.length })}</summary>
              <p className="mt-1 text-[12.5px] text-fg-muted">{t("dossier.discardedBody")}</p>
              <ul className="mt-2 space-y-2 text-[13.5px]">
                {d.discarded.map((x) => (
                  <li key={`${x.mechanism}:${x.provider}`}>
                    {x.mechanism === "similarity_only" ? (
                      <span className="text-fg">{t("dossier.critic.similarity_only")}</span>
                    ) : (
                      <>
                        <span className="font-medium text-fg">{t(`dossier.mechanisms.${x.mechanism}.title` as MessageKey, { provider: x.provider === "own" ? d.ownName : d.targetName, partner: x.provider === "own" ? d.targetName : d.ownName })}</span>
                        <span className="text-fg-muted"> — {x.findings.map((f) => findingText(t, d, f)).join(" ")}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {d.targetMarket.coverage !== "insufficient" && (
        <details open={expanded} className="group" data-testid="dossier-market">
          <summary className={cx("cursor-pointer rounded-lg px-1 py-2 text-[14px] font-medium text-fg", focusRing)}>{t("dossier.marketTitle", { target: d.targetName })}</summary>
          <div className="mt-2">
            <MarketModelCard market={d.targetMarket} locale={locale} title={t("dossier.marketTitle", { target: d.targetName })} />
          </div>
        </details>
      )}
    </section>
  );
}
