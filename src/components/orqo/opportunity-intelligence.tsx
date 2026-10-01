import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/lib/i18n/translate";
import { attentionTags, type Basis, type CompanyIntelligence, type CriticCheck, type OpportunityIntelligence, type SupportState, type Text, type ValidationAction } from "@/lib/opportunity/intelligence";
import { Icon } from "./icons";
import { Badge, Card, CardHeader, cx, focusRing, type BadgeTone } from "./ui";

/**
 * Phase 11 Opportunity Intelligence brief. Server component, pure rendering
 * of the deterministic brief (src/lib/opportunity/intelligence.ts): no model,
 * no provider, no write. Sections keep FIT, TIMING and RELATIONSHIP apart;
 * PUBLIC evidence and PRIVATE relationship context are rendered in separate,
 * labeled places, and private context is limited to counts, days, stage and
 * the primary contact's name.
 */

export function say(t: Translator, x: Text): string {
  return "literal" in x ? x.literal : t(x.key, x.vars);
}

const SUPPORT_TONE: Record<SupportState, BadgeTone> = { supported: "positive", partially_supported: "brand", needs_validation: "caution", insufficient_evidence: "neutral", contradicted: "critical" };
const BASIS_DOT: Record<Basis, string> = { fact: "bg-positive", inference: "bg-brand", assumption: "bg-caution", recorded: "bg-fg-faint", unknown: "bg-edge-strong" };
const CHECK_TONE: Record<CriticCheck["result"], string> = { pass: "text-positive", warn: "text-caution", fail: "text-critical", info: "text-fg-faint" };
const CHECK_MARK: Record<CriticCheck["result"], string> = { pass: "✓", warn: "!", fail: "✕", info: "–" };

function BasisTag({ basis, t }: { basis: Basis; t: Translator }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-fg-muted" data-basis={basis}>
      <span className={cx("h-1.5 w-1.5 rounded-full", BASIS_DOT[basis])} />
      {t(`opportunityIntel.basis.${basis}`)}
    </span>
  );
}

function Block({ title, note, children, testId }: { title: string; note?: string; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId}>
      <h4 className="text-[12px] font-semibold uppercase tracking-wide text-fg-faint">{title}</h4>
      {note && <p className="text-[11.5px] text-fg-faint">{note}</p>}
      <div className="mt-1 text-[13px]">{children}</div>
    </section>
  );
}

function mechanismLabel(t: Translator, kind: OpportunityIntelligence["mechanism"]["kind"]): string | null {
  if (!kind) return null;
  return kind === "complement" || kind === "reciprocal" ? t(`opportunityIntel.mechanisms.${kind}`) : t(`analysis.relationships.${kind}`);
}

function actionTitle(t: Translator, a: ValidationAction): string {
  switch (a.kind) {
    case "ask_contact":
      return t("opportunityIntel.actions.ask_contact", { contact: a.contact, company: a.company });
    case "follow_up_event":
      return t("opportunityIntel.actions.follow_up_event", { company: a.company, event: a.event });
    case "ask_company":
      return t("opportunityIntel.actions.ask_company", { company: a.company });
    case "identify_contact":
      return t("opportunityIntel.actions.identify_contact", { company: a.company });
    case "research":
      return t("opportunityIntel.actions.research");
    case "update_profile":
      return t("opportunityIntel.actions.update_profile");
    case "watch_timing":
      return a.company ? t("opportunityIntel.actions.watch_timing", { company: a.company }) : t("opportunityIntel.actions.watch_timing_none");
    case "decide":
      return t("opportunityIntel.actions.decide");
    case "none":
      return t(`opportunityIntel.actions.none_${a.reason}`);
  }
}

function criticNote(t: Translator, c: CriticCheck, b: OpportunityIntelligence): string {
  if (c.id === "relationship") return t(`opportunityIntel.dims.relationship.${b.dimensions.relationship}`);
  if (c.id === "critical_unknown") return c.code === "none" ? t("opportunityIntel.critic.critical_unknown.none") : `${t("opportunityIntel.critic.critical_unknown.open")} ${b.unknowns[0] ? say(t, b.unknowns.find((u) => u.code === c.code)?.text ?? b.unknowns[0].text) : ""}`;
  return t(`opportunityIntel.critic.${c.id}.${c.code}` as MessageKey);
}

export function OpportunityBrief({ brief: b, locale, open = false }: { brief: OpportunityIntelligence; locale: Locale; open?: boolean }) {
  const t = createTranslator(locale);
  const a = b.nextAction;
  const question = "question" in a ? a.question : null;
  const resolves = "unknown" in a ? b.unknowns.find((u) => u.code === a.unknown) : undefined;
  const mech = mechanismLabel(t, b.mechanism.kind);
  return (
    <details open={open} className="group rounded-xl border border-edge bg-surface" data-testid="opportunity-brief" data-source={b.source} data-support={b.support} data-label={b.label}>
      <summary className={cx("flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-4 py-3", focusRing)}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="outline">{t(`opportunityIntel.labels.${b.label}`)}</Badge>
            <Badge tone={SUPPORT_TONE[b.support]}>{t(`opportunityIntel.support.${b.support}`)}</Badge>
            {mech && <span className="text-[11.5px] text-fg-faint">{mech}</span>}
          </div>
          <h3 className="mt-1.5 text-[14.5px] font-semibold text-fg" data-testid="brief-thesis">
            {b.thesis ? say(t, b.thesis) : t("opportunityIntel.empty.title")}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {attentionTags(b).map((tag) => (
              <span key={tag} className="rounded bg-subtle px-1.5 py-0.5 text-[11px] text-fg-muted">
                {t(`opportunityIntel.tags.${tag}`)}
              </span>
            ))}
          </div>
        </div>
        <Icon name="arrow" size={14} className="mt-1.5 shrink-0 text-fg-faint transition-transform group-open:rotate-90" />
      </summary>

      <div className="space-y-4 border-t border-edge px-4 py-4">
        {b.workflowStage && (
          <p className="text-[12px] text-fg-muted" data-testid="brief-workflow-stage">
            {t("opportunityIntel.workflowStage", { stage: t(`opportunityIntel.stages.${b.workflowStage}` as MessageKey) })}
          </p>
        )}

        <Block title={t("opportunityIntel.sections.whyItCouldWork")} testId="brief-why-fit">
          {b.why && (
            <p className="flex items-start gap-2 text-fg">
              <span>{say(t, b.why)}</span> <BasisTag basis={b.whyBasis} t={t} />
            </p>
          )}
          <div className={cx("mt-2 grid gap-3", b.participants.length > 2 ? "md:grid-cols-3" : "sm:grid-cols-2")}>
            {b.participants.map((p, i) => (
              <div key={`${p.companyId ?? p.name}-${i}`} className="rounded-lg bg-subtle/60 px-3 py-2" data-testid="brief-participant" data-role={p.role} data-support={p.support}>
                <div className="text-[12px] font-medium text-fg">{t("opportunityIntel.sections.brings", { company: p.name })}</div>
                {p.brings.length === 0 ? (
                  <p className="text-[12.5px] text-fg-faint">{t("opportunityIntel.sections.notEstablished")}</p>
                ) : (
                  <ul className="mt-0.5 space-y-0.5">
                    {p.brings.map((c, j) => (
                      <li key={j} className="flex items-start justify-between gap-2 text-[12.5px] text-fg-muted">
                        <span>
                          {c.qualifier && <span className="text-fg-faint">{say(t, c.qualifier)}: </span>}
                          {say(t, c.text)}
                        </span>
                        <BasisTag basis={c.status} t={t} />
                      </li>
                    ))}
                  </ul>
                )}
                {p.seeks.length > 0 && (
                  <>
                    <div className="mt-1.5 text-[12px] font-medium text-fg">{t("opportunityIntel.sections.seeks", { company: p.name })}</div>
                    <ul className="mt-0.5 space-y-0.5">
                      {p.seeks.map((c, j) => (
                        <li key={j} className="flex items-start justify-between gap-2 text-[12.5px] text-fg-muted">
                          <span>{say(t, c.text)}</span>
                          <BasisTag basis={c.status} t={t} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-fg-muted" data-testid="brief-value">
            <span className="font-medium text-fg">{t("opportunityIntel.sections.value")} </span>
            {b.value ? say(t, b.value) : t("opportunityIntel.sections.noValue")}
          </p>
        </Block>

        <Block title={t("opportunityIntel.sections.qualification")} note={t("opportunityIntel.supportHelp")} testId="brief-dimensions">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
            {(["fit", "timing", "relationship", "access", "evidence"] as const).map((d) => (
              <div key={d} data-dimension={d}>
                <dt className="text-[11.5px] text-fg-faint">{t(`opportunityIntel.dims.${d}.label`)}</dt>
                <dd className="text-[12.5px] font-medium text-fg">{t(`opportunityIntel.dims.${d}.${b.dimensions[d]}` as MessageKey)}</dd>
              </div>
            ))}
          </dl>
        </Block>

        <div className="grid gap-4 md:grid-cols-2">
          <Block title={t("opportunityIntel.sections.whyNow")} testId="brief-why-now">
            {b.timing.length === 0 ? (
              <p className="text-fg-muted">{t("opportunityIntel.sections.noTiming")}</p>
            ) : (
              <ul className="space-y-1">
                {b.timing.map((x, i) => (
                  <li key={`${x.ref}-${i}`} className="flex items-start justify-between gap-2 text-fg-muted" data-timing-kind={x.kind}>
                    <span>
                      <span className="text-fg-faint">{t(`opportunityIntel.timingKinds.${x.kind}`)} · </span>
                      {x.company && x.kind !== "upcoming_event" ? `${x.company}: ` : ""}
                      {say(t, x.text)}
                      {x.day ? ` · ${x.day}` : ""}
                    </span>
                    <BasisTag basis={x.status} t={t} />
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title={t("opportunityIntel.sections.relationship")} note={t("opportunityIntel.sections.relationshipNote")} testId="brief-relationship">
            {b.relationships.length === 0 ? (
              <p className="text-fg-muted">{t("opportunityIntel.sections.noRelationship")}</p>
            ) : (
              <ul className="space-y-1 text-fg-muted">
                {b.relationships.map((r) => (
                  <li key={r.companyId}>
                    <span className="font-medium text-fg">{r.companyName}</span>
                    {" · "}
                    {r.stage ? t(`network.stages.${r.stage}` as MessageKey) : t("opportunityIntel.rel.noStage")}
                    {r.contacts !== null ? ` · ${t("opportunityIntel.rel.contacts", { n: r.contacts })}` : ""}
                    {r.interactions !== null ? ` · ${t("opportunityIntel.rel.interactions", { n: r.interactions })}` : ""}
                    {r.lastInteractionOn ? ` · ${t("opportunityIntel.rel.lastInteraction", { date: r.lastInteractionOn })}` : ""}
                    {r.openFollowUps > 0 ? ` · ${t("opportunityIntel.rel.openFollowUps", { n: r.openFollowUps })}` : ""}
                    {r.events.map((e) => (
                      <span key={e.eventId} className="block text-[12px]">
                        {t("opportunityIntel.rel.event", { event: e.eventName, status: t(`events.statuses.${e.status}` as MessageKey) })}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Block>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Block title={t("opportunityIntel.sections.breaks")} testId="brief-contradictions">
            {b.contradictions.length === 0 ? (
              <p className="text-fg-muted">{t("opportunityIntel.sections.noContradiction")}</p>
            ) : (
              <ul className="space-y-1">
                {b.contradictions.map((c, i) => (
                  <li key={`${c.code}-${i}`} className={cx("text-[13px]", c.severity === "blocking" ? "text-critical" : c.severity === "weakening" ? "text-caution" : "text-fg-muted")} data-code={c.code} data-severity={c.severity}>
                    {say(t, c.text)}
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title={t("opportunityIntel.sections.unknowns")} testId="brief-unknowns">
            {b.unknowns.length === 0 ? (
              <p className="text-fg-muted">{t("opportunityIntel.sections.noUnknowns")}</p>
            ) : (
              <ol className="list-decimal space-y-0.5 pl-4 text-fg-muted">
                {b.unknowns.map((u) => (
                  <li key={u.code} data-code={u.code}>
                    {say(t, u.text)}
                  </li>
                ))}
              </ol>
            )}
          </Block>
        </div>

        <div className="rounded-lg bg-brand-soft/60 px-4 py-3" data-testid="brief-next-action" data-action={a.kind}>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-brand">{t("opportunityIntel.sections.validateNext")}</div>
          <p className="mt-0.5 font-medium text-fg">{actionTitle(t, a)}</p>
          {question && <p className="mt-0.5 text-[13.5px] text-fg">“{say(t, question)}”</p>}
          {resolves && <p className="mt-0.5 text-[12px] text-fg-muted">{t("opportunityIntel.actions.resolves", { unknown: say(t, resolves.text) })}</p>}
          <p className="mt-1 text-[11.5px] text-fg-faint">{t("opportunityIntel.sections.validateNote")}</p>
        </div>

        <Block title={t("opportunityIntel.sections.evidence")} testId="brief-evidence">
          {b.fitEvidence.length === 0 ? (
            <p className="text-fg-muted">{t("opportunityIntel.sections.noEvidence")}</p>
          ) : (
            <ul className="space-y-1">
              {b.fitEvidence.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2 text-[12.5px] text-fg-muted">
                  <span>
                    <span className="text-fg-faint">{e.company} · </span>
                    {say(t, e.text)}
                    <span className="text-fg-faint">
                      {" "}
                      · {t(`opportunityIntel.origins.${e.origin}`)}
                      {e.selfDescribed ? ` · ${t("opportunityIntel.selfDescribed")}` : ""}
                    </span>
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className={cx("ml-1 rounded text-brand hover:underline", focusRing)}>
                        ↗
                      </a>
                    )}
                  </span>
                  <BasisTag basis={e.status} t={t} />
                </li>
              ))}
            </ul>
          )}
          {b.references.length > 0 && (
            <p className="mt-1 font-mono text-[11px] text-fg-faint" title={b.references.join("\n")}>
              {t("opportunityIntel.sections.references", { n: b.references.length })}
            </p>
          )}
          {b.assumptions.length > 0 && (
            <div className="mt-2">
              <div className="text-[12px] font-medium text-fg-faint">{t("opportunityIntel.sections.assumptions")}</div>
              <ul className="space-y-0.5">
                {b.assumptions.map((x, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] text-fg-muted">
                    <BasisTag basis="assumption" t={t} /> <span>{say(t, x)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Block>

        <details className="rounded-lg border border-edge" data-testid="brief-critic">
          <summary className={cx("cursor-pointer px-3 py-2 text-[12.5px] font-medium text-fg-muted hover:text-fg", focusRing)}>{t("opportunityIntel.sections.critic")}</summary>
          <ul className="grid gap-1 border-t border-edge px-3 py-2 sm:grid-cols-2">
            {b.critic.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[12px]" data-check={c.id} data-result={c.result}>
                <span className={cx("w-3 shrink-0 text-center font-bold", CHECK_TONE[c.result])} aria-label={c.result}>
                  {CHECK_MARK[c.result]}
                </span>
                <span className="text-fg-muted">
                  <span className="font-medium text-fg">{t(`opportunityIntel.critic.${c.id}.title`)}</span> — {criticNote(t, c, b)}
                </span>
              </li>
            ))}
          </ul>
        </details>

        <p className="text-[11.5px] text-fg-faint">{t("opportunityIntel.sections.nothingAutomatic")}</p>
      </div>
    </details>
  );
}

/** Company detail: every brief about this company, or a truthful weak/empty state. */
export function OpportunityIntelligenceCard({ intel, locale, searchHref, profileHref, knownFacts }: { intel: CompanyIntelligence; locale: Locale; searchHref: string; profileHref: string | null; knownFacts: string[] }) {
  const t = createTranslator(locale);
  return (
    <Card data-testid="opportunity-intelligence">
      <CardHeader title={t("opportunityIntel.title")} description={t("opportunityIntel.description")} />
      <div className="space-y-3 px-5 pb-5">
        {intel.briefs.length === 0 ? (
          <div className="space-y-3 text-[13.5px]" data-testid="intel-empty">
            <p className="font-medium text-fg">{t("opportunityIntel.empty.title")}</p>
            {knownFacts.length > 0 && (
              <section>
                <h4 className="text-[12px] font-medium text-fg-faint">{t("opportunityIntel.empty.known")}</h4>
                <ul className="list-disc pl-4 text-fg-muted">
                  {knownFacts.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4 className="text-[12px] font-medium text-fg-faint">{t("opportunityIntel.empty.missing")}</h4>
              <ul className="list-disc pl-4 text-fg-muted">
                {intel.reasons.map((r) => (
                  <li key={r} data-reason={r}>
                    {t(`opportunityIntel.empty.reasons.${r}`)}
                  </li>
                ))}
              </ul>
            </section>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {intel.reasons.includes("no_analysis") || intel.reasons.includes("analysis_no_mechanism") ? (
                <Link href={searchHref} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
                  {t("opportunityIntel.empty.runSearch")} →
                </Link>
              ) : null}
              {profileHref && (
                <Link href={profileHref} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
                  {t("opportunityIntel.empty.completeProfile")} →
                </Link>
              )}
            </div>
          </div>
        ) : (
          intel.briefs.map((b, i) => <OpportunityBrief key={b.id} brief={b} locale={locale} open={i === 0} />)
        )}
      </div>
    </Card>
  );
}
