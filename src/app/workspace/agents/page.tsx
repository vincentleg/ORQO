import { AgentCard, AgentHierarchy, RunsTable } from "@/components/orqo/agents";
import { Card, Page, PageHeader, Section } from "@/components/orqo/ui";
import { AGENT_ORDER, AGENT_REGISTRY } from "@/lib/agents/registry";
import { createTranslator } from "@/lib/i18n/translate";
import { agentCatalogAccess } from "@/lib/server/agents/gate";
import { listRuns } from "@/lib/server/agents/repository";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * Agents — the registry's organization and catalog, with each agent's real
 * execution state for this workspace (server-determined: plan, operator
 * preview, role, availability), and the workspace's recent runs. Locked and
 * coming-soon agents stay visible and truthful; execution is re-authorized
 * by the API on every request.
 */
export default async function AgentsPage() {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const [access, runs] = await Promise.all([agentCatalogAccess(active.organizationId, active.role), listRuns(db, active.organizationId, { limit: 10 })]);
  const preview = Object.values(access).some((a) => a.state === "executable" && a.via === "preview");
  return (
    <Page>
      <PageHeader title={t("agents.title")} description={t("agents.description")} />
      {preview && (
        <p className="mb-6 rounded-lg bg-caution-soft px-4 py-3 text-[13px] text-caution" data-testid="agent-preview-note">
          {t("agents.previewNote")}
        </p>
      )}

      <Section title={t("agents.hierarchyTitle")} description={t("agents.hierarchyBody")}>
        <Card className="p-5">
          <AgentHierarchy locale={locale} />
        </Card>
      </Section>

      <Section title={t("agents.catalogTitle")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="agent-catalog">
          {AGENT_ORDER.map((id) => (
            <AgentCard key={id} agent={AGENT_REGISTRY[id]} access={access[id]} locale={locale} />
          ))}
        </div>
      </Section>

      <Section title={t("agents.runs.title")} description={t("agents.missionsBody")}>
        <Card>
          <RunsTable runs={runs} locale={locale} />
        </Card>
      </Section>
    </Page>
  );
}
