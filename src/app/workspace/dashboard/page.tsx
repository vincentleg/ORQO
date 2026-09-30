import { NextBestAction } from "@/components/orqo/patterns";
import { Card, CardHeader, Page, PageHeader, Stat } from "@/components/orqo/ui";
import type { MessageKey } from "@/lib/i18n/translate";
import { createTranslator } from "@/lib/i18n/translate";
import { listCompanies } from "@/lib/server/repositories/companies";
import { countWorkspaceRecords } from "@/lib/server/repositories/overview";
import { listMembers } from "@/lib/server/repositories/tenancy";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const SECTIONS = [
  ["dashboard.sections.opportunities", "dashboard.sections.opportunitiesEmpty"],
  ["dashboard.sections.followUps", "dashboard.sections.followUpsEmpty"],
  ["dashboard.sections.signals", "dashboard.sections.signalsEmpty"],
  ["dashboard.sections.agentActivity", "dashboard.sections.agentActivityEmpty"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

/** Dashboard — secondary overview. Every number is a real count of this workspace's records. */
export default async function DashboardPage() {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const [counts, companies, members] = await Promise.all([countWorkspaceRecords(db, active.organizationId), listCompanies(db, active.organizationId), listMembers(db, active.organizationId)]);
  const hasOwn = companies.some((c) => c.is_own_company);
  const hasNetwork = companies.some((c) => !c.is_own_company);

  // Deterministic next step derived from real workspace state; no model involved.
  const next = !hasOwn
    ? { title: t("nextAction.profileTitle"), body: t("nextAction.profileBody"), href: "/workspace/company" }
    : !hasNetwork
      ? { title: t("nextAction.networkTitle"), body: t("nextAction.networkBody"), href: "/workspace/network" }
      : { title: t("nextAction.searchTitle"), body: t("nextAction.searchBody"), href: "/workspace" };

  return (
    <Page>
      <PageHeader title={t("dashboard.title")} description={t("dashboard.description")} />
      <NextBestAction locale={locale} {...next} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t("dashboard.stats.companies")} value={counts.companies} />
        <Stat label={t("dashboard.stats.relationships")} value={counts.relationships} />
        <Stat label={t("dashboard.stats.opportunities")} value={counts.opportunities} />
        <Stat label={t("dashboard.stats.members")} value={members.length} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map(([title, empty]) => (
          <Card key={title}>
            <CardHeader title={t(title)} />
            <p className="px-5 py-6 text-[13.5px] text-fg-muted">{t(empty)}</p>
          </Card>
        ))}
      </div>
    </Page>
  );
}
