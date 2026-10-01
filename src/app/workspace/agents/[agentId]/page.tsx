import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentOverview, AgentPermissionsCard } from "@/components/orqo/agent-organization";
import { RunsTable } from "@/components/orqo/agents";
import { DiscoverForm } from "@/components/orqo/discover-form";
import { MissionForm } from "@/components/orqo/mission-runner";
import { Card, cx, focusRing, Page, PageHeader, Section } from "@/components/orqo/ui";
import { getAgent } from "@/lib/agents/registry";
import { DISCOVERY_LIMITS } from "@/lib/discovery/types";
import { webSourceAvailability } from "@/lib/server/discovery/sources";
import { createTranslator } from "@/lib/i18n/translate";
import { agentCatalogAccess } from "@/lib/server/agents/gate";
import { listRuns } from "@/lib/server/agents/repository";
import { listCompanies } from "@/lib/server/repositories/companies";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * One agent (Phase 9): role, responsibilities, team position, real status and
 * autonomy ceiling, human-readable permissions, the mission entry point when
 * executable, and its real runs. The mission form is a convenience: the API
 * re-authorizes every mission.
 */
export default async function AgentPage({ params }: PageProps<"/workspace/agents/[agentId]">) {
  const { agentId } = await params;
  const agent = getAgent(agentId);
  if (!agent) notFound();
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const [access, runs] = await Promise.all([agentCatalogAccess(active.organizationId, active.role), listRuns(db, active.organizationId, { limit: 10, agentId: agent.id })]);
  const state = access[agent.id];
  const executable = state.state === "executable";
  const companies = executable ? (await listCompanies(db, active.organizationId)).filter((c) => !c.is_own_company).map((c) => ({ id: c.id, name: c.name })) : [];
  const name = t(`agents.items.${agent.id}.name`);

  return (
    <Page>
      <Link href="/workspace/agents" className={cx("mb-3 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
        ← {t("agents.run.back")}
      </Link>
      <PageHeader title={name} description={t(`agents.items.${agent.id}.purpose`)} />

      {executable && (
        <Card className="mt-6 p-5" data-testid="agent-mission">
          <h2 className="mb-4 text-[15px] font-semibold text-fg">{t("agents.form.title")}</h2>
          {state.via === "preview" && <p className="mb-4 rounded-lg bg-caution-soft px-4 py-2.5 text-[12.5px] text-caution">{t("agents.previewNote")}</p>}
          {agent.missionTypes.includes("discover_companies") ? (
            <>
              <p className="mb-4 text-[13px] leading-relaxed text-fg-muted">{t("agents.missionTypesBody.discover_companies")}</p>
              <DiscoverForm
                locale={locale}
                organizationId={active.organizationId}
                autonomy={agent.autonomy}
                web={await webSourceAvailability(active.organizationId)}
                limits={{ maxResults: DISCOVERY_LIMITS.maxResults, maxQueries: DISCOVERY_LIMITS.maxQueries, memoryDays: DISCOVERY_LIMITS.rejectionMemoryDays }}
                returnTo="run"
              />
            </>
          ) : (
            <MissionForm locale={locale} organizationId={active.organizationId} agentId={agent.id} agentName={name} missionTypes={agent.missionTypes.filter((m) => m !== "discover_companies")} autonomy={agent.autonomy} companies={companies} />
          )}
        </Card>
      )}
      {state.state === "role" && <p className="mt-4 text-[13px] text-fg-muted">{t("agents.roleBody")}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]" data-testid="agent-definition">
        <AgentOverview agent={agent} access={state} locale={locale} />
        <AgentPermissionsCard agent={agent} access={state} locale={locale} />
      </div>

      <Section title={t("agents.runs.title")}>
        <Card>
          <RunsTable runs={runs} locale={locale} showAgent={false} />
        </Card>
      </Section>
    </Page>
  );
}
