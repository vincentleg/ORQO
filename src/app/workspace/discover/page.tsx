import { FeatureCard } from "@/components/orqo/plan";
import { RunControls } from "@/components/orqo/patterns";
import { Badge, Card, EmptyState, Page, PageHeader } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const CATEGORIES = ["companies", "people", "partners", "opportunities", "events"] as const;

/** Discover — what ORQO proactively finds. Shell only: no discovery runs and no external API is called. */
export default async function DiscoverPage() {
  const { locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  return (
    <Page>
      <PageHeader title={t("discover.title")} description={t("discover.description")} />
      <RunControls locale={locale} actions={["run.refresh", "run.findMore"]} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-edge px-5 py-3">
          {CATEGORIES.map((c) => (
            <Badge key={c} tone="outline">
              {t(`discover.categories.${c}`)}
            </Badge>
          ))}
        </div>
        <EmptyState icon="discover" title={t("discover.emptyTitle")} body={t("discover.emptyBody")} />
      </Card>
      <FeatureCard plan={plan} feature="discover.prospectingMissions" title={t("discover.prospectingTitle")} body={t("discover.prospectingBody")} icon="discover" locale={locale} />
    </Page>
  );
}
