/**
 * ORQO missions — presentation (Phase 17C). Pure render functions (no hooks), shared by the server pages
 * and the live mission view. Everything shown is derived from the mission's real steps and findings by
 * lib/missions/briefing.ts; nothing here invents a conclusion. No lease, run id or internal step key is shown.
 */
import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/lib/i18n/translate";
import {
  buildBriefing,
  companyHref,
  failureCode,
  isActive,
  missionPhase,
  missionTitle,
  progressPercent,
  stepLabel,
  visibleSteps,
  type AnalysisCard,
  type MatterLine,
  type MissionBriefing,
  type MissionPhase,
  type NextAction,
  type ProspectCard,
  type StepLabel,
} from "@/lib/missions/briefing";
import type { MissionStepView, MissionView, StepSubject } from "@/lib/missions/view";
import { Icon } from "./icons";
import { Badge, Card, cx, focusRing, type BadgeTone } from "./ui";

export function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

const list = (_t: Translator, xs: string[]) => xs.join(", ");

/** Display name of a step subject. A Network company id is shown by its name when the page resolved it. */
export function subjectName(t: Translator, s: StepSubject | null, names: Record<string, string> = {}): string {
  if (!s) return t("missions.form.targetAny");
  return "query" in s ? s.query : (names[s.companyId] ?? t("missions.form.targetAny"));
}

export function titleText(t: Translator, v: { mission: Pick<MissionView["mission"], "template" | "input"> }, names: Record<string, string> = {}): string {
  const x = missionTitle(v);
  if (x.kind === "research") return `${t("missions.templates.research_company.name")} · ${subjectName(t, x.target, names)}`;
  const intent = t(`discover.intents.${x.intent}` as MessageKey);
  const filters = [x.market, x.geography].filter(Boolean).join(" · ");
  return `${t(`missions.templates.${v.mission.template}.name` as MessageKey)} · ${intent}${filters ? ` · ${filters}` : ""}`;
}

export function stepText(t: Translator, l: StepLabel, names: Record<string, string> = {}): string {
  if (l.kind === "research") return t("missions.steps.research", { company: subjectName(t, l.subject, names) });
  return t(`missions.steps.${l.kind}`);
}

const PHASE_TONE: Record<MissionPhase, BadgeTone> = {
  preparing: "neutral",
  reviewing_candidates: "brand",
  planning_research: "brand",
  researching: "brand",
  compiling: "brand",
  completed: "positive",
  completed_with_gaps: "caution",
  needs_attention: "critical",
  cancelled: "neutral",
};

export function PhaseBadge({ v, locale }: { v: MissionView; locale: Locale }) {
  const t = createTranslator(locale);
  const phase = missionPhase(v);
  return (
    <Badge tone={PHASE_TONE[phase]} icon={phase === "completed" ? "check" : isActive(v) ? "clock" : undefined}>
      <span data-testid="mission-phase" data-phase={phase}>
        {t(`missions.phase.${phase}`)}
      </span>
    </Badge>
  );
}

/** One-sentence statement of where the mission is, for a live region. */
export function phaseSentence(t: Translator, v: MissionView, names: Record<string, string> = {}): string {
  const phase = missionPhase(v);
  if (phase === "researching") {
    const cur = v.steps.find((s) => s.status === "leased") ?? [...v.steps].sort((a, b) => a.seq - b.seq).find((s) => s.status === "pending");
    const l = cur ? stepLabel(cur) : null;
    return t("missions.phaseBody.researching", { company: l?.kind === "research" ? subjectName(t, l.subject, names) : t("missions.form.targetAny") });
  }
  return t(`missions.phaseBody.${phase}`);
}

export function ProgressBar({ v, locale }: { v: MissionView; locale: Locale }) {
  const t = createTranslator(locale);
  const pct = progressPercent(v);
  const done = v.steps.filter((s) => ["completed", "failed", "skipped", "cancelled"].includes(s.status)).length;
  return (
    <div>
      <div role="progressbar" aria-label={t("missions.progress.label")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={t("missions.progress.count", { done, total: v.steps.length })} className="h-2 w-full overflow-hidden rounded-full bg-subtle" data-testid="mission-progressbar">
        <div className={cx("h-full rounded-full transition-[width] duration-500", v.mission.status === "failed" ? "bg-critical" : v.mission.status === "cancelled" ? "bg-fg-faint" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[12.5px] text-fg-muted">{t("missions.progress.count", { done, total: v.steps.length })}</p>
    </div>
  );
}

function StepIcon({ s }: { s: MissionStepView }) {
  if (s.status === "leased") return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand motion-reduce:animate-none" aria-hidden />;
  if (s.status === "completed") return <Icon name="check" size={14} className="text-positive" aria-hidden />;
  if (s.status === "failed") return <span className="text-[13px] font-semibold text-critical" aria-hidden>!</span>;
  return <span className="h-2 w-2 rounded-full border border-edge-strong" aria-hidden />;
}

/** The founder-facing step list: what ORQO did, is doing, and will do. */
export function StepList({ v, locale, names = {} }: { v: MissionView; locale: Locale; names?: Record<string, string> }) {
  const t = createTranslator(locale);
  return (
    <ol className="space-y-2.5" data-testid="mission-steps">
      {visibleSteps(v).map((s) => (
        <li key={s.key} className="flex items-start gap-3" data-step-status={s.status}>
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
            <StepIcon s={s} />
          </span>
          <div className="min-w-0 flex-1">
            <div className={cx("text-[14px]", s.status === "leased" ? "font-medium text-fg" : s.status === "pending" ? "text-fg-muted" : "text-fg")}>{stepText(t, stepLabel(s), names)}</div>
            {s.status === "failed" && <p className="mt-0.5 text-[12.5px] text-critical">{t(`missions.failures.${failureCode(s.error)}`)}</p>}
          </div>
          <span className="shrink-0 text-[12px] text-fg-faint">{t(`missions.stepStatus.${s.status}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Where paid authority and spend live. Phase 17C: free ($0); Phase 17D fills requested/approved/actual. */
export function AuthorityLine({ v, locale }: { v: MissionView; locale: Locale }) {
  const t = createTranslator(locale);
  const free = v.authority.maxCostUsd === 0 && !v.authority.paidProviders;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-muted" data-testid="mission-authority" data-max-cost={v.authority.maxCostUsd} data-spend={v.spend.committedUsd}>
      <span className="font-medium text-fg">{t("missions.authority.title")}</span>
      {free && <span>{t("missions.authority.free")}</span>}
      <span>{v.spend.calls === 0 ? t("missions.authority.noSpend") : t("missions.authority.spend", { amount: `$${v.spend.committedUsd.toFixed(2)}`, calls: v.spend.calls })}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work cards

const PRIORITY_TONE: Record<string, BadgeTone> = { high: "positive", worth_investigating: "brand", weak: "neutral" };
const STATUS_TONE: Record<string, BadgeTone> = { opportunities: "positive", hypotheses_only: "caution", none: "neutral", own_profile_missing: "caution" };

const relationshipText = (t: Translator, r: string) => t(`analysis.relationships.${r}` as MessageKey);
const fieldText = (t: Translator, f: string) => t(`company.fields.${f}` as MessageKey);

export function ProspectCardView({ p, locale, analysis }: { p: ProspectCard; locale: Locale; analysis?: AnalysisCard }) {
  const t = createTranslator(locale);
  return (
    <li className="rounded-xl border border-edge bg-surface px-4 py-3.5" data-testid="prospect-card" data-domain={p.domain} data-priority={p.priority}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={companyHref(p.domain, p.networkCompanyId)} className={cx("rounded text-[14.5px] font-semibold text-fg hover:text-brand hover:underline", focusRing)} aria-label={t("missions.cards.open", { company: p.name })}>
            {p.name}
          </Link>
          <div className="text-[12.5px] text-fg-faint">{p.domain}</div>
        </div>
        <Badge tone={PRIORITY_TONE[p.priority] ?? "neutral"}>{t(`discover.result.priority.${p.priority}` as MessageKey)}</Badge>
      </div>
      {p.relationship && <p className="mt-2 text-[13.5px] text-fg">{relationshipText(t, p.relationship)}</p>}
      {analysis && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]" data-testid="prospect-research">
          <Badge tone={STATUS_TONE[analysis.analysisStatus] ?? "neutral"}>{t(`missions.cards.analysisStatus.${analysis.analysisStatus}` as MessageKey)}</Badge>
          {analysis.top && (
            <span className="text-fg-muted">
              {t("missions.cards.topFit")}: {relationshipText(t, analysis.top.relationship)} · {t(`analysis.confidence.${analysis.top.confidence}` as MessageKey)}
            </span>
          )}
        </div>
      )}
      {p.nextQuestion && <p className="mt-1.5 text-[13px] text-fg-muted">{p.nextQuestion}</p>}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-faint">
        {p.evidenceCount > 0 && <span>{t("missions.cards.evidence", { count: p.evidenceCount })}</span>}
        {p.unknowns > 0 && <span>{t("missions.cards.unknowns", { count: p.unknowns })}</span>}
        {p.networkCompanyId && <span>{t("missions.cards.inNetwork")}</span>}
        {analysis && <span>{t("missions.cards.facts", analysis.evidence)}</span>}
      </div>
    </li>
  );
}

export function AnalysisCardView({ a, locale }: { a: AnalysisCard; locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <li className="rounded-xl border border-edge bg-surface px-4 py-3.5" data-testid="analysis-card" data-domain={a.domain} data-status={a.analysisStatus}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={companyHref(a.domain, null)} className={cx("rounded text-[14.5px] font-semibold text-fg hover:text-brand hover:underline", focusRing)} aria-label={t("missions.cards.open", { company: a.name })}>
            {a.name}
          </Link>
          <div className="text-[12.5px] text-fg-faint">{a.domain}</div>
        </div>
        <Badge tone={STATUS_TONE[a.analysisStatus] ?? "neutral"}>{t(`missions.cards.analysisStatus.${a.analysisStatus}` as MessageKey)}</Badge>
      </div>
      {a.top && (
        <p className="mt-2 text-[13.5px] text-fg">
          <span className="text-fg-muted">{t("missions.cards.topFit")}: </span>
          {relationshipText(t, a.top.relationship)} · {t(`analysis.confidence.${a.top.confidence}` as MessageKey)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-faint">
        <span>{t("missions.cards.facts", a.evidence)}</span>
        {a.unknowns > 0 && <span>{t("missions.cards.unknowns", { count: a.unknowns })}</span>}
        {a.researchedAt && <span>{t("missions.cards.researchedAt", { date: formatDay(a.researchedAt, locale) })}</span>}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The ORQO Briefing

function matterText(t: Translator, m: MatterLine): string {
  switch (m.kind) {
    case "high_priority":
      return t(m.count === 1 ? "missions.matters.high_priorityOne" : "missions.matters.high_priorityMany", { count: m.count, names: list(t, m.names) });
    case "worth_investigating":
      return t(m.count === 1 ? "missions.matters.worth_investigatingOne" : "missions.matters.worth_investigatingMany", { count: m.count });
    case "opportunity":
      return t("missions.matters.opportunity", { company: m.company, relationship: relationshipText(t, m.relationship), confidence: t(`analysis.confidence.${m.confidence}` as MessageKey).toLowerCase() });
    case "hypotheses_only":
    case "no_opportunity":
      return t(`missions.matters.${m.kind}`, { company: m.company });
    default:
      return t(`missions.matters.${m.kind}`);
  }
}

function nextText(t: Translator, n: NextAction): string {
  switch (n.kind) {
    case "complete_profile":
      return n.fields.length ? t("missions.next.complete_profileFields", { fields: list(t, n.fields.map((f) => fieldText(t, f).toLowerCase())) }) : t("missions.next.complete_profile");
    case "validate":
      return t("missions.next.validate", { company: n.company, relationship: relationshipText(t, n.relationship) });
    case "ask":
      return t("missions.next.ask", { company: n.company, question: n.question });
    case "investigate":
      return t("missions.next.investigate", { company: n.company });
    default:
      return t(`missions.next.${n.kind}`);
  }
}

function didLines(t: Translator, b: MissionBriefing): string[] {
  return b.did.map((d) => {
    switch (d.kind) {
      case "reviewed":
        return t("missions.did.reviewed", { considered: d.considered, presented: d.presented });
      case "researched":
        return t(d.count === 1 ? "missions.did.researchedOne" : "missions.did.researchedMany", { count: d.count, names: list(t, d.names) });
      case "incomplete":
        return t(d.count === 1 ? "missions.did.incompleteOne" : "missions.did.incompleteMany", { count: d.count });
      case "stopped":
        return t("missions.did.stopped");
    }
  });
}

const H3 = ({ id, children }: { id: string; children: string }) => (
  <h3 id={id} className="text-[12.5px] font-semibold tracking-wide text-fg-muted uppercase">
    {children}
  </h3>
);

/**
 * The ORQO Briefing: what ORQO did, what it found, what matters, what to do next. Rendered for finished
 * missions (completed, failed or stopped); a stopped or failed mission shows what was finished before.
 */
export function BriefingView({ v, locale, names = {} }: { v: MissionView; locale: Locale; names?: Record<string, string> }) {
  const t = createTranslator(locale);
  const b = buildBriefing(v);
  const complete = v.mission.status === "completed";
  const did = didLines(t, b);
  const found = b.prospects.length + b.analyses.length > 0 || b.prospecting !== null || b.gaps.length > 0;
  // A researched prospect shows its research on its own card; separate research cards are for the rest.
  const byDomain = new Map(b.analyses.map((a) => [a.domain, a]));
  const prospectDomains = new Set(b.prospects.map((p) => p.domain));
  const analyses = b.analyses.filter((a) => !prospectDomains.has(a.domain));
  return (
    <section aria-labelledby="briefing-title" className="space-y-7" data-testid="mission-briefing" data-compiled={b.compiled}>
      <h2 id="briefing-title" className="text-[20px] font-semibold tracking-tight text-fg">
        {complete ? t("missions.briefing.title") : t("missions.briefing.partialTitle")}
      </h2>

      <section aria-labelledby="briefing-did" className="space-y-2">
        <H3 id="briefing-did">{t("missions.briefing.did")}</H3>
        <ul className="space-y-1.5 text-[14.5px] text-fg" data-testid="briefing-did">
          {did.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {b.failedSteps.length > 0 && (
          <ul className="space-y-1 text-[13px] text-critical" data-testid="briefing-failed">
            {b.failedSteps.map((f) => (
              <li key={f.key}>
                {stepText(t, f.label, names)} — {t(`missions.failures.${failureCode(f.error)}`)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {b.matters.length > 0 && (
        <section aria-labelledby="briefing-matters" className="space-y-2">
          <H3 id="briefing-matters">{t("missions.briefing.matters")}</H3>
          <ul className="space-y-2" data-testid="briefing-matters">
            {b.matters.map((m, i) => (
              <li key={i} className="flex gap-2.5 text-[14.5px] text-fg" data-matter={m.kind}>
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                <span>{matterText(t, m)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="briefing-next" className="space-y-2">
        <H3 id="briefing-next">{t("missions.briefing.next")}</H3>
        {b.next.length ? (
          <ol className="space-y-2" data-testid="briefing-next">
            {b.next.map((n, i) => (
              <li key={i} data-next={n.kind}>
                <Link href={n.href} className={cx("group flex min-h-11 items-center justify-between gap-3 rounded-xl border border-edge bg-surface px-4 py-2.5 text-[14px] text-fg shadow-card hover:border-brand/40", focusRing)}>
                  <span>{nextText(t, n)}</span>
                  <Icon name="arrow" size={14} className="shrink-0 text-fg-faint group-hover:text-brand" aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[14px] text-fg-muted">{t("missions.briefing.nothingNext")}</p>
        )}
      </section>

      <section aria-labelledby="briefing-found" className="space-y-4">
        <H3 id="briefing-found">{t("missions.briefing.found")}</H3>
        {!found && <p className="text-[14px] text-fg-muted">{t("missions.briefing.nothingFound")}</p>}
        {analyses.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[14px] font-semibold text-fg">{t("missions.cards.analyses")}</h4>
            <ul className="grid gap-3 sm:grid-cols-2">
              {analyses.map((a) => (
                <AnalysisCardView key={a.key} a={a} locale={locale} />
              ))}
            </ul>
          </div>
        )}
        {b.prospects.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[14px] font-semibold text-fg">{t("missions.cards.prospects")}</h4>
            <ul className="grid gap-3 sm:grid-cols-2">
              {b.prospects.map((p) => (
                <ProspectCardView key={p.key} p={p} locale={locale} analysis={byDomain.get(p.domain)} />
              ))}
            </ul>
          </div>
        )}
        {b.prospecting && (
          <Card className="px-4 py-3" data-testid="prospecting-card">
            <h4 className="text-[13.5px] font-semibold text-fg">{t("missions.cards.prospecting")}</h4>
            <p className="mt-1 text-[13px] text-fg-muted">{t("missions.cards.funnel", { considered: b.prospecting.considered, qualified: b.prospecting.qualified, weak: b.prospecting.weak, rejected: b.prospecting.rejected })}</p>
            {b.prospecting.status === "partial" && <p className="mt-1 text-[13px] text-caution">{t("missions.cards.partial")}</p>}
          </Card>
        )}
        {b.gaps.length > 0 && (
          <div className="rounded-xl border border-caution/30 bg-caution-soft px-4 py-3" data-testid="profile-gap-card">
            <h4 className="text-[13.5px] font-semibold text-fg">{t("missions.cards.gaps")}</h4>
            <p className="mt-1 text-[13px] text-fg-muted">{t("missions.cards.gapsBody", { fields: list(t, b.gaps.map((f) => fieldText(t, f).toLowerCase())) })}</p>
          </div>
        )}
      </section>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mission lists

export interface MissionListItem {
  id: string;
  template: string;
  objective: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  /** A ready title (the page derives it from the mission input). */
  title: string;
}

const STATUS_BADGE: Record<string, BadgeTone> = { planned: "brand", running: "brand", completed: "positive", failed: "critical", cancelled: "neutral" };

export function MissionList({ items, locale, testId }: { items: MissionListItem[]; locale: Locale; testId: string }) {
  const t = createTranslator(locale);
  return (
    <ul className="divide-y divide-edge" data-testid={testId}>
      {items.map((m) => (
        <li key={m.id}>
          <Link href={`/workspace/missions/${m.id}`} className={cx("flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-subtle", focusRing)} data-testid="mission-row" data-status={m.status}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand" aria-hidden>
              <Icon name="missions" size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-fg">{m.title}</span>
              <span className="block truncate text-[12.5px] text-fg-faint">{m.finishedAt ? t("missions.finished", { date: formatDay(m.finishedAt, locale) }) : t("missions.started", { date: formatDay(m.createdAt, locale) })}</span>
            </span>
            <Badge tone={STATUS_BADGE[m.status] ?? "neutral"}>{t(`missions.status.${m.status}` as MessageKey)}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** List rows with a founder-facing title (Network company ids resolved to names). */
export function missionItems(rows: { id: string; template: string; objective: string; status: string; created_at: string; finished_at: string | null; input: Record<string, unknown> }[], t: Translator, names: Record<string, string>): MissionListItem[] {
  return rows.map((m) => ({ id: m.id, template: m.template, objective: m.objective, status: m.status, createdAt: m.created_at, finishedAt: m.finished_at, title: titleText(t, { mission: { template: m.template as MissionView["mission"]["template"], input: m.input } }, names) }));
}

/** Work (home): what ORQO is doing for you, and the latest briefings. Restrained: at most 3 rows. */
export function WorkMissions({ items, locale }: { items: MissionListItem[]; locale: Locale }) {
  const t = createTranslator(locale);
  const active = items.filter((m) => m.status === "planned" || m.status === "running");
  const recent = items.filter((m) => m.status === "completed").slice(0, Math.max(0, 3 - active.length));
  const shown = [...active.slice(0, 3), ...recent];
  return (
    <section aria-labelledby="work-missions-title" className="space-y-3" data-testid="work-missions">
      <div className="flex items-end justify-between gap-4">
        <h2 id="work-missions-title" className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
          {active.length ? t("missions.work.active") : t("missions.work.title")}
        </h2>
        <Link href={shown.length ? "/workspace/missions" : "/workspace/missions#delegate"} className={cx("inline-flex min-h-11 items-center rounded text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
          {shown.length ? t("missions.work.all") : t("missions.work.delegate")}
        </Link>
      </div>
      {shown.length > 0 && (
        <Card>
          <MissionList items={shown} locale={locale} testId="work-missions-list" />
        </Card>
      )}
    </section>
  );
}
