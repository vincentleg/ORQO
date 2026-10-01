"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { Icon } from "./icons";
import { Button, cx, focusRing } from "./ui";

type Mode = "basic" | "deep";
type Stage = "resolving" | "sources" | "reading" | "structuring" | "comparing" | "evaluating" | "complete";
const STAGES: Stage[] = ["resolving", "sources", "reading", "structuring", "comparing", "evaluating", "complete"];

export interface RunOption {
  mode: Mode;
  /** null when the mode may run; otherwise the denial reason (already localized by key). */
  deniedKey: MessageKey | null;
}

type State = { kind: "idle" } | { kind: "running"; mode: Mode; stages: Stage[] } | { kind: "error"; key: MessageKey; candidates: string[] };

/**
 * Runs a research request and shows the server's real stages as they stream
 * in (NDJSON). No timers, no simulated progress. On completion the page is
 * re-rendered from the stored result.
 */
export function ResearchRunner({
  locale,
  organizationId,
  query,
  ownName,
  options,
  refresh,
}: {
  locale: Locale;
  organizationId: string;
  query: string;
  ownName: string | null;
  options: RunOption[];
  refresh: boolean;
}) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run(mode: Mode) {
    setState({ kind: "running", mode, stages: [] });
    let res: Response;
    try {
      res = await fetch(`/api/v1/organizations/${encodeURIComponent(organizationId)}/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, mode, refresh }),
      });
    } catch {
      setState({ kind: "error", key: "research.denied.generic", candidates: [] });
      return;
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("ndjson")) {
      const body = (await res.json().catch(() => ({}))) as { status?: string; domain?: string; error?: { code?: string; reason?: string } };
      if (res.ok && body.status === "cached") {
        router.replace(`/workspace?q=${encodeURIComponent(body.domain ?? query)}`);
        router.refresh();
        setState({ kind: "idle" });
        return;
      }
      const reason = body.error?.reason;
      const key: MessageKey =
        reason === "role" || reason === "plan_required" || reason === "providers_unconfigured" || reason === "quota_exhausted" || reason === "busy" || reason === "refresh_too_soon"
          ? `research.denied.${reason}`
          : body.error?.code === "invalid_input"
            ? "research.denied.invalid"
            : "research.denied.generic";
      setState({ kind: "error", key, candidates: [] });
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      setState({ kind: "error", key: "research.errors.analysis_failed", candidates: [] });
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    const seen: Stage[] = [];
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (value) buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: { type?: string; stage?: Stage; code?: string; domain?: string; candidates?: string[] };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "stage" && event.stage && STAGES.includes(event.stage)) {
          seen.push(event.stage);
          setState({ kind: "running", mode, stages: [...seen] });
        } else if (event.type === "done") {
          router.replace(`/workspace?q=${encodeURIComponent(event.domain ?? query)}`);
          router.refresh();
          return;
        } else if (event.type === "error") {
          const code = event.code ?? "analysis_failed";
          setState({ kind: "error", key: `research.errors.${code}` as MessageKey, candidates: (event.candidates ?? []).slice(0, 3) });
          router.refresh();
          return;
        }
      }
      if (done) break;
    }
    setState({ kind: "error", key: "research.errors.analysis_failed", candidates: [] });
  }

  if (state.kind === "running") {
    const current = state.stages[state.stages.length - 1];
    return (
      <div role="status" aria-live="polite" data-testid="research-progress" className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-card">
        <div className="text-[13.5px] font-semibold text-fg">{t("research.running")}</div>
        <ol className="mt-3 space-y-1.5">
          {STAGES.filter((s) => s !== "complete").map((s) => {
            const done = state.stages.includes(s) && s !== current;
            const active = s === current;
            return (
              <li key={s} className={cx("flex items-center gap-2 text-[13px]", done ? "text-fg" : active ? "font-medium text-brand" : "text-fg-faint")} data-stage={s} data-state={done ? "done" : active ? "active" : "pending"}>
                <span className="flex h-4 w-4 items-center justify-center">{done ? <Icon name="check" size={13} /> : active ? <span className="h-2 w-2 animate-pulse rounded-full bg-brand" /> : <span className="h-1.5 w-1.5 rounded-full bg-edge-strong" />}</span>
                {t(`research.stages.${s}`, { own: ownName ?? "—" })}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {options.map((o) => (
          <Button key={o.mode} variant={o.mode === "basic" ? "primary" : "secondary"} size="sm" disabled={o.deniedKey !== null} onClick={() => run(o.mode)} data-testid={`run-${o.mode}`} title={o.deniedKey ? t(o.deniedKey, { plan: "Pro" }) : undefined}>
            <Icon name={refresh ? "refresh" : "search"} size={14} />
            {refresh ? t("research.refresh") : o.mode === "basic" ? t("research.runBasic") : t("research.runDeep")}
          </Button>
        ))}
      </div>
      {options
        .filter((o) => o.deniedKey)
        .map((o) => (
          <p key={o.mode} className="text-[12.5px] text-fg-muted" data-testid={`denied-${o.mode}`}>
            {t(o.deniedKey as MessageKey, { plan: "Pro" })}
          </p>
        ))}
      {state.kind === "error" && (
        <div role="alert" className="rounded-lg bg-critical-soft px-4 py-3 text-[13.5px] text-critical" data-testid="research-error">
          {t(state.key)}
          {state.candidates.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {state.candidates.map((c) => (
                <li key={c}>
                  <Link href={`/workspace?q=${encodeURIComponent(c)}`} className={cx("rounded font-medium underline", focusRing)}>
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
