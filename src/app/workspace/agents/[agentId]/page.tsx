import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentCard, autonomyLabel, RunsTable } from "@/components/orqo/agents";
import { MissionForm } from "@/components/orqo/mission-runner";
import { Card, cx, focusRing, Page, PageHeader, Section } from "@/components/orqo/ui";
import { getAgent, requiredPlan } from "@/lib/agents/registry";
import { TOOLS } from "@/lib/agents/tools";
import { createTranslator } from "@/lib/i18n/translate";
import { agentCatalogAccess } from "@/lib/server/agents/gate";
import { listRuns } from "@/lib/server/agents/repository";
import { listCompanies } from "@/lib/server/repositories/companies";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/** One agent: its governed definition (capabilities, tools, autonomy, plan), the mission entry point when executable, and its runs. */
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

      {executable ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <Card className="p-5">
            <h2 className="mb-4 text-[15px] font-semibold text-fg">{t("agents.form.title")}</h2>
            <MissionForm locale={locale} organizationId={active.organizationId} agentId={agent.id} agentName={name} missionTypes={[...agent.missionTypes]} autonomy={agent.autonomy} companies={companies} />
          </Card>
          <Card className="p-5 text-[13px]" data-testid="agent-definition">
            <dl className="space-y-3">
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.labels.capabilities")}</dt>
                <dd className="mt-1 text-fg">{agent.capabilities.map((c) => t(`agents.capabilities.${c}`)).join(" · ")}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.labels.tools")}</dt>
                <dd className="mt-1">
                  <ul className="space-y-1">
                    {agent.tools.map((tool) => (
                      <li key={tool} className="text-fg">
                        {t(`agents.tools.${tool}`)} <span className="text-fg-faint">· {t(`agents.costClass.${TOOLS[tool].costClass}`)}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.labels.autonomy")}</dt>
                <dd className="mt-1 text-fg">{t("agents.autonomyRange", { min: autonomyLabel(t, agent.autonomy.min), max: autonomyLabel(t, agent.autonomy.max) })}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.labels.plan")}</dt>
                <dd className="mt-1 text-fg">
                  {t(`plans.${requiredPlan(agent)}`)}
                  {state.via === "preview" && <span className="text-caution"> · {t("agents.access.preview")}</span>}
                </dd>
              </div>
              {agent.parent && (
                <div>
                  <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.labels.reportsTo")}</dt>
                  <dd className="mt-1 text-fg">{t(`agents.items.${agent.parent}.name`)}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      ) : (
        <div className="max-w-md">
          <AgentCard agent={agent} access={state} locale={locale} />
          {state.state === "role" && <p className="mt-3 text-[13px] text-fg-muted">{t("agents.roleBody")}</p>}
        </div>
      )}

      <Section title={t("agents.runs.title")}>
        <Card>
          <RunsTable runs={runs} locale={locale} showAgent={false} />
        </Card>
      </Section>
    </Page>
  );
}
