/**
 * Company Intelligence 2.0 view (Phase 15): the commercial dossier on a target
 * company, personalized for the user's company. Server component, read-only:
 * every sentence is rendered from structured parts and labels; scenarios,
 * critic findings and revenue hypotheses come from the deterministic engine.
 * Used on the Search result, the Network company page and, fully expanded, in the Deal Intelligence Report.
 *
 * Phase 16A: the relationship that exists today comes first. "No credible new opportunity" is a confident,
 * explained result. Weak ideas are only "considered", and only credible ones can be tracked (when `actions` is given).
 */
import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import type { Dossier, Investigation, QuestionRef } from "@/lib/understanding/dossier";
import type { CriticFinding, Scenario, Side, SupportItem } from "@/lib/understanding/scenarios";
import { conceptLabel } from "@/lib/intelligence/concepts";
import type { RelationshipAssessment } from "@/lib/understanding/relationship";
import { RelationshipQuestion, TrackButton } from "./opportunity-forms";
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

export function investigationText(t: T, d: Dossier, n: Investigation): string {
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

/** Everything the dossier needs to offer actions (Track, the relationship question). Absent in the report. */
export interface DossierActions {
  organizationId: string;
  /** The remembered company, or null on a Search result for a company not yet in the Network. */
  companyId: string | null;
  /** The Search query, used to remember the company when it is tracked from Search. */
  q: string | null;
  /** Scenario key → tracked opportunity id, for scenarios already tracked. */
  tracked: Record<string, string>;
  canWrite: boolean;
  locale: Locale;
}

/** "Today {target} is a supplier and a partner for {own}" from the known roles. */
export function existingRoles(t: T, roles: RelationshipAssessment["roles"]): string {
  return list(
    t,
    roles.map((r) => t(`dossier.roleNouns.${r}`)),
  );
}

function ScenarioCard({ d, s, t, open, actions }: { d: Dossier; s: Scenario; t: T; open: boolean; actions?: DossierActions | null }) {
  const n = names(d, s);
  const m = (k: string) => t(`dossier.mechanisms.${s.mechanism}.${k}` as MessageKey, n);
  const label = s.novelty === "new_offering" ? t("dossier.labels.novel") : s.state === "inference" ? t("dossier.labels.evidenced") : t("dossier.labels.hypothesis");
  const findings = [...s.critic].sort((a, b) => ["kill", "major", "minor"].indexOf(a.severity) - ["kill", "major", "minor"].indexOf(b.severity));
  const credible = s.verdict === "credible";
  const trackable = credible && d.verdict === "opportunity" && actions?.canWrite;
  return (
    <div className="rounded-xl border border-edge bg-surface shadow-card" data-testid="scenario" data-mechanism={s.mechanism} data-verdict={s.verdict} data-novelty={s.novelty} data-key={s.key}>
      <details open={open} className="group">
        <summary className={cx("cursor-pointer list-none rounded-xl px-5 py-4", focusRing)}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={s.novelty === "new_offering" ? "caution" : s.state === "inference" ? "positive" : "outline"}>{label}</Badge>
            <Badge tone={credible ? "brand" : "neutral"}>{credible ? t("dossier.labels.credible") : t("dossier.consideredLabel")}</Badge>
          </div>
          <h3 className="mt-2 text-[16px] font-semibold text-fg">{scenarioTitle(t, d, s)}</h3>
          <p className="mt-1 text-[13.5px] text-fg-muted">{m("joint")}</p>
        </summary>
        <div className="space-y-5 border-t border-edge px-5 py-4 text-[13.5px]">
          {credible && s.incremental && s.incremental.existing.length > 0 && (
            <div className="rounded-lg bg-brand-soft/40 px-4 py-3" data-testid="scenario-incremental">
              <h4 className="text-[12.5px] font-semibold tracking-wide text-brand uppercase">{t("dossier.incrementalTitle")}</h4>
              <p className="mt-1 text-fg">
                {t("dossier.incremental", { target: d.targetName, own: d.ownName, existing: existingRoles(t, s.incremental.existing), creates: t(`dossier.roleNouns.${s.creates}`) })}
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["provider", s.contributions.provider, n.provider],
                ["partner", s.contributions.partner, n.partner],
              ] as const
            ).map(([role, c, name]) => (
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
      {trackable && actions && (
        <div className="border-t border-edge px-5 py-3 print:hidden">
          <TrackButton
            locale={actions.locale}
            organizationId={actions.organizationId}
            companyId={actions.companyId}
            q={actions.q}
            scenarioKey={s.key}
            trackedId={actions.tracked[s.key] ?? null}
            targetName={d.targetName}
          />
        </div>
      )}
    </div>
  );
}

const SOURCE_TONE = { user: "brand", network: "brand", own_evidence: "neutral", target_evidence: "neutral" } as const;

/** What the target already is to the user's company, with where ORQO learned it. */
function RelationshipBlock({ d, t }: { d: Dossier; t: T }) {
  const r = d.relationship;
  const vars = { target: d.targetName, own: d.ownName };
  return (
    <div className="mt-3 border-t border-edge pt-3" data-testid="dossier-relationship" data-status={r.status} data-roles={r.roles.join(",")}>
      <p className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.relationship.title")}</p>
      {r.status === "known" ? (
        <ul className="mt-1 space-y-1.5">
          {r.links.slice(0, 3).map((l, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[14px] text-fg">
              <span>{t(`dossier.relationship.roles.${l.role}`, vars)}</span>
              <Badge tone={SOURCE_TONE[l.source]}>{t(`dossier.relationship.sources.${l.source}`, vars)}</Badge>
              {l.statement && <q className="min-w-0 basis-full break-words text-[12.5px] text-fg-muted">{l.statement.length > 200 ? `${l.statement.slice(0, 197)}…` : l.statement}</q>}
              {l.sourceUrl && (
                <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[12.5px] text-brand underline-offset-2 hover:underline">
                  {t("understanding.actions.source")}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[14px] text-fg-muted">{t(r.status === "none" ? "dossier.relationship.none" : "dossier.relationship.unknown", vars)}</p>
      )}
    </div>
  );
}

/** "No credible new opportunity": a useful, confident result, kept short. */
function NegativeView({ d, t, locale }: { d: Dossier; t: T; locale: Locale }) {
  const n = d.negative!;
  const vars = { target: d.targetName, own: d.ownName };
  const shared = [
    ...n.shared.audiences.map((a) => t(`understanding.values.customer_scope.${a.split(":")[1]}` as MessageKey).toLowerCase()),
    ...[...n.shared.industries, ...n.shared.technologies].map((k) => conceptLabel(k, locale).toLowerCase()),
  ].slice(0, 4);
  const consideredTitles = n.consideredMechanisms.map((x) =>
    t(`dossier.mechanisms.${x.mechanism}.title` as MessageKey, { provider: x.provider === "own" ? d.ownName : d.targetName, partner: x.provider === "own" ? d.targetName : d.ownName }),
  );
  return (
    <Card data-testid="dossier-negative">
      <div className="space-y-4 px-5 py-5 text-[14px] leading-relaxed text-fg">
        <div>
          <h2 className="text-[18px] font-semibold text-fg">{t("dossier.negative.title")}</h2>
          <p className="mt-1 text-fg-muted">{t("dossier.negative.lead", vars)}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {(shared.length > 0 || d.relationship.status === "known") && (
            <section>
              <h3 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.negative.whyMatters", vars)}</h3>
              {d.relationship.status === "known" && <p className="mt-1">{t("dossier.negative.partOfToday", vars)}</p>}
              {shared.length > 0 && <p className="mt-1">{t("dossier.negative.shares", { list: list(t, shared) })}</p>}
            </section>
          )}
          {n.reasons.length > 0 && (
            <section data-testid="negative-reasons">
              <h3 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.negative.reasonsTitle")}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {n.reasons.map((r) => (
                  <li key={r}>{t(`dossier.negative.reasons.${r}` as MessageKey, vars)}</li>
                ))}
              </ul>
            </section>
          )}
          {consideredTitles.length > 0 && (
            <section>
              <h3 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.negative.considered")}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-fg-muted">
                {consideredTitles.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          )}
          {n.unknowns.length > 0 && (
            <section>
              <h3 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.negative.unknownTitle")}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {n.unknowns.map((q) => (
                  <li key={q.key}>{questionText(t, d, q)}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <section className="rounded-lg bg-subtle px-4 py-3" data-testid="negative-change">
          <h3 className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">{t("dossier.negative.changeTitle")}</h3>
          <ul className="mt-1 space-y-1">
            {n.reconsiderIf.length > 0 && (
              <li>
                {t("dossier.negative.changeSignals", {
                  ...vars,
                  list: list(
                    t,
                    n.reconsiderIf.map((x) => t(`understanding.market.entries.signal.${x}` as MessageKey).toLowerCase()),
                  ),
                })}
              </li>
            )}
            <li>{t("dossier.negative.changeNeed", vars)}</li>
          </ul>
        </section>
      </div>
    </Card>
  );
}

export function DossierView({
  dossier: d,
  locale,
  reportHref,
  expanded = false,
  actions = null,
}: {
  dossier: Dossier;
  locale: Locale;
  reportHref: string | null;
  expanded?: boolean;
  actions?: DossierActions | null;
}) {
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
          <p>
            {forms.length
              ? t(scopes.length ? "dossier.identity" : "dossier.identityNoScope", { target: d.targetName, roles: list(t, roles), forms: list(t, forms), scopes: list(t, scopes) })
              : t("dossier.identityUnknown", { target: d.targetName })}
          </p>
          {e.routes.length > 0 && (
            <p>
              {t("dossier.routes", {
                routes: list(
                  t,
                  e.routes.map((r) => lower(`understanding.market.entries.route.${r}`)),
                ),
              })}
            </p>
          )}
          {d.status === "ready" ? (
            <p className="font-medium" data-testid="dossier-verdict" data-verdict={d.verdict}>
              {lead ? t(lead.novelty === "new_offering" ? "dossier.leadNovel" : "dossier.lead", { own: d.ownName, title: scenarioTitle(t, d, lead) }) : t("dossier.verdict.no_credible_opportunity")}
            </p>
          ) : (
            <p className="font-medium" data-testid="dossier-verdict" data-verdict={d.verdict}>
              {t(`dossier.status.${d.status}`, { target: d.targetName })}
            </p>
          )}
          {d.status === "ready" && <RelationshipBlock d={d} t={t} />}
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

      {d.status === "ready" && d.askRelationship && actions?.canWrite && actions.companyId && (
        <Card className="print:hidden">
          <div className="px-5 py-4">
            <p className="mb-2 text-[12.5px] font-semibold tracking-wide text-brand uppercase">{t("dossier.relationship.questionTitle")}</p>
            <RelationshipQuestion locale={locale} organizationId={actions.organizationId} companyId={actions.companyId} ownName={d.ownName} targetName={d.targetName} />
          </div>
        </Card>
      )}

      {d.status === "ready" && d.verdict === "no_credible_opportunity" && <NegativeView d={d} t={t} locale={locale} />}

      {d.status === "ready" && (
        <>
          {d.scenarios.length > 0 && (
            <div className="space-y-3" data-testid="dossier-scenarios">
              <div>
                <h2 className="text-[17px] font-semibold text-fg">{t("dossier.scenariosTitle")}</h2>
                <p className="text-[13px] text-fg-muted">{t("dossier.scenariosBody")}</p>
              </div>
              {d.scenarios.map((s, i) => (
                <ScenarioCard key={s.key} d={d} s={s} t={t} open={expanded || i === 0} actions={actions} />
              ))}
            </div>
          )}

          {d.novel.length > 0 && (
            <div className="space-y-3" data-testid="dossier-novel">
              <div>
                <h2 className="text-[17px] font-semibold text-fg">{t("dossier.novelTitle")}</h2>
                <p className="text-[13px] text-fg-muted">{t("dossier.novelBody")}</p>
              </div>
              {d.novel.map((s) => (
                <ScenarioCard key={s.key} d={d} s={s} t={t} open={expanded} actions={actions} />
              ))}
            </div>
          )}

          {d.considered.length > 0 && (
            <details open={expanded} className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-card" data-testid="dossier-considered">
              <summary className={cx("cursor-pointer rounded text-[14px] font-medium text-fg", focusRing)}>{t("dossier.consideredTitle", { count: d.considered.length })}</summary>
              <p className="mt-1 text-[12.5px] text-fg-muted">{t("dossier.consideredBody")}</p>
              <div className="mt-3 space-y-3">
                {d.considered.map((s) => (
                  <ScenarioCard key={s.key} d={d} s={s} t={t} open={false} />
                ))}
              </div>
            </details>
          )}

          {d.verdict === "opportunity" && (
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
                    <p className="mt-1 text-fg-muted">
                      {t(d.nextQuestion.resolve === "ask" ? "dossier.askThem" : "dossier.research", { about: d.nextQuestion.about === "own" ? d.ownName : d.targetName })}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {d.discarded.length > 0 && (
            <details open={expanded} className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-card" data-testid="dossier-discarded">
              <summary className={cx("cursor-pointer rounded text-[14px] font-medium text-fg", focusRing)}>{t("dossier.discardedTitle", { count: d.discarded.length })}</summary>
              <p className="mt-1 text-[12.5px] text-fg-muted">{t("dossier.discardedBody")}</p>
              <ul className="mt-2 space-y-2 text-[13.5px]">
                {d.discarded.map((x) => (
                  <li key={`${x.mechanism}:${x.provider}`}>
                    {x.mechanism === "similarity_only" ? (
                      <span className="text-fg">{t("dossier.critic.similarity_only")}</span>
                    ) : (
                      <>
                        <span className="font-medium text-fg">
                          {t(`dossier.mechanisms.${x.mechanism}.title` as MessageKey, {
                            provider: x.provider === "own" ? d.ownName : d.targetName,
                            partner: x.provider === "own" ? d.targetName : d.ownName,
                          })}
                        </span>
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
