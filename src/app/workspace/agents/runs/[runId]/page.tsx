import Link from "next/link";
import { notFound } from "next/navigation";
import { autonomyLabel, failureText, formatDuration, RunResultView, RunStatusBadge, runTarget, StepList, type EvidenceRef } from "@/components/orqo/agents";
import { formatDate } from "@/components/orqo/analysis";
import { RunControls } from "@/components/orqo/mission-runner";
import { Card, cx, focusRing, Page, Section } from "@/components/orqo/ui";
import { DiscoveryResultView } from "@/components/orqo/discovery-result";
import { CompanyAnalysisResult, DiscoveryResult } from "@/lib/agents/contracts";
import { mayDecideApproval } from "@/lib/agents/policy";
import { getAgent } from "@/lib/agents/registry";
import { MISSION_TYPES, TOOL_IDS, type MissionType, type ToolId } from "@/lib/agents/types";
import { createTranslator } from "@/lib/i18n/translate";
import { getRunDetail } from "@/lib/server/agents/repository";
import { findIntelligence } from "@/lib/server/research/repository";
import { getOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const toolLabel = (id: string) => ((TOOL_IDS as readonly string[]).includes(id) ? (`agents.tools.${id as ToolId}` as const) : null);

/** One agent run: status, steps (operations only), tool calls, approval, validated result and provider usage. */
export default async function RunPage({ params }: PageProps<"/workspace/agents/runs/[runId]">) {
  const { runId } = await params;
  const { db, active, user, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const d = await getRunDetail(db, active.organizationId, runId);
  if (!d) notFound();
  const { run } = d;
  const agent = getAgent(run.agent_id);
  const result = CompanyAnalysisResult.safeParse(run.result);
  const discovery = DiscoveryResult.safeParse(run.result);
  const ownName = discovery.success ? ((await getOwnCompanyProfile(db, active.organizationId))?.name ?? "") : "";
  // Human-readable evidence: only when the stored analysis is the exact snapshot this run used (claim ids are per snapshot).
  let evidence: Record<string, EvidenceRef> | null = null;
  if (result.success) {
    const intel = await findIntelligence(db, active.organizationId, { domain: result.data.target.domain });
    if (intel && intel.id === result.data.intelligenceId && intel.researchedAt === result.data.researchedAt) {
      const sources = new Map(intel.profile.sources.map((s) => [s.key, s]));
      evidence = Object.fromEntries(
        intel.profile.claims.map((c) => {
          const s = c.sourceKey ? sources.get(c.sourceKey) : undefined;
          return [c.id, { text: c.excerpt ?? c.statement, source: s ? s.title || s.url : null, url: s && /^https?:\/\//.test(s.url) ? s.url : null }];
        }),
      );
    }
  }
  const open = d.approvals.find((a) => a.state === "required") ?? null;
  const isAdmin = mayDecideApproval(active.role);
  const canCancel = (run.status === "waiting_for_approval" || run.status === "queued") && roleAtLeast(active.role, "member") && (isAdmin || run.created_by === user.id);
  const limits = run.limits as Record<string, number>;
  const counters = run.counters as Record<string, number>;
  const cost = d.usage.reduce((sum, u) => sum + (u.cost_usd === null ? 0 : Number(u.cost_usd)), 0);
  const costReported = d.usage.some((u) => u.cost_usd !== null);

  return (
    <Page>
      <Link href={agent ? `/workspace/agents/${agent.id}` : "/workspace/agents"} className={cx("mb-3 inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
        ← {agent ? t(`agents.items.${agent.id}.name`) : t("agents.run.back")}
      </Link>
      <Card className="p-5" data-testid="run-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium uppercase tracking-wide text-fg-faint">{t("agents.run.title")}</div>
            <h1 className="text-[22px] font-semibold tracking-tight text-fg">{runTarget(run, t)}</h1>
            <p className="text-[13.5px] text-fg-muted">
              {agent ? t(`agents.items.${agent.id}.name`) : run.agent_id} · {(MISSION_TYPES as readonly string[]).includes(run.agent_missions.mission_type) ? t(`agents.missionTypes.${run.agent_missions.mission_type as MissionType}`) : run.agent_missions.mission_type} · {autonomyLabel(t, run.autonomy)}
            </p>
          </div>
          <RunStatusBadge status={run.status} locale={locale} />
        </div>
        <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-fg-faint">{t("agents.run.queued")}</dt>
            <dd className="text-fg">{formatDate(run.queued_at, locale)}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">{t("agents.run.finished")}</dt>
            <dd className="text-fg">{run.finished_at ? formatDate(run.finished_at, locale) : "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">{t("agents.run.duration")}</dt>
            <dd className="text-fg tabular-nums" data-testid="run-duration">
              {formatDuration(run.duration_ms, locale)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-fg-faint" data-testid="run-budget">
          {t("agents.run.budget", { tools: counters.toolCalls ?? 0, maxTools: limits.maxToolCalls ?? 0, requests: counters.externalRequests ?? 0, maxRequests: limits.maxExternalRequests ?? 0, models: counters.modelCalls ?? 0, maxModels: limits.maxModelCalls ?? 0 })}
        </p>
      </Card>

      {run.status === "waiting_for_approval" && open && (
        <Card className="mt-5 border-caution/40 p-5" data-testid="run-approval">
          <h2 className="text-[15px] font-semibold text-fg">{t("agents.run.approvalTitle")}</h2>
          <p className="mt-1 text-[13.5px] text-fg-muted">{t("agents.run.approvalBody", { tool: toolLabel(open.tool_id) ? t(toolLabel(open.tool_id)!) : open.tool_id })}</p>
          {!isAdmin && <p className="mt-2 text-[12.5px] text-fg-faint">{t("agents.run.approvalAdminOnly")}</p>}
          <div className="mt-3">
            <RunControls locale={locale} organizationId={active.organizationId} runId={run.id} approvalId={open.id} canDecide={isAdmin} canCancel={canCancel} />
          </div>
        </Card>
      )}

      {(run.status === "failed" || run.status === "cancelled") && (
        <Card className="mt-5 border-critical/30 p-5" data-testid="run-failure">
          <h2 className="text-[15px] font-semibold text-fg">{t("agents.run.failedTitle")}</h2>
          <p className="mt-1 text-[13.5px] text-fg-muted">{failureText(t, run.error_code)}</p>
        </Card>
      )}

      {result.success && (
        <Section title={t("agents.run.resultTitle")}>
          <Card className="p-5">
            <RunResultView result={result.data} locale={locale} evidence={evidence} />
          </Card>
        </Section>
      )}

      {discovery.success && (
        <Section title={t("discover.result.title")}>
          <Card className="p-5">
            <DiscoveryResultView result={discovery.data} locale={locale} ownName={ownName} organizationId={active.organizationId} runId={run.id} canAdd={roleAtLeast(active.role, "member")} />
          </Card>
        </Section>
      )}

      {(d.steps.length > 0 || d.toolCalls.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title={t("agents.run.stepsTitle")} description={t("agents.run.stepsNote")}>
            <Card className="p-5">
              <StepList steps={d.steps} locale={locale} />
            </Card>
          </Section>
          <Section title={t("agents.run.toolsTitle")}>
            <Card className="p-5">
              <ul className="space-y-2 text-[13px]" data-testid="run-tools">
                {d.toolCalls.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2" data-tool={c.tool_id} data-outcome={c.outcome}>
                    <span className="text-fg">{toolLabel(c.tool_id) ? t(toolLabel(c.tool_id)!) : c.tool_id}</span>
                    <span className="text-fg-faint">· {t(`agents.costClass.${c.cost_class as "none"}`)}</span>
                    <span className={cx("text-[12px]", c.outcome === "succeeded" ? "text-positive" : c.outcome === "approval_required" ? "text-caution" : "text-critical")}>· {c.outcome}</span>
                    <span className="ml-auto text-[12px] text-fg-faint tabular-nums">{formatDuration(c.duration_ms, locale)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        </div>
      )}

      <Section title={t("agents.run.usageTitle")}>
        <Card className="p-5 text-[13px]" data-testid="run-usage">
          {!isAdmin ? (
            <p className="text-fg-muted">{d.toolCalls.some((c) => c.cost_class === "variable" && c.outcome === "succeeded") ? t("agents.run.usageAdminOnly") : t("agents.run.usageNone")}</p>
          ) : d.usage.length === 0 ? (
            <p className="text-fg-muted">{t("agents.run.usageNone")}</p>
          ) : (
            <>
              <ul className="space-y-1">
                {d.usage.map((u, i) => (
                  <li key={i} className="text-fg">
                    {u.provider} · {u.service} · {u.operation}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-fg-muted">{costReported ? t("agents.run.costReported", { cost: `$${cost.toFixed(4)}` }) : t("agents.run.costNotReported")}</p>
            </>
          )}
        </Card>
      </Section>
    </Page>
  );
}
