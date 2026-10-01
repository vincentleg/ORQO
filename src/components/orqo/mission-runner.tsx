"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { Icon } from "./icons";
import { Button, cx, focusRing, inputClass } from "./ui";

type MissionType = "analyze_company" | "explain_opportunities";
type StepKey = "load_workspace_context" | "resolve_target" | "retrieve_existing_research" | "run_research" | "evaluate_relevance" | "produce_result";
type StepState = "running" | "completed" | "failed" | "skipped";
const DENIALS = ["unknown_agent", "agent_unavailable", "mission_not_supported", "role", "plan_required", "autonomy_not_allowed", "quota_exhausted", "busy"] as const;

type State = { kind: "idle" } | { kind: "running"; steps: { key: StepKey; status: StepState }[] } | { kind: "error"; key: MessageKey };

/**
 * Mission entry point for an executable agent. The server re-checks
 * everything (plan, role, autonomy range, input contract, quota); this form
 * only collects the mission. One idempotency key per mission: a double click,
 * a retry or a refresh can never start a second run. Steps shown while the
 * run executes are the server's real step events.
 */
export function MissionForm({
  locale,
  organizationId,
  agentId,
  agentName,
  missionTypes,
  autonomy,
  companies,
}: {
  locale: Locale;
  organizationId: string;
  agentId: string;
  agentName: string;
  missionTypes: MissionType[];
  autonomy: { min: number; max: number; default: number };
  companies: { id: string; name: string }[];
}) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [missionType, setMissionType] = useState<MissionType>(missionTypes[0]);
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [depth, setDepth] = useState<"basic" | "deep">("basic");
  const [level, setLevel] = useState(autonomy.default);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<State>({ kind: "idle" });

  const levels = Array.from({ length: autonomy.max - autonomy.min + 1 }, (_, i) => autonomy.min + i);
  const company = companies.find((c) => c.id === companyId);
  const targetLabel = company?.name ?? query.trim();
  const autonomyKey = (l: number) => `agents.autonomy.l${l}` as MessageKey;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind === "running") return;
    if (!targetLabel) {
      setState({ kind: "error", key: "agents.form.noTarget" });
      return;
    }
    setState({ kind: "running", steps: [] });
    const target = company ? { companyId: company.id } : { query: query.trim() };
    const input = missionType === "analyze_company" ? { target, depth, refresh: false } : { target };
    let res: Response;
    try {
      res = await fetch(`/api/v1/organizations/${encodeURIComponent(organizationId)}/agents/missions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, missionType, input, autonomy: level, idempotencyKey: key }),
      });
    } catch {
      setState({ kind: "error", key: "agents.denied.generic" });
      return;
    }
    if (!(res.headers.get("content-type") ?? "").includes("ndjson")) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; reason?: string } };
      const reason = body.error?.reason;
      setState({ kind: "error", key: reason && (DENIALS as readonly string[]).includes(reason) ? (`agents.denied.${reason}` as MessageKey) : body.error?.code === "invalid_input" ? "agents.denied.invalid" : "agents.denied.generic" });
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    let runId: string | null = null;
    const steps: { key: StepKey; status: StepState }[] = [];
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (value) buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: { type?: string; runId?: string; key?: StepKey; status?: StepState };
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "accepted" && ev.runId) runId = ev.runId;
        else if (ev.type === "step" && ev.key && ev.status) {
          const i = steps.findLastIndex((s) => s.key === ev.key && s.status === "running");
          if (i >= 0) steps[i] = { key: ev.key, status: ev.status };
          else steps.push({ key: ev.key, status: ev.status });
          setState({ kind: "running", steps: [...steps] });
        } else if (ev.type === "done" && runId) {
          // A new mission needs a new key; this one is spent.
          setKey(crypto.randomUUID());
          router.push(`/workspace/agents/runs/${runId}`);
          return;
        }
      }
      if (done) break;
    }
    if (runId) router.push(`/workspace/agents/runs/${runId}`);
    else setState({ kind: "error", key: "agents.denied.generic" });
  }

  const running = state.kind === "running";
  const select = cx(inputClass, "pr-8");
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="mission-form">
      {missionTypes.length > 1 && (
        <label className="block">
          <span className="text-[13px] font-medium text-fg">{t("agents.runs.mission")}</span>
          <select className={cx(select, "mt-1.5")} value={missionType} onChange={(e) => setMissionType(e.target.value as MissionType)} disabled={running}>
            {missionTypes.map((m) => (
              <option key={m} value={m}>
                {t(`agents.missionTypes.${m}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[13px] leading-relaxed text-fg-muted">{t(`agents.missionTypesBody.${missionType}`)}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] font-medium text-fg">{t("agents.form.target")}</span>
          <input name="target" className={cx(inputClass, "mt-1.5")} placeholder={t("agents.form.targetPlaceholder")} value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} disabled={running || Boolean(companyId)} />
        </label>
        <label className="block">
          <span className="text-[13px] font-medium text-fg">{t("agents.form.network")}</span>
          <select name="company" className={cx(select, "mt-1.5")} value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={running || companies.length === 0}>
            <option value="">{t("agents.form.networkNone")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {missionType === "analyze_company" && (
          <label className="block">
            <span className="text-[13px] font-medium text-fg">{t("agents.form.depth")}</span>
            <select name="depth" className={cx(select, "mt-1.5")} value={depth} onChange={(e) => setDepth(e.target.value as "basic" | "deep")} disabled={running}>
              <option value="basic">{t("agents.form.depthBasic")}</option>
              <option value="deep">{t("agents.form.depthDeep")}</option>
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-[13px] font-medium text-fg">{t("agents.form.autonomy")}</span>
          <select name="autonomy" className={cx(select, "mt-1.5")} value={level} onChange={(e) => setLevel(Number(e.target.value))} disabled={running}>
            {levels.map((l) => (
              <option key={l} value={l}>
                {t(autonomyKey(l))}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-fg-faint">{t(`agents.autonomyHelp.l${level as 0}`)}</span>
        </label>
      </div>
      <div className="rounded-lg bg-subtle px-4 py-3 text-[13px]" data-testid="mission-summary">
        <span className="font-semibold text-fg">{t("agents.form.summary")}</span>
        <span className="mt-0.5 block text-fg-muted">{t("agents.form.summaryLine", { agent: agentName, mission: t(`agents.missionTypes.${missionType}`), target: targetLabel || "—", autonomy: t(autonomyKey(level)) })}</span>
      </div>
      {state.kind === "running" ? (
        <div role="status" aria-live="polite" data-testid="mission-progress" className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-card">
          <div className="text-[13.5px] font-semibold text-fg">{t("agents.form.running")}</div>
          <ol className="mt-3 space-y-1.5">
            {state.steps.map((s, i) => (
              <li key={i} className={cx("flex items-center gap-2 text-[13px]", s.status === "running" ? "font-medium text-brand" : s.status === "failed" ? "text-critical" : s.status === "skipped" ? "text-fg-faint" : "text-fg")} data-step={s.key} data-state={s.status}>
                <span className="flex h-4 w-4 items-center justify-center">{s.status === "running" ? <span className="h-2 w-2 animate-pulse rounded-full bg-brand" /> : <Icon name="check" size={13} />}</span>
                {t(`agents.steps.${s.key}`)}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <Button type="submit" variant="primary" data-testid="run-mission">
          <Icon name="agents" size={14} />
          {t("agents.form.run")}
        </Button>
      )}
      {state.kind === "error" && (
        <p role="alert" className="rounded-lg bg-critical-soft px-4 py-3 text-[13.5px] text-critical" data-testid="mission-error">
          {t(state.key)}
        </p>
      )}
    </form>
  );
}

/** Approve / reject (admins) and cancel (starter or admin) for a run waiting for approval. The server enforces who may do what. */
export function RunControls({ locale, organizationId, runId, approvalId, canDecide, canCancel }: { locale: Locale; organizationId: string; runId: string; approvalId: string | null; canDecide: boolean; canCancel: boolean }) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/v1/organizations/${encodeURIComponent(organizationId)}/agents/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) setError(true);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDecide && approvalId && (
        <>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => post(`approvals/${approvalId}`, { decision: "approve" })} data-testid="approve">
            {t("agents.run.approve")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => post(`approvals/${approvalId}`, { decision: "reject" })} data-testid="reject">
            {t("agents.run.reject")}
          </Button>
        </>
      )}
      {canCancel && (
        <button type="button" disabled={busy} onClick={() => post(`runs/${runId}/cancel`, {})} className={cx("rounded px-2 text-[13px] font-medium text-fg-muted hover:text-fg", focusRing)} data-testid="cancel-run">
          {t("agents.run.cancel")}
        </button>
      )}
      {error && (
        <span role="alert" className="text-[12.5px] text-critical">
          {t("agents.denied.generic")}
        </span>
      )}
    </div>
  );
}
