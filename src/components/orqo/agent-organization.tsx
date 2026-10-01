import Link from "next/link";
import {
  AGENT_SPACE,
  agentPermissions,
  allowedAutonomy,
  autonomyCeiling,
  collaboratorsOf,
  directReports,
  MISSION_TEMPLATE_IDS,
  missionsInvolving,
  organizationView,
  PRODUCT_SPACES,
  type AgentAccess,
  type MissionPlan,
  type MissionTemplateId,
} from "@/lib/agents/organization";
import { AGENT_ORDER, AGENT_REGISTRY, requiredPlan, type AgentDefinition } from "@/lib/agents/registry";
import type { AgentId } from "@/lib/agents/types";
import type { Locale } from "@/lib/i18n/config";
import { catalogFor, createTranslator, type Translator } from "@/lib/i18n/translate";
import { AgentCard, AgentStatusBadge, autonomyLabel } from "./agents";
import { Badge, Button, ButtonLink, Card, cx, focusRing, inputClass } from "./ui";

/**
 * Agent Organization (Phase 9). Server components over the registry and the
 * server-computed access map. They describe; they never authorize — every
 * mission is re-authorized by the API.
 */

type AccessMap = Record<AgentId, AgentAccess>;

const label = "text-[11.5px] font-semibold uppercase tracking-wide text-fg-faint";

function name(t: Translator, id: AgentId): string {
  return t(`agents.items.${id}.name`);
}

function AgentLink({ id, t }: { id: AgentId; t: Translator }) {
  return (
    <Link href={`/workspace/agents/${id}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
      {name(t, id)}
    </Link>
  );
}

function Layer({ title, body, children, testId }: { title: string; body: string; children: React.ReactNode; testId: string }) {
  return (
    <div data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 className={label}>{title}</h3>
        <p className="text-[12.5px] text-fg-muted">{body}</p>
      </div>
      {children}
    </div>
  );
}

/** Orchestration → management → specialists → custom, from the registry's tiers and parent links. */
export function AgentOrganization({ access, locale }: { access: AccessMap; locale: Locale }) {
  const t = createTranslator(locale);
  const v = organizationView();
  return (
    <div className="space-y-6" data-testid="agent-hierarchy">
      <Layer title={t("agents.org.layers.orchestration")} body={t("agents.org.layerBody.orchestration")} testId="layer-orchestration">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {v.orchestration.map((a) => (
            <AgentCard key={a.id} agent={a} access={access[a.id]} locale={locale} />
          ))}
        </div>
      </Layer>
      <Layer title={t("agents.org.layers.management")} body={t("agents.org.layerBody.management")} testId="layer-management">
        <div className="grid gap-4 sm:grid-cols-2">
          {v.management.map(({ manager, coordinates }) => (
            <div key={manager.id} className="flex flex-col gap-2">
              <AgentCard agent={manager} access={access[manager.id]} locale={locale} />
              <p className="px-1 text-[12.5px] text-fg-muted" data-testid={`coordinates-${manager.id}`}>
                <span className="text-fg-faint">{t("agents.org.coordinates")}: </span>
                {coordinates.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && " · "}
                    <AgentLink id={c.id} t={t} />
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
      </Layer>
      <Layer title={t("agents.org.layers.specialists")} body={t("agents.org.layerBody.specialists")} testId="layer-specialists">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {v.specialists.map((a) => (
            <AgentCard key={a.id} agent={a} access={access[a.id]} locale={locale} />
          ))}
        </div>
      </Layer>
      <Layer title={t("agents.org.layers.custom")} body={t("agents.org.layerBody.custom")} testId="layer-custom">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {v.custom.map((a) => (
            <AgentCard key={a.id} agent={a} access={access[a.id]} locale={locale} />
          ))}
        </div>
      </Layer>
    </div>
  );
}

/** Executable agents only: what you can ask them and where their work shows up. */
export function RunnableNow({ access, locale }: { access: AccessMap; locale: Locale }) {
  const t = createTranslator(locale);
  const runnable = AGENT_ORDER.filter((id) => access[id].state === "executable");
  if (runnable.length === 0) return <p className="px-5 py-5 text-[13.5px] text-fg-muted" data-testid="runnable-empty">{t("agents.org.now.empty")}</p>;
  return (
    <ul className="divide-y divide-edge" data-testid="runnable-now">
      {runnable.map((id) => {
        const space = AGENT_SPACE[id];
        return (
          <li key={id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" data-runnable={id}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-fg">{name(t, id)}</span>
                <AgentStatusBadge access={access[id]} locale={locale} />
              </div>
              <p className="text-[12.5px] text-fg-muted">{AGENT_REGISTRY[id].missionTypes.map((m) => t(`agents.missionTypes.${m}`)).join(" · ")}</p>
            </div>
            <div className="flex items-center gap-3">
              {space && (
                <Link href={PRODUCT_SPACES[space]} className={cx("rounded text-[12.5px] font-medium text-brand hover:underline", focusRing)}>
                  {t("agents.org.now.open", { space: t(`nav.${space}`) })}
                </Link>
              )}
              <ButtonLink href={`/workspace/agents/${id}`} size="sm" variant="secondary">
                {t("agents.startMission")}
              </ButtonLink>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Deterministic mission planner: a plain GET form, server-rendered plan. No API call, no model, nothing runs. */
export function MissionPlanner({ plan, selected, locale }: { plan: MissionPlan | null; selected: MissionTemplateId | null; locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <div className="space-y-4" data-testid="mission-planner">
      <form method="get" action="/workspace/agents#plan" className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="mb-1.5 block text-[13px] font-medium text-fg">{t("agents.planner.mission")}</span>
          <select name="mission" defaultValue={selected ?? MISSION_TEMPLATE_IDS[0]} className={inputClass}>
            {MISSION_TEMPLATE_IDS.map((m) => (
              <option key={m} value={m}>
                {t(`agents.planner.templates.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" data-testid="plan-submit">
          {t("agents.planner.submit")}
        </Button>
      </form>
      {plan && <PlanView plan={plan} t={t} />}
    </div>
  );
}

function PlanView({ plan, t }: { plan: MissionPlan; t: Translator }) {
  return (
    <div className="space-y-3" data-testid="mission-plan" data-mission={plan.template}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold text-fg">{t("agents.planner.lead", { agent: name(t, plan.lead) })}</span>
        <Badge tone={plan.leadStatus === "available" ? "positive" : plan.leadStatus === "preview" ? "caution" : "neutral"}>{t(`agents.org.status.${plan.leadStatus}`)}</Badge>
        <span className="text-fg-faint">{t("agents.planner.leadNote")}</span>
      </div>
      <ol className="space-y-2">
        {plan.steps.map((s) => (
          <li key={s.n} className="rounded-lg border border-edge bg-surface px-4 py-3" data-step-agent={s.agent} data-step-status={s.status} data-runnable={s.runnable}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
                <span className="text-[12px] text-fg-faint tabular-nums">{t("agents.planner.step", { n: s.n })}</span>
                <span className="font-semibold text-fg">{name(t, s.agent)}</span>
                <span className="text-fg-muted">· {t(`agents.capabilities.${s.capability}`)}</span>
              </div>
              {s.runnable ? (
                <Badge tone={s.status === "preview" ? "caution" : "positive"} icon="check">
                  {t("agents.planner.runnable")}
                  {s.status === "preview" ? ` · ${t("agents.org.status.preview")}` : ""}
                </Badge>
              ) : (
                <Badge tone={s.status === "locked" ? "brand" : "neutral"} icon={s.status === "locked" ? "lock" : "clock"}>
                  <span data-blocker={s.blocker}>{t(`agents.planner.blocked.${s.blocker ?? "no_mission"}`, { plan: t(`plans.${s.requiredPlan}`) })}</span>
                </Badge>
              )}
            </div>
            <p className="mt-1 text-[12.5px] text-fg-muted">{t("agents.planner.reason", { capability: t(`agents.capabilities.${s.capability}`).toLowerCase() })}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
              {s.runnable && s.missionType && (
                <Link href={`/workspace/agents/${s.agent}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
                  {t("agents.planner.open")}: {t(`agents.missionTypes.${s.missionType}`)} →
                </Link>
              )}
              {s.approvalBoundary && <span className="text-caution">{t("agents.planner.approval")}</span>}
              {s.handoff && (
                <span className="text-fg-faint" data-testid="plan-handoff">
                  {t("agents.planner.handoff", { agent: name(t, s.handoff.to), capability: t(`agents.capabilities.${s.handoff.capability}`).toLowerCase() })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-lg bg-subtle px-4 py-3 text-[13px] text-fg-muted">
        <p className="font-medium text-fg" data-testid="plan-count">
          {t("agents.planner.count", { n: plan.runnable, total: plan.steps.length })}
        </p>
        <p className="mt-1">{t("agents.planner.onlyAvailable")}</p>
        <p className="mt-1">{t("agents.planner.human")}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent detail
// ---------------------------------------------------------------------------

function Block({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId}>
      <h3 className={label}>{title}</h3>
      <div className="mt-1.5 text-[13.5px] text-fg">{children}</div>
    </div>
  );
}

/** Role, responsibilities, team position, status, plan and autonomy ceiling. */
export function AgentOverview({ agent, access, locale }: { agent: AgentDefinition; access: AgentAccess; locale: Locale }) {
  const t = createTranslator(locale);
  const built = agent.status === "available";
  const resp = catalogFor(locale).agents.responsibilities[agent.id];
  const reports = directReports(agent.id);
  const peers = collaboratorsOf(agent.id);
  const ceiling = autonomyCeiling(agent, access);
  const allowed = allowedAutonomy(agent, access);
  const space = AGENT_SPACE[agent.id];
  return (
    <Card className="space-y-5 p-5" data-testid="agent-overview">
      <div className="flex flex-wrap items-center gap-2">
        <AgentStatusBadge access={access} locale={locale} />
        <span className="text-[12.5px] text-fg-muted">
          {t("agents.detail.plan")}: {t(`plans.${requiredPlan(agent)}`)}
        </span>
      </div>
      {access.state === "coming_soon" && <p className="rounded-lg bg-subtle px-4 py-3 text-[13px] text-fg-muted" data-testid="agent-planned-note">{t("agents.detail.plannedNote")}</p>}
      {access.state === "locked" && <p className="rounded-lg bg-brand-soft px-4 py-3 text-[13px] text-brand" data-testid="agent-locked-note">{t("agents.detail.lockedNote")}</p>}

      <Block title={built ? t("agents.detail.responsibilities") : t("agents.detail.plannedResponsibilities")} testId="agent-responsibilities">
        <ul className="list-disc space-y-1 pl-5 text-fg-muted">
          {Object.values(resp).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Block>

      <Block title={t("agents.detail.team")} testId="agent-team">
        <dl className="space-y-1.5 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <dt className="text-fg-faint">{t("agents.detail.reportsTo")}</dt>
            <dd>{agent.parent ? <AgentLink id={agent.parent} t={t} /> : t("agents.detail.none")}</dd>
          </div>
          {reports.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <dt className="text-fg-faint">{t("agents.detail.coordinates")}</dt>
              <dd>
                {reports.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && " · "}
                    <AgentLink id={r.id} t={t} />
                  </span>
                ))}
              </dd>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <dt className="text-fg-faint">{t("agents.detail.worksWith")}</dt>
            <dd>
              {peers.length === 0
                ? t("agents.detail.none")
                : peers.map((p, i) => (
                    <span key={p}>
                      {i > 0 && " · "}
                      <AgentLink id={p} t={t} />
                    </span>
                  ))}
            </dd>
          </div>
        </dl>
        {peers.length > 0 && <p className="mt-1 text-[12px] text-fg-faint">{t("agents.detail.worksWithNote")}</p>}
      </Block>

      <Block title={t("agents.detail.autonomy")} testId="agent-autonomy">
        <p className="text-[13px] text-fg-muted" data-ceiling={ceiling ?? "none"}>
          {ceiling === null ? t("agents.detail.noCeiling") : t("agents.detail.ceiling", { level: autonomyLabel(t, ceiling) })}
        </p>
        <ul className="mt-2 space-y-1">
          {([0, 1, 2, 3] as const).map((l) => {
            const state = allowed.includes(l) ? "allowed" : l === 3 ? "never" : "above";
            return (
              <li key={l} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]" data-level={l} data-level-state={state}>
                <span className={cx("font-medium", state === "allowed" ? "text-fg" : "text-fg-faint line-through")}>{autonomyLabel(t, l)}</span>
                <span className="text-fg-faint">— {state === "allowed" ? t(`agents.autonomyHelp.l${l}`) : state === "never" ? t("agents.detail.levelNever") : ceiling === null ? t("agents.detail.noCeiling") : t("agents.detail.levelAbove")}</span>
              </li>
            );
          })}
        </ul>
      </Block>

      <Block title={t("agents.detail.askToday")} testId="agent-ask">
        {access.state === "executable" && agent.missionTypes.length > 0 ? (
          <ul className="space-y-0.5 text-fg-muted">
            {agent.missionTypes.map((m) => (
              <li key={m}>{t(`agents.missionTypes.${m}`)}</li>
            ))}
          </ul>
        ) : (
          <span className="text-fg-muted">{t("agents.detail.askNone")}</span>
        )}
      </Block>

      {(space || missionsInvolving(agent.id).length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {space && (
            <Block title={t("agents.detail.space")}>
              <Link href={PRODUCT_SPACES[space]} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
                {t(`nav.${space}`)} →
              </Link>
            </Block>
          )}
          {missionsInvolving(agent.id).length > 0 && (
            <Block title={t("agents.detail.missions")}>
              <ul className="space-y-0.5 text-[13px]">
                {missionsInvolving(agent.id).map((m) => (
                  <li key={m}>
                    <Link href={`/workspace/agents?mission=${m}#plan`} className={cx("rounded text-brand hover:underline", focusRing)}>
                      {t(`agents.planner.templates.${m}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      )}
    </Card>
  );
}

/** Human-readable permissions derived from the granted tools (never from a run or a model). */
export function AgentPermissionsCard({ agent, access, locale }: { agent: AgentDefinition; access: AgentAccess; locale: Locale }) {
  const t = createTranslator(locale);
  const p = agentPermissions(agent);
  return (
    <Card className="space-y-4 p-5 text-[13px]" data-testid="agent-permissions">
      <h2 className="text-[15px] font-semibold text-fg">{t("agents.detail.permissions")}</h2>
      <Block title={t("agents.detail.canRead")} testId="perm-read">
        {p.reads.length === 0 ? (
          <span className="text-fg-muted">{t("agents.detail.nothingGranted")}</span>
        ) : (
          <ul className="space-y-0.5 text-fg-muted">
            {p.reads.map((d) => (
              <li key={d} data-domain={d}>
                {t(`agents.domains.${d}`)}
              </li>
            ))}
          </ul>
        )}
      </Block>
      {p.stores.length > 0 && (
        <Block title={t("agents.detail.canStore")} testId="perm-store">
          <ul className="space-y-0.5 text-fg-muted">
            {p.stores.map((d) => (
              <li key={d}>{t(`agents.domains.${d}`)}</li>
            ))}
          </ul>
        </Block>
      )}
      {p.tools.length > 0 && (
        <Block title={access.state === "executable" ? t("agents.detail.canUse") : t("agents.detail.toolsWhenAuthorized")} testId="perm-tools">
          <ul className="space-y-1">
            {p.tools.map((tool) => (
              <li key={tool.id} data-tool={tool.id} data-tool-access={tool.access}>
                <span className="text-fg">{t(`agents.tools.${tool.id}`)}</span>
                <span className="text-fg-faint">
                  {" "}
                  · {t(`agents.toolAccess.${tool.access}`)} · {t(`agents.costClass.${tool.costClass}`)}
                </span>
                {tool.needsApproval && <span className="block text-[12px] text-caution">{t("agents.detail.approval")}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {p.plannedTools.length > 0 && (
        <Block title={t("agents.detail.plannedTools")} testId="perm-planned">
          <ul className="space-y-0.5 text-fg-faint">
            {p.plannedTools.map((tool) => (
              <li key={tool}>{t(`agents.tools.${tool}`)}</li>
            ))}
          </ul>
        </Block>
      )}
      <Block title={t("agents.detail.cannot")} testId="perm-cannot">
        <ul className="space-y-0.5 text-fg-muted">
          {p.cannot.map((b) => (
            <li key={b} data-boundary={b}>
              ✕ {t(`agents.boundaries.${b}`)}
            </li>
          ))}
        </ul>
      </Block>
      <Block title={t("agents.detail.withholds")} testId="perm-withholds">
        <p className="text-fg-muted">{p.withholds.map((f) => t(`agents.privateFields.${f}`)).join(" · ")}</p>
      </Block>
    </Card>
  );
}
