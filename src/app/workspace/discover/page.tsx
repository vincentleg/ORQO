import Link from "next/link";
import { RunStatusBadge, failureText, formatDuration } from "@/components/orqo/agents";
import { formatDate } from "@/components/orqo/analysis";
import { DiscoverForm } from "@/components/orqo/discover-form";
import { DiscoveryResultView, discoveryRunLabel } from "@/components/orqo/discovery-result";
import { FeatureCard } from "@/components/orqo/plan";
import { ButtonLink, Card, cx, focusRing, Page, PageHeader, Section } from "@/components/orqo/ui";
import { DiscoveryResult } from "@/lib/agents/contracts";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { DISCOVERY_LIMITS } from "@/lib/discovery/types";
import { createTranslator } from "@/lib/i18n/translate";
import { agentCatalogAccess } from "@/lib/server/agents/gate";
import { getRun, listRuns } from "@/lib/server/agents/repository";
import { webSourceAvailability } from "@/lib/server/discovery/sources";
import { getOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * Discover — "Which companies should my company investigate, and why?"
 * A real product surface over the Prospecting Agent (Phase 5): the server
 * decides access (plan or operator preview, role); the form only collects
 * the objective; results are read from persisted, contract-checked runs.
 */
export default async function DiscoverPage({ searchParams }: PageProps<"/workspace/discover">) {
  const { db, active, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const agent = AGENT_REGISTRY.prospecting;
  const [access, runs, own] = await Promise.all([agentCatalogAccess(active.organizationId, active.role), listRuns(db, active.organizationId, { limit: 10, agentId: agent.id }), getOwnCompanyProfile(db, active.organizationId)]);
  const state = access[agent.id];
  const executable = state.state === "executable";
  const web = executable ? await webSourceAvailability(active.organizationId) : "not_entitled";

  const requested = (await searchParams).run;
  const selectedId = typeof requested === "string" ? requested : runs.find((r) => r.status === "completed")?.id;
  const selected = selectedId ? await getRun(db, active.organizationId, selectedId) : null;
  const result = selected && selected.agent_id === agent.id ? DiscoveryResult.safeParse(selected.result) : null;

  return (
    <Page>
      <PageHeader title={t("discover.title")} description={t("discover.description")} />
      <p className="-mt-2 mb-5 text-[13px] text-fg-faint">{t("discover.semantics")}</p>

      {executable ? (
        <Card className="p-5" data-testid="discover-mission">
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">{t("discover.question")}</h2>
          <p className="mt-1 mb-4 max-w-3xl text-[13.5px] leading-relaxed text-fg-muted">{t("discover.questionBody")}</p>
          <DiscoverForm
            locale={locale}
            organizationId={active.organizationId}
            autonomy={agent.autonomy}
            web={web}
            limits={{ maxResults: DISCOVERY_LIMITS.maxResults, maxQueries: DISCOVERY_LIMITS.maxQueries, memoryDays: DISCOVERY_LIMITS.rejectionMemoryDays }}
            returnTo="discover"
            initialObjective={typeof (await searchParams).objective === "string" ? String((await searchParams).objective).slice(0, 500) : ""}
          />
          {state.via === "preview" && <p className="mt-4 text-[12px] text-caution">{t("agents.previewNote")}</p>}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start" data-testid="discover-locked">
          <FeatureCard plan={plan} feature="discover.prospectingMissions" title={t("discover.locked.title")} body={state.state === "role" ? t("discover.roleBody") : t("discover.locked.body")} icon="discover" locale={locale} />
          <ButtonLink href="/workspace" variant="secondary">
            {t("discover.locked.openSearch")}
          </ButtonLink>
        </div>
      )}

      {selected && (
        <Section title={t("discover.result.title")}>
          <Card className="p-5" data-run-id={selected.id}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-fg-faint">
              <span>
                {formatDate(selected.queued_at, locale)} · {formatDuration(selected.duration_ms, locale)}
              </span>
              <span className="flex items-center gap-3">
                <RunStatusBadge status={selected.status} locale={locale} />
                <Link href={`/workspace/agents/runs/${selected.id}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
                  {t("discover.result.runDetails")} →
                </Link>
              </span>
            </div>
            {result?.success ? (
              <DiscoveryResultView result={result.data} locale={locale} ownName={own?.name ?? ""} organizationId={active.organizationId} runId={selected.id} canAdd={roleAtLeast(active.role, "member")} />
            ) : (
              <p className="text-[13.5px] text-fg-muted" data-testid="discover-run-failure">
                {selected.status === "failed" ? failureText(t, selected.error_code) : t(`agents.runStatus.${selected.status}`)}
              </p>
            )}
          </Card>
        </Section>
      )}

      <Section title={t("discover.historyTitle")}>
        <Card>
          {runs.length === 0 ? (
            <p className="px-5 py-6 text-[13.5px] text-fg-muted">{t("discover.historyEmpty")}</p>
          ) : (
            <ul className="divide-y divide-edge text-[13px]" data-testid="discover-history">
              {runs.map((r) => (
                <li key={r.id} className={cx("flex flex-wrap items-center gap-3 px-5 py-3", r.id === selected?.id && "bg-subtle/60")}>
                  <span className="min-w-0 flex-1 text-fg">{discoveryRunLabel(t, r.agent_missions.input)}</span>
                  <RunStatusBadge status={r.status} locale={locale} />
                  <span className="whitespace-nowrap text-fg-muted">{formatDate(r.queued_at, locale)}</span>
                  <Link href={`/workspace/discover?run=${r.id}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
                    {t("discover.view")} →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </Page>
  );
}
