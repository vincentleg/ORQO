/**
 * Internal workforce budget (Phase 17A): visible to Internal workspaces only. Minimal and read-only:
 * the configured ceiling, what is committed (settled + reserved), what remains, and recent provider calls.
 * Not a billing dashboard; normal users never see provider cost details.
 */
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import type { SpendSummary } from "@/lib/server/governance/ledger";
import { formatDate } from "./analysis";
import { Badge, Card, CardHeader } from "./ui";

const usd = (n: number, locale: Locale) => new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);

export function InternalUsageCard({ summary, ceilingUsd, killed, locale }: { summary: SpendSummary; ceilingUsd: number | null; killed: boolean; locale: Locale }) {
  const t = createTranslator(locale);
  const remaining = ceilingUsd === null ? null : Math.max(0, ceilingUsd - summary.committedUsd);
  const rows: [string, string][] = [
    [t("settings.internal.ceiling", { days: summary.windowDays }), ceilingUsd === null ? "—" : usd(ceilingUsd, locale)],
    [t("settings.internal.committed"), usd(summary.committedUsd, locale)],
    [t("settings.internal.settled"), usd(summary.settledUsd, locale)],
    [t("settings.internal.reserved"), usd(summary.reservedUsd, locale)],
    [t("settings.internal.remaining"), remaining === null ? "—" : usd(remaining, locale)],
    [t("settings.internal.calls"), String(summary.calls)],
    [t("settings.internal.unknownCost"), String(summary.unknownCostCalls)],
  ];
  return (
    <Card data-testid="internal-usage">
      <CardHeader title={t("settings.internal.title")} description={t("settings.internal.description")} />
      <div className="space-y-4 px-5 py-5 text-[14px]">
        {ceilingUsd === null && <p className="rounded-lg bg-caution-soft px-4 py-3 text-caution">{t("settings.internal.notConfigured")}</p>}
        {killed && <p className="rounded-lg bg-subtle px-4 py-3 text-fg-muted">{t("settings.internal.killSwitch")}</p>}
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[1fr_auto]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="font-medium text-fg tabular-nums sm:text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h3 className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">{t("settings.internal.recent")}</h3>
          {summary.recent.length === 0 ? (
            <p className="mt-1 text-fg-muted">{t("settings.internal.empty")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-edge">
              {summary.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-[13.5px]">
                  <span className="min-w-0 text-fg">
                    {r.provider} · {r.task}
                    {r.model && <span className="text-fg-muted"> · {r.model}</span>}
                  </span>
                  <span className="flex items-center gap-2 text-fg-muted tabular-nums">
                    {usd(r.status === "reserved" ? r.reserved_usd : (r.settled_usd ?? 0), locale)}
                    <Badge tone={r.status === "reserved" ? "caution" : "neutral"}>{t(`settings.internal.status.${r.status}`)}</Badge>
                    <span className="text-[12.5px]">{formatDate(r.created_at, locale)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
