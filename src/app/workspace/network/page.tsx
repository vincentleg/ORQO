import { AddCompanyForm } from "@/components/saas/forms";
import { FeatureCard } from "@/components/orqo/plan";
import { Badge, Card, CardHeader, EmptyState, ListRow, Monogram, Page, PageHeader, Section } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { listCompanies } from "@/lib/server/repositories/companies";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/** Network — the organization's commercial memory. Companies are real, persisted, organization-scoped data. */
export default async function NetworkPage() {
  const { db, active, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const companies = await listCompanies(db, active.organizationId);
  const canWrite = roleAtLeast(active.role, "member");

  return (
    <Page>
      <PageHeader title={t("network.title")} description={t("network.description")} />
      <Card>
        <CardHeader title={t("network.companies")} action={<span className="text-[12.5px] text-fg-faint tabular-nums">{t("workspace.count", { count: companies.length })}</span>} />
        {companies.length === 0 ? (
          <p className="px-5 py-6 text-[13.5px] text-fg-muted">{t("network.empty")}</p>
        ) : (
          <ul className="divide-y divide-edge" data-testid="company-list">
            {companies.map((c) => (
              <ListRow key={c.id} leading={<Monogram name={c.name} />} title={c.name} meta={c.website ?? undefined} trailing={c.is_own_company ? <Badge tone="brand">{t("network.ownCompany")}</Badge> : undefined} />
            ))}
          </ul>
        )}
        <div className="border-t border-edge bg-subtle/50 px-5 py-4">
          {canWrite ? <AddCompanyForm locale={locale} organizationId={active.organizationId} /> : <p className="text-[13px] text-fg-faint">{t("workspace.viewerReadOnly")}</p>}
        </div>
      </Card>
      <Section title={t("network.relationshipsTitle")}>
        <Card>
          <EmptyState icon="network" title={t("network.memoryTitle")} body={t("network.relationshipsEmpty")} />
        </Card>
      </Section>
      <FeatureCard plan={plan} feature="agents.relationship" title={t("agents.items.relationship.name")} body={t("agents.items.relationship.purpose")} icon="agents" locale={locale} />
    </Page>
  );
}
