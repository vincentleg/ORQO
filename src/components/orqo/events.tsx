import Link from "next/link";
import { formatDay } from "@/components/orqo/analysis";
import type { AttentionReason, EventPhase, EventSummary, EventView, Preparation, PrepQuestion, PriorityFactor, TargetPriority, TargetStatus } from "@/lib/events/model";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { formatIsoDay } from "./network";
import { Badge, cx, focusRing, type BadgeTone } from "./ui";

/*
 * Events display (Phase 8). Server components: they render what people
 * recorded and what ORQO stored, label private context as private and public
 * context as public, and say "unknown" rather than guessing.
 */

const PHASE_TONE: Record<EventPhase, BadgeTone> = { active: "positive", upcoming: "brand", undated: "outline", past: "neutral" };
const STATUS_TONE: Record<TargetStatus, BadgeTone> = { planned: "outline", targeted: "brand", met: "positive", missed: "caution", skipped: "outline" };
const PRIORITY_TONE: Record<TargetPriority, BadgeTone> = { high: "caution", medium: "neutral", low: "outline" };

export function PhaseBadge({ locale, phase }: { locale: Locale; phase: EventPhase }) {
  return <Badge tone={PHASE_TONE[phase]}>{createTranslator(locale)(`events.phases.${phase}`)}</Badge>;
}

export function TargetStatusBadge({ locale, status }: { locale: Locale; status: TargetStatus }) {
  return (
    <span data-testid="target-status" data-status={status}>
      <Badge tone={STATUS_TONE[status]}>{createTranslator(locale)(`events.statuses.${status}`)}</Badge>
    </span>
  );
}

export function PriorityBadge({ locale, priority }: { locale: Locale; priority: TargetPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{createTranslator(locale)(`events.priorities.${priority}`)}</Badge>;
}

/** Calendar days as recorded; no time or time zone is implied. */
export function eventDates(locale: Locale, e: Pick<EventView, "startsOn" | "endsOn">): string {
  const t = createTranslator(locale);
  if (!e.startsOn) return t("events.dates.notSet");
  if (!e.endsOn || e.endsOn === e.startsOn) return t("events.dates.oneDay", { date: formatIsoDay(e.startsOn, locale) });
  return t("events.dates.range", { start: formatIsoDay(e.startsOn, locale), end: formatIsoDay(e.endsOn, locale) });
}

export function EventCard({ locale, summary }: { locale: Locale; summary: EventSummary }) {
  const t = createTranslator(locale);
  const e = summary.event;
  return (
    <Link href={`/workspace/events/${e.id}`} className={cx("flex min-w-0 flex-col gap-2 rounded-xl border border-edge bg-surface p-4 shadow-card transition-colors hover:border-edge-strong", focusRing)} data-testid="event-card">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[15px] font-semibold text-fg">{e.name}</h3>
        {e.archivedAt ? <Badge tone="outline">{t("events.archivedBadge")}</Badge> : <PhaseBadge locale={locale} phase={summary.phase} />}
      </div>
      <div className="text-[12.5px] text-fg-muted tabular-nums">
        {eventDates(locale, e)}
        {e.location && ` · ${e.location}`}
      </div>
      {(e.objectiveKind || e.objective) && (
        <p className="line-clamp-2 text-[13px] text-fg-muted">
          {e.objectiveKind && <span className="font-medium text-fg">{t(`events.objectives.${e.objectiveKind}`)}</span>}
          {e.objectiveKind && e.objective && " — "}
          {e.objective}
        </p>
      )}
      <div className="mt-auto text-[12.5px] text-fg-faint tabular-nums" data-testid="event-card-counts">
        {t("events.card.counts", { targets: summary.targets, met: summary.met, followUps: summary.openFollowUps })}
      </div>
    </Link>
  );
}

export function attentionText(locale: Locale, reason: AttentionReason, s: EventSummary): string {
  const t = createTranslator(locale);
  const count = reason === "past_open_follow_ups" ? s.openFollowUps : reason === "missed_high_priority" ? s.missedHigh : reason === "outcome_not_recorded" ? s.notRecorded : 0;
  return t(`events.attention.${reason}`, { count });
}

export function PrivateLabel({ locale }: { locale: Locale }) {
  return <Badge tone="outline">{createTranslator(locale)("events.prep.privateLabel")}</Badge>;
}

export function PublicLabel({ locale }: { locale: Locale }) {
  return <Badge tone="outline">{createTranslator(locale)("events.prep.publicLabel")}</Badge>;
}

export function questionText(locale: Locale, q: PrepQuestion): string {
  const t = createTranslator(locale);
  switch (q.kind) {
    case "identify_contact":
      return t("events.prep.questions.identify_contact");
    case "meet_contact":
      return t("events.prep.questions.meet_contact", { name: q.name, role: q.role ? ` (${q.role})` : "" });
    case "validate":
      return t("events.prep.questions.validate", { question: q.question });
    case "signal":
      return t("events.prep.questions.signal", { headline: q.headline });
    case "open_follow_up":
      return t("events.prep.questions.open_follow_up", { title: q.title });
    case "previous_next_step":
      return t("events.prep.questions.previous_next_step", { step: q.step });
  }
}

/**
 * The deterministic preparation for one target. Questions carry where they
 * come from (private record, public signal, or an inference to validate);
 * unknowns are listed explicitly. Private note texts are shown only in the
 * blocks labeled private, never as public evidence.
 */
export function PreparationView({
  locale,
  prep,
  suggestion,
  priority,
}: {
  locale: Locale;
  prep: Preparation;
  suggestion: { priority: TargetPriority; factors: PriorityFactor[] };
  priority: TargetPriority;
}) {
  const t = createTranslator(locale);
  return (
    <div className="space-y-5 px-5 pb-5 text-[13.5px]" data-testid="preparation">
      <section data-testid="prep-why">
        <h3 className="flex items-center gap-2 text-[12px] font-medium text-fg-faint">
          {t("events.prep.whyTitle")} <PrivateLabel locale={locale} />
        </h3>
        <p className={cx("mt-1 whitespace-pre-line", prep.why ? "text-fg" : "text-fg-faint")}>{prep.why || t("events.targets.noReason")}</p>
      </section>

      <section data-testid="prep-questions">
        <h3 className="text-[12px] font-medium text-fg-faint">{t("events.prep.askTitle")}</h3>
        <ul className="mt-1.5 space-y-1.5">
          {prep.questions.map((q, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2" data-kind={q.kind}>
              <span className="text-fg">{questionText(locale, q)}</span>
              <span className="text-[11.5px] text-fg-faint">· {t(`events.prep.sources.${q.kind}`)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[12px] text-fg-faint">{t("events.prep.askNote")}</p>
      </section>

      {prep.unknowns.length > 0 && (
        <section data-testid="prep-unknowns">
          <h3 className="text-[12px] font-medium text-fg-faint">{t("events.prep.unknownTitle")}</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-fg-muted">
            {prep.unknowns.map((u) => (
              <li key={u}>{t(`events.prep.unknowns.${u}`)}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-edge bg-subtle/60 px-4 py-3" data-testid="prep-priority">
        <div className="text-[13px] font-medium text-fg">{t("events.prep.yourPriority", { priority: t(`events.priorities.${priority}`) })}</div>
        <div className="mt-1 text-[13px] text-fg-muted">
          {t("events.prep.suggestion", { priority: t(`events.priorities.${suggestion.priority}`) })} — {t("events.prep.suggestionBecause")} {suggestion.factors.map((f) => t(`events.prep.factors.${f}`)).join(", ")}.
        </div>
        <p className="mt-1 text-[11.5px] text-fg-faint">{t("events.prep.suggestionNote")}</p>
      </section>
    </div>
  );
}

/** "Since {date}" helper for the relationship block. */
export function sinceText(locale: Locale, at: string): string {
  return formatDay(at, locale);
}
