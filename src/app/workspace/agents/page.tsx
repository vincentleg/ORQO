import { AgentOrganization, MissionPlanner, RunnableNow } from "@/components/orqo/agent-organization";
import { RunsTable } from "@/components/orqo/agents";
import { Card, Page, PageHeader, Section } from "@/components/orqo/ui";
import { isMissionTemplate, planMission } from "@/lib/agents/organization";
import { createTranslator } from "@/lib/i18n/translate";
import { agentCatalogAccess } from "@/lib/server/agents/gate";
import { listRuns } from "@/lib/server/agents/repository";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * Agents — the workspace's AI business development team (Phase 9): the
 * registry's organization with each agent's real state (server-determined:
 * plan, operator preview, role, availability), what can run today, a
 * deterministic mission planner (no model, no API, nothing runs) and the
 * workspace's real runs. Execution is re-authorized by the API on every request.
 */
export default async function AgentsPage({ searchParams }: PageProps<"/workspace/agents">) {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const [access, runs] = await Promise.all([agentCatalogAccess(active.organizationId, active.role), listRuns(db, active.organizationId, { limit: 10 })]);
  const preview = Object.values(access).some((a) => a.state === "executable" && a.via === "preview");
  const requested = (await searchParams).mission;
  const selected = isMissionTemplate(requested) ? requested : null;
  const plan = selected ? planMission(selected, access) : null;
  return (
    <Page>
      <PageHeader eyebrow={<span className="text-[12px] font-semibold uppercase tracking-wide text-brand">{t("agents.title")}</span>} title={t("agents.org.title")} description={t("agents.org.description")} />
      <p className="-mt-2 mb-5 text-[13px] text-fg-faint" data-testid="agent-truth-note">
        {t("agents.org.truth")}
      </p>
      {preview && (
        <p className="mb-6 rounded-lg bg-caution-soft px-4 py-3 text-[13px] text-caution" data-testid="agent-preview-note">
          {t("agents.previewNote")}
        </p>
      )}

      <Section title={t("agents.org.now.title")} description={t("agents.org.now.body")}>
        <Card>
          <RunnableNow access={access} locale={locale} />
        </Card>
      </Section>

      <Section title={t("agents.hierarchyTitle")} description={t("agents.hierarchyBody")}>
        <AgentOrganization access={access} locale={locale} />
      </Section>

      <div id="plan" className="scroll-mt-6">
        <Section title={t("agents.planner.title")} description={t("agents.planner.body")}>
          <Card className="p-5">
            <MissionPlanner plan={plan} selected={selected} locale={locale} />
          </Card>
        </Section>
      </div>

      <Section title={t("agents.runs.title")} description={t("agents.missionsBody")}>
        <Card>
          <RunsTable runs={runs} locale={locale} />
        </Card>
      </Section>
    </Page>
  );
}
