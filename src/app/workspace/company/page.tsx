import { OwnCompanyForm, OwnProfileEditForm } from "@/components/saas/forms";
import { Badge, Card, CardHeader, Monogram, Page, PageHeader } from "@/components/orqo/ui";
import { ownProfileGaps } from "@/lib/intelligence/relevance";
import { createTranslator } from "@/lib/i18n/translate";
import { getOwnCompanyProfile, toOwnContext } from "@/lib/server/repositories/companies";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/** Company profile — the organization's own company, the reference for every comparison. */
export default async function CompanyPage() {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const own = await getOwnCompanyProfile(db, active.organizationId);
  const canWrite = roleAtLeast(active.role, "member");

  if (!own) {
    return (
      <Page width="narrow">
        <PageHeader title={t("company.title")} description={t("company.description")} />
        <Card>
          <CardHeader title={t("company.emptyTitle")} description={t("company.emptyBody")} />
          <div className="px-5 py-5">{canWrite ? <OwnCompanyForm locale={locale} organizationId={active.organizationId} /> : <p className="text-[13px] text-fg-faint">{t("workspace.viewerReadOnly")}</p>}</div>
        </Card>
      </Page>
    );
  }

  const ctx = toOwnContext(own);
  const gaps = ownProfileGaps(ctx);
  const rows = [
    ["company.fields.website", own.website ?? ""],
    ["company.fields.summary", own.summary],
    ["company.fields.offerings", own.offerings.join(", ")],
    ["company.fields.customerSegments", own.customer_segments.join(", ")],
    ["company.fields.markets", own.markets.join(", ")],
    ["company.fields.geographies", own.geographies.join(", ")],
    ["company.fields.soughtCapabilities", own.sought_capabilities.join(", ")],
    ["company.fields.partnershipGoals", own.partnership_goals.map((g) => t(`analysis.relationships.${g}`)).join(", ")],
  ] as const;

  return (
    <Page width="narrow">
      <PageHeader title={t("company.title")} description={t("company.description")} />
      <Card data-testid="own-company">
        <div className="flex items-center gap-4 border-b border-edge px-5 py-5">
          <Monogram name={own.name} size={44} />
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold text-fg">{own.name}</h2>
          </div>
        </div>
        <dl className="divide-y divide-edge text-[13.5px]">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr]">
              <dt className="text-fg-muted">{t(label)}</dt>
              <dd className={value ? "text-fg" : "text-fg-faint"}>{value || t("company.notSet")}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-edge bg-subtle/50 px-5 py-3 text-[12.5px] text-fg-muted">
          <p>{t("company.moreSoon")}</p>
          {gaps.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {gaps.map((g) => (
                <li key={g}>
                  <Badge tone="caution">{t(`analysis.ownGaps.${g}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      {canWrite && (
        <Card>
          <CardHeader title={t("company.edit")} description={t("company.listHint")} />
          <div className="px-5 py-5">
            <OwnProfileEditForm
              locale={locale}
              organizationId={active.organizationId}
              values={{
                name: own.name,
                website: own.website,
                summary: own.summary,
                offerings: own.offerings,
                customerSegments: own.customer_segments,
                markets: own.markets,
                geographies: own.geographies,
                soughtCapabilities: own.sought_capabilities,
                partnershipGoals: own.partnership_goals,
              }}
            />
          </div>
        </Card>
      )}
    </Page>
  );
}
