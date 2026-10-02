"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { addDiscoveredCompanyAction, type AddDiscoveredState } from "@/app/actions/discover";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { Icon } from "./icons";
import { Button, cx, inputClass } from "./ui";

const INTENTS = ["profile", "customers", "suppliers", "technology_partners", "channels", "market_entry"] as const;
type Intent = (typeof INTENTS)[number];
type StepState = "running" | "completed" | "failed" | "skipped";
const DENIALS = ["unknown_agent", "agent_unavailable", "mission_not_supported", "role", "plan_required", "autonomy_not_allowed", "quota_exhausted", "busy"] as const;
type State = { kind: "idle" } | { kind: "running"; steps: { key: string; status: StepState }[] } | { kind: "error"; key: MessageKey };

/**
 * Discover mission entry point (Prospecting Agent). Collects only the business
 * objective and a few filters; the server builds the plan, picks tools,
 * enforces plan, role, autonomy, budget and quota. Progress lines are the
 * server's real step events. One idempotency key per mission.
 */
export function DiscoverForm({
  locale,
  organizationId,
  autonomy,
  web,
  limits,
  returnTo,
  initialObjective = "",
}: {
  locale: Locale;
  organizationId: string;
  autonomy: { min: number; max: number; default: number };
  web: "available" | "not_entitled" | "not_configured";
  limits: { maxResults: number; maxQueries: number; memoryDays: number };
  /** Where to show the finished run: the Discover page or the run page. */
  returnTo: "discover" | "run";
  /** Phase 16B: the objective the user gave ORQO CEO, carried over. The user still starts the run. */
  initialObjective?: string;
}) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [intent, setIntent] = useState<Intent>("profile");
  const [objective, setObjective] = useState(initialObjective.slice(0, 200));
  const [geography, setGeography] = useState("");
  const [market, setMarket] = useState("");
  const [source, setSource] = useState<"workspace_knowledge" | "web_search">("workspace_knowledge");
  const [maxResults, setMaxResults] = useState(limits.maxResults);
  const [reevaluate, setReevaluate] = useState(false);
  const [level, setLevel] = useState(autonomy.default);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<State>({ kind: "idle" });
  // Paid web search needs Prepare (approval-gated); the server enforces it regardless.
  const minLevel = source === "web_search" ? Math.max(2, autonomy.min) : autonomy.min;
  const effectiveLevel = Math.max(level, minLevel);
  const levels = Array.from({ length: autonomy.max - minLevel + 1 }, (_, i) => minLevel + i);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind === "running") return;
    setState({ kind: "running", steps: [] });
    const input = {
      intent,
      ...(objective.trim().length >= 3 && { objective: objective.trim() }),
      ...(geography.trim().length >= 2 && { geography: geography.trim() }),
      ...(market.trim().length >= 2 && { market: market.trim() }),
      source,
      maxResults,
      reevaluate,
    };
    let res: Response;
    try {
      res = await fetch(`/api/v1/organizations/${encodeURIComponent(organizationId)}/agents/missions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "prospecting", missionType: "discover_companies", input, autonomy: effectiveLevel, idempotencyKey: key }),
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
    const steps: { key: string; status: StepState }[] = [];
    const go = (id: string) => {
      // A new mission needs a new key; the form is reused when the result opens on the same page.
      setKey(crypto.randomUUID());
      setState({ kind: "idle" });
      router.push(returnTo === "discover" ? `/workspace/discover?run=${id}` : `/workspace/agents/runs/${id}`);
      router.refresh();
    };
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (value) buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: { type?: string; runId?: string; key?: string; status?: StepState };
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
          go(runId);
          return;
        }
      }
      if (done) break;
    }
    if (runId) go(runId);
    else setState({ kind: "error", key: "agents.denied.generic" });
  }

  const running = state.kind === "running";
  const select = cx(inputClass, "mt-1.5 pr-8");
  const label = "text-[13px] font-medium text-fg";
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="discover-form">
      <fieldset disabled={running} className="space-y-4">
        <div>
          <span className={label}>{t("discover.form.intent")}</span>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t("discover.form.intent")}>
            {INTENTS.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={intent === i}
                onClick={() => setIntent(i)}
                data-intent={i}
                className={cx("rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors", intent === i ? "border-brand bg-brand-soft text-brand" : "border-edge text-fg-muted hover:border-edge-strong hover:text-fg")}
              >
                {t(`discover.intents.${i}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={label}>{t("discover.form.objective")}</span>
          <input name="objective" className={cx(inputClass, "mt-1.5")} placeholder={t("discover.form.objectivePlaceholder")} value={objective} maxLength={200} onChange={(e) => setObjective(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>{t("discover.form.geography")}</span>
            <input name="geography" className={cx(inputClass, "mt-1.5")} placeholder={t("discover.form.geographyPlaceholder")} value={geography} maxLength={60} onChange={(e) => setGeography(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>{t("discover.form.market")}</span>
            <input name="market" className={cx(inputClass, "mt-1.5")} placeholder={t("discover.form.marketPlaceholder")} value={market} maxLength={60} onChange={(e) => setMarket(e.target.value)} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
          <label className="block">
            <span className={label}>{t("discover.form.source")}</span>
            <select name="source" className={select} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
              <option value="workspace_knowledge">{t("discover.form.sourceWorkspace")}</option>
              <option value="web_search" disabled={web !== "available"}>
                {web === "available" ? t("discover.form.sourceWeb") : web === "not_configured" ? t("discover.form.sourceWebNotConfigured") : t("discover.form.sourceWebNotEntitled")}
              </option>
            </select>
          </label>
          <label className="block">
            <span className={label}>{t("discover.form.results")}</span>
            <select name="maxResults" className={select} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))}>
              {Array.from({ length: limits.maxResults }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>{t("discover.form.autonomy")}</span>
            <select name="autonomy" className={select} value={effectiveLevel} onChange={(e) => setLevel(Number(e.target.value))}>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {t(`agents.autonomy.l${l as 0}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="rounded-lg bg-subtle px-4 py-3 text-[12.5px] leading-relaxed text-fg-muted" data-testid="discover-source-note">
          {source === "web_search" ? t("discover.form.webNote", { queries: limits.maxQueries }) : t("discover.form.workspaceNote")}
        </p>
        <label className="flex items-center gap-2 text-[13px] text-fg-muted">
          <input type="checkbox" checked={reevaluate} onChange={(e) => setReevaluate(e.target.checked)} />
          {t("discover.form.reevaluate", { days: limits.memoryDays })}
        </label>
      </fieldset>
      {state.kind === "running" ? (
        <div role="status" aria-live="polite" data-testid="discover-progress" className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-card">
          <div className="text-[13.5px] font-semibold text-fg">{t("discover.form.running")}</div>
          <ol className="mt-3 space-y-1.5">
            {state.steps.map((s, i) => (
              <li key={i} className={cx("flex items-center gap-2 text-[13px]", s.status === "running" ? "font-medium text-brand" : s.status === "failed" ? "text-critical" : s.status === "skipped" ? "text-fg-faint" : "text-fg")} data-step={s.key} data-state={s.status}>
                <span className="flex h-4 w-4 items-center justify-center">{s.status === "running" ? <span className="h-2 w-2 animate-pulse rounded-full bg-brand" /> : <Icon name="check" size={13} />}</span>
                {t(`agents.steps.${s.key}` as MessageKey)}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <Button type="submit" variant="primary" data-testid="start-discovery">
          <Icon name="discover" size={14} />
          {t("discover.form.start")}
        </Button>
      )}
      {state.kind === "error" && (
        <p role="alert" className="rounded-lg bg-critical-soft px-4 py-3 text-[13.5px] text-critical" data-testid="discover-error">
          {t(state.key)}
        </p>
      )}
    </form>
  );
}

/** Human-chosen Add to Network for one discovered company. The server re-reads the stored result. */
export function AddDiscoveredButton({ locale, organizationId, runId, domain }: { locale: Locale; organizationId: string; runId: string; domain: string }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<AddDiscoveredState, FormData>(addDiscoveredCompanyAction, {});
  if (state.ok) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-positive" role="status" data-testid="discover-added">
        <Icon name="check" size={14} />
        {state.existing ? t("discover.result.alreadyAdded") : t("discover.result.added")}
      </p>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="domain" value={domain} />
      <Button type="submit" size="sm" disabled={pending} data-testid="discover-add">
        <Icon name="plus" size={13} />
        {t("discover.result.addToNetwork")}
      </Button>
      {state.error && (
        <span role="alert" className="ml-2 text-[12.5px] text-critical">
          {t("discover.result.addFailed")}
        </span>
      )}
    </form>
  );
}
