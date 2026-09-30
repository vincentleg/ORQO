import { Badge, Button, Card, Page, PageHeader, cx } from "@/components/orqo/ui";
import { PLAN_COMPARISON, PLAN_COMPARISON_ROWS, PLANS, type CapabilityLevel } from "@/lib/entitlements/plans";
import { createTranslator } from "@/lib/i18n/translate";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const LEVEL_TONE: Record<CapabilityLevel, string> = {
  none: "text-fg-faint",
  essentials: "text-fg",
  limited: "text-fg",
  included: "text-fg",
  expanded: "text-brand",
  advanced: "text-brand",
};

/**
 * Plans — capability comparison, the destination of every upgrade CTA.
 * No prices, no allowances, no checkout: billing does not exist yet and this
 * page never changes a plan.
 */
export default async function PlansPage() {
  const { locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  return (
    <Page>
      <PageHeader title={t("plans.title")} description={t("plans.description")} />

      <div className="grid gap-4 md:grid-cols-3" data-testid="plan-cards">
        {PLANS.map((p) => {
          const current = p === plan;
          return (
            <Card key={p} className={cx("flex flex-col p-5", current && "ring-2 ring-brand/40")} aria-current={current ? "true" : undefined}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[18px] font-semibold text-fg">{t(`plans.${p}`)}</h2>
                {current && <Badge tone="brand">{t("plans.current")}</Badge>}
              </div>
              <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-fg-muted">{t(`plans.taglines.${p}`)}</p>
              <div className="mt-5">
                {current ? (
                  <Button className="w-full" disabled>
                    {t("plans.current")}
                  </Button>
                ) : (
                  <Button className="w-full" variant="primary" disabled aria-describedby="pricing-note">
                    {t("plans.upgradesSoon")}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <p id="pricing-note" className="rounded-lg bg-subtle px-4 py-3 text-[13px] text-fg-muted">
        {t("plans.pricingNote")} {t("plans.usageNote")}
      </p>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13.5px]">
          <caption className="sr-only">{t("plans.title")}</caption>
          <thead>
            <tr className="border-b border-edge">
              <th scope="col" className="px-5 py-3 font-medium text-fg-muted">
                {t("plans.capability")}
              </th>
              {PLANS.map((p) => (
                <th key={p} scope="col" className={cx("px-5 py-3 font-semibold", p === plan ? "text-brand" : "text-fg")}>
                  {t(`plans.${p}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {PLAN_COMPARISON_ROWS.map((row) => (
              <tr key={row}>
                <th scope="row" className="px-5 py-3 font-medium text-fg">
                  {t(`plans.rows.${row}`)}
                </th>
                {PLANS.map((p) => {
                  const level = PLAN_COMPARISON[row][p];
                  return (
                    <td key={p} className={cx("px-5 py-3", LEVEL_TONE[level])}>
                      {level === "none" ? <span aria-label={t("plans.levels.none")}>—</span> : t(`plans.levels.${level}`)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
