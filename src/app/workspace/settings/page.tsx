import { LocaleForm } from "@/components/saas/forms";
import { PLANS_HREF, PlanBadge } from "@/components/orqo/plan";
import { Badge, ButtonLink, Card, CardHeader, ListRow, Page, PageHeader } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { listMembers } from "@/lib/server/repositories/tenancy";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/** Settings — account (language), workspace (role, members) and the presented plan. */
export default async function SettingsPage() {
  const { db, user, active, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const members = await listMembers(db, active.organizationId);

  return (
    <Page width="narrow">
      <PageHeader title={t("settings.title")} description={t("settings.description")} />

      <Card>
        <CardHeader title={t("settings.account")} />
        <div className="space-y-4 px-5 py-5">
          <div className="text-[13.5px] text-fg-muted">{user.email}</div>
          <LocaleForm locale={locale} />
        </div>
      </Card>

      <Card>
        <CardHeader title={t("settings.workspace")} description={t("workspace.yourRole", { role: t(`roles.${active.role}`) })} />
        <div className="px-5 pt-4 text-[13px] font-medium text-fg-muted">{t("workspace.members")}</div>
        <ul className="divide-y divide-edge" data-testid="member-list">
          {members.map((m) => (
            <ListRow key={m.userId} title={m.displayName ?? (m.userId === user.id ? user.email : "—")} trailing={<Badge tone="outline">{t(`roles.${m.role}`)}</Badge>} />
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title={t("settings.plan")}
          description={t("plans.yourPlan", { plan: t(`plans.${plan}`) })}
          action={
            <ButtonLink href={PLANS_HREF} size="sm">
              {t("plans.seePlans")}
            </ButtonLink>
          }
        />
        <div className="px-5 py-4">
          <PlanBadge plan={plan} locale={locale} />
        </div>
      </Card>
    </Page>
  );
}
