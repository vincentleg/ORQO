import { FeatureCard } from "@/components/orqo/plan";
import { Card, EmptyState, Page, PageHeader, Section } from "@/components/orqo/ui";
import { AGENTS, type AgentTier } from "@/lib/entitlements/agents";
import { createTranslator } from "@/lib/i18n/translate";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const TIERS: AgentTier[] = ["orchestrator", "manager", "specialist"];

/**
 * Agents — catalog and organization of specialized business agents.
 * Presentation only: no agent executes and no model is called. Premium agents
 * are visible but locked; unlocked ones are marked "coming soon".
 */
export default async function AgentsPage() {
  const { locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  return (
    <Page>
      <PageHeader title={t("agents.title")} description={t("agents.description")} />

      <Section title={t("agents.hierarchyTitle")} description={t("agents.hierarchyBody")}>
        <Card className="p-5">
          <ol className="flex flex-col items-center gap-2 text-center">
            {TIERS.map((tier, i) => (
              <li key={tier} className="flex flex-col items-center gap-2">
                <span className="rounded-lg border border-edge bg-subtle px-4 py-2">
                  <span className="block text-[13.5px] font-semibold text-fg">{t(`agents.tiers.${tier}`)}</span>
                  <span className="block text-[12.5px] text-fg-muted">
                    {AGENTS.filter((a) => a.tier === tier)
                      .map((a) => t(`agents.items.${a.key}.name`))
                      .join(" · ")}
                  </span>
                </span>
                {i < TIERS.length - 1 && <span aria-hidden className="h-4 w-px bg-edge-strong" />}
              </li>
            ))}
          </ol>
        </Card>
      </Section>

      <Section title={t("agents.catalogTitle")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="agent-catalog">
          {AGENTS.map((a) => (
            <FeatureCard key={a.key} plan={plan} feature={a.feature} title={t(`agents.items.${a.key}.name`)} body={t(`agents.items.${a.key}.purpose`)} icon="agents" locale={locale} />
          ))}
        </div>
      </Section>

      <Section title={t("agents.missionsTitle")}>
        <Card>
          <EmptyState icon="agents" title={t("agents.missionsTitle")} body={t("agents.missionsBody")} />
        </Card>
      </Section>
    </Page>
  );
}
