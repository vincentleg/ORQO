import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { Icon } from "./icons";
import { Badge, Button, cx, focusRing } from "./ui";

/**
 * Explicit run controls for agent-powered spaces (Refresh, Find more…) with
 * last-run and status. Phase 2 renders the pattern in its "never run,
 * unavailable" state: buttons are disabled and say why. Nothing executes.
 */
export function RunControls({ locale, actions }: { locale: Locale; actions: MessageKey[] }) {
  const t = createTranslator(locale);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface px-4 py-3 shadow-card">
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
        <div className="flex items-center gap-1.5">
          <dt className="text-fg-faint">{t("run.lastRun")}</dt>
          <dd className="font-medium text-fg">{t("run.never")}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-fg-faint">{t("run.status")}</dt>
          <dd>
            <Badge tone="neutral">{t("run.idle")}</Badge>
          </dd>
        </div>
      </dl>
      <div className="flex items-center gap-2">
        <span id="run-unavailable" className="hidden text-[12px] text-fg-faint lg:inline">
          {t("run.unavailable")}
        </span>
        {actions.map((a, i) => (
          <Button key={a} size="sm" variant={i === 0 ? "secondary" : "ghost"} disabled aria-describedby="run-unavailable" title={t("run.unavailable")}>
            {i === 0 && <Icon name="refresh" size={14} />}
            {t(a)}
          </Button>
        ))}
      </div>
    </div>
  );
}

const EPISTEMIC = [
  ["evidence.fact", "evidence.factBody", "bg-positive"],
  ["evidence.inference", "evidence.inferenceBody", "bg-brand"],
  ["evidence.assumption", "evidence.assumptionBody", "bg-caution"],
  ["evidence.unknown", "evidence.unknownBody", "bg-fg-faint"],
] as const satisfies readonly (readonly [MessageKey, MessageKey, string])[];

/** FACT / INFERENCE / ASSUMPTION / UNKNOWN legend — the explainability contract of every analysis. */
export function EvidenceLegend({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <div>
      <h3 className="text-[13.5px] font-semibold text-fg">{t("evidence.title")}</h3>
      <p className="mt-0.5 text-[13px] text-fg-muted">{t("evidence.body")}</p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {EPISTEMIC.map(([label, body, dot]) => (
          <div key={label} className="flex items-start gap-2.5 rounded-lg bg-subtle px-3 py-2.5">
            <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
            <div>
              <dt className="text-[12.5px] font-semibold uppercase tracking-wide text-fg">{t(label)}</dt>
              <dd className="text-[12.5px] text-fg-muted">{t(body)}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** "What should I do next?" — one clear, deterministic suggestion with a link. */
export function NextBestAction({ locale, title, body, href }: { locale: Locale; title: string; body: string; href: string }) {
  const t = createTranslator(locale);
  return (
    <Link href={href} className={cx("group flex items-center gap-4 rounded-xl border border-brand/25 bg-brand-soft/60 px-5 py-4 transition-colors hover:bg-brand-soft", focusRing)} data-testid="next-best-action">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-brand shadow-card">
        <Icon name="arrow" size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold uppercase tracking-wide text-brand">{t("nextAction.title")}</span>
        <span className="mt-0.5 block text-[15px] font-semibold text-fg">{title}</span>
        <span className="block text-[13px] text-fg-muted">{body}</span>
      </span>
      <span className="hidden text-[13px] font-medium text-brand group-hover:underline sm:inline">{t("nextAction.go")} →</span>
    </Link>
  );
}
