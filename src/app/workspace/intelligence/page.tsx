import { Fragment } from "react";
import { Icon } from "@/components/orqo/icons";
import { RunControls } from "@/components/orqo/patterns";
import { FeatureCard } from "@/components/orqo/plan";
import { Card, EmptyState, Page, PageHeader, Section } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const CHAIN = ["change", "signal", "reevaluation", "opportunity", "action"] as const;

/** Intelligence — market changes and signals. Shell only: no live intelligence is fetched or fabricated. */
export default async function IntelligencePage() {
  const { locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  return (
    <Page>
      <PageHeader title={t("intelligence.title")} description={t("intelligence.description")} />
      <Section title={t("intelligence.chainTitle")} description={t("intelligence.chainBody")}>
        <ol className="flex flex-wrap items-center gap-2" aria-label={t("intelligence.chainTitle")}>
          {CHAIN.map((step, i) => (
            <Fragment key={step}>
              <li className="rounded-lg border border-edge bg-surface px-3 py-2 text-[13.5px] font-medium text-fg shadow-card">{t(`intelligence.chain.${step}`)}</li>
              {i < CHAIN.length - 1 && (
                <li aria-hidden className="text-fg-faint">
                  <Icon name="arrow" size={14} />
                </li>
              )}
            </Fragment>
          ))}
        </ol>
      </Section>
      <RunControls locale={locale} actions={["run.refresh"]} />
      <Card>
        <EmptyState icon="intelligence" title={t("intelligence.emptyTitle")} body={t("intelligence.emptyBody")} />
      </Card>
      <FeatureCard plan={plan} feature="intelligence.monitoring" title={t("intelligence.monitoringTitle")} body={t("intelligence.monitoringBody")} icon="intelligence" locale={locale} />
    </Page>
  );
}
