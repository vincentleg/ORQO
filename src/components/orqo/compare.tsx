/**
 * Side-by-side comparison (Nov 2026), rendered from compareCompanies(dossier). Read-only, no hooks: used by the
 * company page (server) and by the public guided tour (client, with progressive `reveal`).
 */
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { conceptLabel } from "@/lib/intelligence/concepts";
import { compareCompanies, type CompareCell, type CompareRow } from "@/lib/understanding/compare";
import type { Dossier } from "@/lib/understanding/dossier";
import { Badge, Card, CardHeader, cx } from "./ui";

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function CellView({ c, facet, locale }: { c: CompareCell; facet: CompareRow["facet"]; locale: Locale }) {
  const t = createTranslator(locale);
  if (c.values.length === 0) return <span className="text-[13px] text-fg-faint">{t("compare.unknown")}</span>;
  return (
    <ul className="space-y-1">
      {c.values.map((v) => (
        <li key={v} className="text-[13.5px] leading-snug text-fg">
          {c.kind === "dimension" ? t(`understanding.values.${facet}.${v}` as MessageKey) : clip(v)}
        </li>
      ))}
      {c.state && c.state !== "fact" && <li className="text-[11.5px] text-fg-faint">{t(`compare.state.${c.state}` as MessageKey)}</li>}
    </ul>
  );
}

export function CompanyComparison({ dossier, locale, reveal, highlight }: { dossier: Dossier; locale: Locale; reveal?: number; highlight?: CompareRow["link"] | null }) {
  const t = createTranslator(locale);
  const rows = compareCompanies(dossier);
  return (
    <Card data-testid="company-comparison">
      <CardHeader title={t("compare.title")} description={t("compare.description")} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-b border-edge text-[12px] font-medium text-fg-muted">
              <th className="w-[22%] px-5 py-2 font-medium">{t("compare.aspect")}</th>
              <th className="w-[34%] px-3 py-2 font-medium" data-tour="compare-own">{dossier.ownName}</th>
              <th className="w-[34%] px-3 py-2 font-medium" data-tour="compare-target">{dossier.targetName}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const hidden = reveal !== undefined && i >= reveal;
              const lit = highlight && r.link === highlight;
              return (
                <tr
                  key={r.facet}
                  data-compare-row={r.facet}
                  data-link={r.link}
                  aria-hidden={hidden || undefined}
                  className={cx("border-b border-edge align-top transition-all duration-500 last:border-0", hidden && "opacity-0", lit && "bg-brand-soft/60")}
                >
                  <th scope="row" className="px-5 py-3 text-[13px] font-medium text-fg-muted">
                    {t(`understanding.facets.${r.facet}` as MessageKey)}
                  </th>
                  <td className="px-3 py-3">
                    <CellView c={r.own} facet={r.facet} locale={locale} />
                  </td>
                  <td className="px-3 py-3">
                    <CellView c={r.target} facet={r.facet} locale={locale} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    {r.link !== "neutral" && (
                      <Badge tone={r.link === "complement" ? "positive" : "brand"}>
                        {r.link === "shared" && r.sharedConcepts.length > 0 ? t("compare.sharedWith", { concepts: r.sharedConcepts.map((k) => conceptLabel(k, locale)).join(", ") }) : t(`compare.link.${r.link}` as MessageKey)}
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
