import { DelegateMission, type DelegatePrefill } from "@/components/orqo/mission-delegate";
import { missionItems, MissionList } from "@/components/orqo/missions";
import { Card, EmptyState, Page, PageHeader, Section } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { MISSION_TEMPLATES, type MissionTemplateId } from "@/lib/missions/types";
import { agentCatalogAccess } from "@/lib/server/agents/gate";
import { listMissions } from "@/lib/server/missions/repository";
import { listCompanies } from "@/lib/server/repositories/companies";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * Missions (Phase 17C): delegate work to ORQO and follow it. The form only collects the mission; the API
 * re-checks role, entitlement and input. Nothing runs from this page: work starts on the mission page.
 */
export default async function MissionsPage({ searchParams }: PageProps<"/workspace/missions">) {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const params = await searchParams;
  const canWrite = roleAtLeast(active.role, "member");
  const [access, rows, companies] = await Promise.all([agentCatalogAccess(active.organizationId, active.role), listMissions(db, active.organizationId, 30), listCompanies(db, active.organizationId)]);
  const network = companies.filter((c) => !c.is_own_company).map((c) => ({ id: c.id, name: c.name }));
  const names = Object.fromEntries(network.map((c) => [c.id, c.name]));
  const locked = !canWrite ? ("role" as const) : access.research.state !== "executable" || access.prospecting.state !== "executable" ? ("plan" as const) : null;
  const requested = one(params.template, 40);
  const prefill: DelegatePrefill = {
    template: (MISSION_TEMPLATES as readonly string[]).includes(requested ?? "") ? (requested as MissionTemplateId) : undefined,
    target: one(params.target, 200),
    company: one(params.company, 36),
    intent: one(params.intent, 40),
    objective: one(params.objective, 200),
    market: one(params.market, 60),
    geography: one(params.geography, 60),
  };
  const items = missionItems(rows, t, names);
  const activeItems = items.filter((m) => m.status === "planned" || m.status === "running");
  const recent = items.filter((m) => m.status !== "planned" && m.status !== "running");

  return (
    <Page>
      <PageHeader title={t("missions.title")} description={t("missions.description")} />

      {activeItems.length > 0 && (
        <Section title={t("missions.list.active")}>
          <Card>
            <MissionList items={activeItems} locale={locale} testId="missions-active" />
          </Card>
        </Section>
      )}

      <div id="delegate" className="scroll-mt-6">
        <Section title={t("missions.delegate.title")}>
          <Card className="p-5 md:p-6">
            <DelegateMission locale={locale} organizationId={active.organizationId} companies={network} locked={locked} prefill={prefill} />
          </Card>
        </Section>
      </div>

      <Section title={t("missions.list.recent")}>
        <Card>{recent.length ? <MissionList items={recent} locale={locale} testId="missions-recent" /> : <EmptyState icon="missions" title={t("missions.list.emptyTitle")} body={t("missions.list.emptyBody")} />}</Card>
      </Section>
    </Page>
  );
}
