import { OwnCompanyForm } from "@/components/saas/forms";
import { Card, CardHeader, Monogram, Page, PageHeader } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { listCompanies } from "@/lib/server/repositories/companies";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/** Company profile — the organization's own company, the reference for every comparison. */
export default async function CompanyPage() {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const own = (await listCompanies(db, active.organizationId)).find((c) => c.is_own_company) ?? null;

  return (
    <Page width="narrow">
      <PageHeader title={t("company.title")} description={t("company.description")} />
      {own ? (
        <Card data-testid="own-company">
          <div className="flex items-center gap-4 border-b border-edge px-5 py-5">
            <Monogram name={own.name} size={44} />
            <div className="min-w-0">
              <h2 className="truncate text-[18px] font-semibold text-fg">{own.name}</h2>
              {own.tagline && <p className="text-[13.5px] text-fg-muted">{own.tagline}</p>}
            </div>
          </div>
          <dl className="divide-y divide-edge text-[13.5px]">
            {(
              [
                ["company.fields.website", own.website],
                ["company.fields.summary", own.summary],
                ["company.fields.markets", own.markets.join(", ")],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[160px_1fr]">
                <dt className="text-fg-muted">{t(label)}</dt>
                <dd className={value ? "text-fg" : "text-fg-faint"}>{value || t("company.notSet")}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-edge bg-subtle/50 px-5 py-3 text-[12.5px] text-fg-muted">{t("company.moreSoon")}</p>
        </Card>
      ) : (
        <Card>
          <CardHeader title={t("company.emptyTitle")} description={t("company.emptyBody")} />
          <div className="px-5 py-5">
            {roleAtLeast(active.role, "member") ? <OwnCompanyForm locale={locale} organizationId={active.organizationId} /> : <p className="text-[13px] text-fg-faint">{t("workspace.viewerReadOnly")}</p>}
          </div>
        </Card>
      )}
    </Page>
  );
}
