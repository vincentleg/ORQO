import Link from "next/link";
import { CompanyAnalysisResult } from "@/lib/agents/contracts";
import { AGENT_REGISTRY, getAgent, requiredPlan, type AgentDefinition } from "@/lib/agents/registry";
import { RUN_FAILURES, STEP_KEYS, type AutonomyLevel, type RunFailure, type RunStatus, type StepKey } from "@/lib/agents/types";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/lib/i18n/translate";
import type { AgentAccess } from "@/lib/server/agents/gate";
import type { AgentRunRow } from "@/lib/server/agents/repository";
import { formatDate } from "./analysis";
import { Icon } from "./icons";
import { Badge, ButtonLink, cx, focusRing, type BadgeTone } from "./ui";

/**
 * Agents UI (Phase 4). Server components that render the code registry and
 * persisted runs. Nothing here decides access: the states come from the
 * server gate, and execution is re-authorized by the API on every request.
 */

const STATUS_TONE: Record<RunStatus, BadgeTone> = { queued: "neutral", running: "brand", waiting_for_approval: "caution", completed: "positive", failed: "critical", cancelled: "outline" };

export function RunStatusBadge({ status, locale }: { status: RunStatus; locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <Badge tone={STATUS_TONE[status]} className="whitespace-nowrap">
      <span data-run-status={status}>{t(`agents.runStatus.${status}`)}</span>
    </Badge>
  );
}

export function autonomyLabel(t: Translator, level: number): string {
  return t(`agents.autonomy.l${Math.min(3, Math.max(0, level)) as AutonomyLevel}`);
}

export function failureText(t: Translator, code: string | null): string {
  return code && (RUN_FAILURES as readonly string[]).includes(code) ? t(`agents.failures.${code as RunFailure}`) : t("agents.failures.internal");
}

export function formatDuration(ms: number | null, locale: Locale): string {
  if (ms === null) return "—";
  const s = ms / 1000;
  return s < 60 ? `${s.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 })} s` : `${Math.round(s / 60)} min`;
}

/** Target label of a run: the analyzed company when known, else the mission's input. */
export function runTarget(run: AgentRunRow): string {
  const r = CompanyAnalysisResult.safeParse(run.result);
  if (r.success) return r.data.target.name;
  const target = (run.agent_missions.input as { target?: { query?: string } }).target;
  return target?.query ?? "—";
}

function missionLabel(t: Translator, type: string): string {
  return type === "analyze_company" || type === "explain_opportunities" ? t(`agents.missionTypes.${type}`) : type;
}

function agentName(t: Translator, id: string): string {
  return getAgent(id) ? t(`agents.items.${getAgent(id)!.id}.name`) : id;
}

export function RunsTable({ runs, locale, showAgent = true }: { runs: AgentRunRow[]; locale: Locale; showAgent?: boolean }) {
  const t = createTranslator(locale);
  if (runs.length === 0) return <p className="px-5 py-6 text-[13.5px] text-fg-muted">{t("agents.runs.empty")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" data-testid="agent-runs">
        <thead className="border-b border-edge text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">
          <tr>
            {showAgent && <th className="px-5 py-2.5 font-semibold">{t("agents.runs.agent")}</th>}
            <th className="px-3 py-2.5 font-semibold">{t("agents.runs.mission")}</th>
            <th className="px-3 py-2.5 font-semibold">{t("agents.runs.status")}</th>
            <th className="px-3 py-2.5 font-semibold">{t("agents.runs.started")}</th>
            <th className="px-3 py-2.5 font-semibold">{t("agents.runs.duration")}</th>
            <th className="px-5 py-2.5 font-semibold">
              <span className="sr-only">{t("agents.runs.view")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {runs.map((r) => (
            <tr key={r.id} data-run-id={r.id}>
              {showAgent && <td className="px-5 py-3 font-medium text-fg">{agentName(t, r.agent_id)}</td>}
              <td className="px-3 py-3 text-fg-muted">
                <span className="block text-fg">{runTarget(r)}</span>
                <span className="text-[12px]">{missionLabel(t, r.agent_missions.mission_type)}</span>
              </td>
              <td className="px-3 py-3">
                <RunStatusBadge status={r.status} locale={locale} />
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-fg-muted">{formatDate(r.queued_at, locale)}</td>
              <td className="px-3 py-3 whitespace-nowrap text-fg-muted tabular-nums">{formatDuration(r.duration_ms, locale)}</td>
              <td className="px-5 py-3 text-right">
                <Link href={`/workspace/agents/runs/${r.id}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
                  {t("agents.runs.view")} →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card for an agent whose execution state the server determined. */
export function AgentCard({ agent, access, locale }: { agent: AgentDefinition; access: AgentAccess; locale: Locale }) {
  const t = createTranslator(locale);
  const plan = requiredPlan(agent);
  const executable = access.state === "executable";
  const badge =
    access.state === "executable" ? (
      access.via === "preview" ? (
        <Badge tone="caution" icon="clock">{t("agents.access.preview")}</Badge>
      ) : (
        <Badge tone="positive" icon="check">{t("agents.access.executable")}</Badge>
      )
    ) : access.state === "locked" ? (
      <Badge tone="brand" icon="lock">{t(`plans.${access.requiredPlan}`)}</Badge>
    ) : access.state === "role" ? (
      <Badge tone="outline">{t("agents.access.role")}</Badge>
    ) : access.state === "disabled" ? (
      <Badge tone="outline">{t("agents.access.disabled")}</Badge>
    ) : (
      <Badge tone="neutral" icon="clock">{t("access.comingSoon")}</Badge>
    );
  return (
    <article className="flex flex-col rounded-xl border border-edge bg-surface p-5 shadow-card" data-agent={agent.id} data-feature={agent.feature} data-access={access.state}>
      <div className="flex items-start justify-between gap-3">
        <span className={cx("flex h-9 w-9 items-center justify-center rounded-lg", access.state === "locked" ? "bg-subtle text-fg-faint" : "bg-brand-soft text-brand")}>
          <Icon name={access.state === "locked" ? "lock" : "agents"} size={17} />
        </span>
        {badge}
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-fg">{t(`agents.items.${agent.id}.name`)}</h3>
      <p className="mt-1 flex-1 text-[13.5px] leading-relaxed text-fg-muted">{t(`agents.items.${agent.id}.purpose`)}</p>
      {agent.status === "available" && (
        <dl className="mt-3 space-y-1 text-[12.5px]">
          <div className="flex gap-2">
            <dt className="text-fg-faint">{t("agents.labels.capabilities")}</dt>
            <dd className="text-fg-muted">{agent.capabilities.map((c) => t(`agents.capabilities.${c}`)).join(" · ")}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-faint">{t("agents.labels.autonomy")}</dt>
            <dd className="text-fg-muted">{t("agents.autonomyRange", { min: autonomyLabel(t, agent.autonomy.min), max: autonomyLabel(t, agent.autonomy.max) })}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-faint">{t("agents.labels.plan")}</dt>
            <dd className="text-fg-muted">{t(`plans.${plan}`)}</dd>
          </div>
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
        {executable ? (
          <ButtonLink href={`/workspace/agents/${agent.id}`} size="sm" variant="primary" data-testid={`start-${agent.id}`}>
            {t("agents.startMission")}
          </ButtonLink>
        ) : access.state === "locked" ? (
          <>
            <span className="text-[12.5px] text-fg-muted">{t("plans.availableWith", { plan: t(`plans.${access.requiredPlan}`) })}</span>
            <ButtonLink href="/workspace/plans" size="sm" variant="secondary">
              {t("plans.upgradeTo", { plan: t(`plans.${access.requiredPlan}`) })}
            </ButtonLink>
          </>
        ) : access.state === "role" ? (
          <Link href={`/workspace/agents/${agent.id}`} className={cx("rounded text-[12.5px] font-medium text-brand hover:underline", focusRing)}>
            {t("agents.openAgent")} →
          </Link>
        ) : (
          <span className="text-[12.5px] text-fg-faint">{t("access.notRunYet")}</span>
        )}
      </div>
    </article>
  );
}

/** Orchestrator → managers → specialists, from the registry's reporting lines. */
export function AgentHierarchy({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const managers = Object.values(AGENT_REGISTRY).filter((a) => a.tier === "manager");
  const direct = Object.values(AGENT_REGISTRY).filter((a) => a.tier === "specialist" && a.parent === "orchestrator");
  const box = "rounded-lg border border-edge bg-subtle px-4 py-2 text-center";
  return (
    <div className="flex flex-col items-center gap-2" data-testid="agent-hierarchy">
      <div className={box}>
        <span className="block text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.tiers.orchestrator")}</span>
        <span className="block text-[13.5px] font-semibold text-fg">{t("agents.items.orchestrator.name")}</span>
      </div>
      <span aria-hidden className="h-4 w-px bg-edge-strong" />
      <div className="grid w-full gap-3 sm:grid-cols-2">
        {managers.map((m) => (
          <div key={m.id} className="flex flex-col items-center gap-2">
            <div className={box}>
              <span className="block text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.tiers.manager")}</span>
              <span className="block text-[13.5px] font-semibold text-fg">{t(`agents.items.${m.id}.name`)}</span>
            </div>
            <span className="text-[12.5px] text-fg-muted">
              {Object.values(AGENT_REGISTRY)
                .filter((a) => a.parent === m.id)
                .map((a) => t(`agents.items.${a.id}.name`))
                .join(" · ")}
            </span>
          </div>
        ))}
      </div>
      {direct.length > 0 && <span className="text-[12.5px] text-fg-faint">{direct.map((a) => t(`agents.items.${a.id}.name`)).join(" · ")}</span>}
    </div>
  );
}

const STEP_ICON_TONE: Record<string, string> = { completed: "text-positive", failed: "text-critical", skipped: "text-fg-faint", running: "text-brand" };

export function StepList({ steps, locale }: { steps: { seq: number; step_key: string; status: string; summary: Record<string, unknown> }[]; locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <ol className="space-y-2" data-testid="run-steps">
      {steps.map((s) => (
        <li key={s.seq} className="flex items-start gap-3 text-[13.5px]" data-step={s.step_key} data-state={s.status}>
          <span className={cx("mt-0.5 w-5 shrink-0 text-right text-[12px] tabular-nums", STEP_ICON_TONE[s.status])}>{s.seq}</span>
          <span className="min-w-0 flex-1">
            <span className="text-fg">{(STEP_KEYS as readonly string[]).includes(s.step_key) ? t(`agents.steps.${s.step_key as StepKey}`) : s.step_key}</span>
            <span className={cx("ml-2 text-[12px]", STEP_ICON_TONE[s.status])}>{t(`agents.stepStatus.${s.status as "completed"}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A cited statement resolved from the stored evidence the run used (never invented). */
export interface EvidenceRef {
  text: string;
  source: string | null;
  url: string | null;
}

function shorten(text: string, max = 110): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Localized view of a validated company-analysis result. `evidence` maps claim
 * ids to their stored statements; it is null when the stored analysis changed
 * since the run, in which case only a count is shown (claim ids are internal).
 */
export function RunResultView({ result, locale, evidence = null }: { result: CompanyAnalysisResult; locale: Locale; evidence?: Record<string, EvidenceRef> | null }) {
  const t = createTranslator(locale);
  const analysisHref = `/workspace?q=${encodeURIComponent(result.target.domain)}`;
  const items = (title: MessageKey, list: CompanyAnalysisResult["opportunities"]) =>
    list.length > 0 && (
      <div>
        <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-fg-faint">{t(title)}</h3>
        <ul className="mt-2 space-y-1.5">
          {list.map((o, i) => (
            <li key={i} className="text-[13.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{t(`analysis.relationships.${o.relationship}`)}</span>
                <Badge tone={o.verdict === "pass" ? "positive" : "caution"}>{t(`analysis.confidence.${o.confidence}`)}</Badge>
              </div>
              {o.claimIds.length > 0 &&
                (evidence ? (
                  <ul className="mt-1 space-y-0.5 border-l border-edge pl-3 text-[12.5px] text-fg-muted" data-testid="run-evidence">
                    {o.claimIds
                      .map((id) => evidence[id])
                      .filter((e): e is EvidenceRef => Boolean(e))
                      // Several claims can quote the same sentence (e.g. a fact and an inference from it).
                      .filter((e, k, all) => all.findIndex((x) => x.text === e.text) === k)
                      .slice(0, 3)
                      .map((e, j) => (
                        <li key={j}>
                          <q>{shorten(e.text)}</q>
                          {e.source && (
                            <>
                              {" — "}
                              {e.url ? (
                                <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className={cx("rounded text-brand hover:underline", focusRing)}>
                                  {shorten(e.source, 60)}
                                </a>
                              ) : (
                                shorten(e.source, 60)
                              )}
                            </>
                          )}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <Link href={analysisHref} className={cx("mt-1 inline-block rounded text-[12.5px] text-fg-muted hover:underline", focusRing)} data-testid="run-evidence-count">
                    {t("agents.run.supportCount", { n: o.claimIds.length })}
                  </Link>
                ))}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="space-y-5" data-testid="run-result">
      <div>
        <div className="text-[17px] font-semibold text-fg">{result.target.name}</div>
        <div className="text-[13px] text-fg-muted">
          {result.target.domain} · {result.reusedResearch ? t("agents.run.reused", { date: formatDate(result.researchedAt, locale) }) : t("agents.run.newResearch", { date: formatDate(result.researchedAt, locale) })}
        </div>
        <div className="mt-1 text-[12.5px] text-fg-faint">{t("agents.run.evidence", { sources: result.evidence.sources, facts: result.evidence.facts, inferences: result.evidence.inferences })}</div>
      </div>
      {items("agents.run.opportunities", result.opportunities)}
      {items("agents.run.hypotheses", result.hypotheses)}
      {result.opportunities.length + result.hypotheses.length === 0 && result.analysisStatus !== "own_profile_missing" && <p className="text-[13.5px] text-fg-muted">{t("agents.run.noOpportunity")}</p>}
      {result.rejectedCount > 0 && <p className="text-[12.5px] text-fg-faint">{t("agents.run.rejected", { n: result.rejectedCount })}</p>}
      <div className="rounded-lg border border-brand/30 bg-brand-soft px-4 py-3" data-testid="run-next-action">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-brand">{t("agents.run.nextAction")}</div>
        <p className="mt-1 text-[14px] text-fg">
          {result.nextAction === null ? t("agents.run.noNextAction") : result.nextAction.kind === "complete_profile" ? t("agents.run.completeProfile") : (result.nextAction.text ?? t(`analysis.relationships.${result.nextAction.relationship}`))}
        </p>
      </div>
      {(result.unknowns.length > 0 || result.ownGaps.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {result.unknowns.length > 0 && (
            <div>
              <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.run.unknowns")}</h3>
              <ul className="mt-2 space-y-1 text-[13px] text-fg-muted">
                {result.unknowns.map((u) => (
                  <li key={u}>{t(`analysis.unknownFields.${u}`)}</li>
                ))}
              </ul>
            </div>
          )}
          {result.ownGaps.length > 0 && (
            <div>
              <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-fg-faint">{t("agents.run.ownGaps")}</h3>
              <ul className="mt-2 space-y-1 text-[13px] text-fg-muted">
                {result.ownGaps.map((g) => (
                  <li key={g}>{t(`analysis.ownGaps.${g}`)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <Link href={analysisHref} className={cx("inline-block rounded text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
        {t("agents.run.openAnalysis")} →
      </Link>
    </div>
  );
}

