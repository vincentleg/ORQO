import { OwnCompanyForm, OwnProfileEditForm } from "@/components/saas/forms";
import { ResearchRunner } from "@/components/orqo/research-runner";
import { BusinessDnaCard, MarketModelCard, NextQuestionCard } from "@/components/orqo/understanding";
import { Card, CardHeader, Monogram, Page, PageHeader } from "@/components/orqo/ui";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { researchAvailability } from "@/lib/server/research/policy";
import { getOwnUnderstanding, withUnderstanding } from "@/lib/server/repositories/understanding";
import { toOwnContext } from "@/lib/server/repositories/companies";
import { websiteDomain } from "@/lib/search/query";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * Company profile — the organization's own company, the reference for every comparison. Phase 14: ORQO reads the
 * official website and shows its Business DNA and how its market works; people validate instead of typing.
 */
export default async function CompanyPage() {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const [current, availability] = await Promise.all([getOwnUnderstanding(db, active.organizationId), researchAvailability(db, active.organizationId, active.role)]);
  const own = current?.own ?? null;
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

  const { dna, market, nextQuestion } = current!.understanding;
  const ctx = withUnderstanding(toOwnContext(own), dna);
  const domain = own.website ? websiteDomain(own.website) : null;
  const basic = availability.basic;
  const analyze =
    canWrite && domain ? (
      <ResearchRunner locale={locale} organizationId={active.organizationId} query={domain} ownName={null} options={[{ mode: "basic", deniedKey: basic.state === "available" ? null : (`research.denied.${basic.reason}` as MessageKey) }]} refresh={dna.status === "analyzed"} />
    ) : !domain ? (
      <p className="text-[13px] text-fg-muted">{t("understanding.noWebsite")}</p>
    ) : null;
  const rows = [
    ["company.fields.website", own.website ?? ""],
    ["company.fields.summary", ctx.summary],
    ["company.fields.offerings", ctx.offerings.join(", ")],
    ["company.fields.customerSegments", ctx.customerSegments.join(", ")],
    ["company.fields.markets", own.markets.join(", ")],
    ["company.fields.geographies", ctx.geographies.join(", ")],
    ["company.fields.soughtCapabilities", own.sought_capabilities.join(", ")],
    ["company.fields.partnershipGoals", own.partnership_goals.map((g) => t(`analysis.relationships.${g}`)).join(", ")],
  ] as const;

  return (
    <Page width="narrow">
      <PageHeader title={t("company.title")} description={t("company.description")} />
      <Card data-testid="own-company">
        <div className="flex items-center gap-4 px-5 py-5">
          <Monogram name={own.name} size={44} />
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold text-fg">{own.name}</h2>
            {own.website && <p className="truncate text-[13px] text-fg-muted">{own.website.replace(/^https?:\/\//, "")}</p>}
          </div>
        </div>
      </Card>
      {canWrite && nextQuestion && <NextQuestionCard question={nextQuestion} locale={locale} organizationId={active.organizationId} />}
      <BusinessDnaCard dna={dna} locale={locale} organizationId={active.organizationId} canWrite={canWrite} action={analyze} />
      {dna.status === "analyzed" && <MarketModelCard market={market} locale={locale} />}
      <Card>
        <details data-testid="own-profile">
          <summary className="cursor-pointer list-none px-5 py-4">
            <span className="text-[15px] font-semibold text-fg">{t("understanding.manualTitle")}</span>
            <span className="mt-0.5 block text-[13px] text-fg-muted">{t("understanding.manualBody")}</span>
          </summary>
          <dl className="divide-y divide-edge border-t border-edge text-[13.5px]">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr]">
                <dt className="text-fg-muted">{t(label)}</dt>
                <dd className={value ? "text-fg" : "text-fg-faint"}>{value || t("company.notSet")}</dd>
              </div>
            ))}
          </dl>
        </details>
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
