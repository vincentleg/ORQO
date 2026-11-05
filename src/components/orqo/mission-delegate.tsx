"use client";

/**
 * Delegate a mission to ORQO (Phase 17C). The founder picks one of the three real templates and gives only
 * what it needs; the server re-checks everything (role, entitlement, strict input, quota). One idempotency
 * key per form: a double click or a retry never creates a second mission. On success the founder lands on
 * the live mission page, which starts the work.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DISCOVERY_INTENTS } from "@/lib/discovery/types";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { MISSION_TEMPLATES, type MissionTemplateId } from "@/lib/missions/types";
import { Icon } from "./icons";
import { Button, ButtonLink, cx, focusRing, inputClass } from "./ui";

export interface DelegatePrefill {
  template?: MissionTemplateId;
  target?: string;
  company?: string;
  intent?: string;
  objective?: string;
  market?: string;
  geography?: string;
}

const ERRORS = ["role", "plan_required", "busy", "quota_exhausted"] as const;

export function DelegateMission({ locale, organizationId, companies, locked, prefill }: { locale: Locale; organizationId: string; companies: { id: string; name: string }[]; locked: "plan" | "role" | null; prefill: DelegatePrefill }) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [template, setTemplate] = useState<MissionTemplateId>(prefill.template ?? "prospect_and_research");
  const [query, setQuery] = useState(prefill.target ?? "");
  const [companyId, setCompanyId] = useState(prefill.company && companies.some((c) => c.id === prefill.company) ? prefill.company : "");
  const [intent, setIntent] = useState<string>((DISCOVERY_INTENTS as readonly string[]).includes(prefill.intent ?? "") ? (prefill.intent as string) : "customers");
  const [objective, setObjective] = useState(prefill.objective ?? "");
  const [market, setMarket] = useState(prefill.market ?? "");
  const [geography, setGeography] = useState(prefill.geography ?? "");
  const [top, setTop] = useState(2);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<{ kind: "idle" } | { kind: "starting" } | { kind: "error"; key: MessageKey }>({ kind: "idle" });

  const company = companies.find((c) => c.id === companyId);
  const targetLabel = company?.name ?? query.trim();
  const intentLabel = t(`discover.intents.${intent}` as MessageKey);
  const will =
    template === "research_company"
      ? t("missions.templates.research_company.will", { target: targetLabel || t("missions.form.targetAny") })
      : template === "prospect_known_candidates"
        ? t("missions.templates.prospect_known_candidates.will", { intent: intentLabel.toLowerCase() })
        : t("missions.templates.prospect_and_research.will", { intent: intentLabel.toLowerCase(), top });
  const starting = state.kind === "starting";
  const disabled = starting || locked !== null;

  function input(): Record<string, unknown> | null {
    if (template === "research_company") {
      if (!targetLabel) return null;
      return { target: company ? { companyId: company.id } : { query: query.trim() } };
    }
    const base: Record<string, unknown> = { intent };
    for (const [k, v] of [["objective", objective], ["market", market], ["geography", geography]] as const) if (v.trim()) base[k] = v.trim();
    return template === "prospect_and_research" ? { ...base, researchTop: top } : base;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const body = input();
    if (!body) {
      setState({ kind: "error", key: "missions.form.noTarget" });
      return;
    }
    setState({ kind: "starting" });
    let res: Response;
    try {
      res = await fetch(`/api/v1/organizations/${encodeURIComponent(organizationId)}/missions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template, input: body, idempotencyKey: key }) });
    } catch {
      setState({ kind: "error", key: "missions.errors.network" });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { mission?: { id?: string }; error?: { code?: string; reason?: string } };
    if (res.ok && json.mission?.id) {
      setKey(crypto.randomUUID());
      router.push(`/workspace/missions/${json.mission.id}`);
      return;
    }
    const reason = json.error?.reason;
    setState({ kind: "error", key: reason && (ERRORS as readonly string[]).includes(reason) ? (`missions.errors.${reason}` as MessageKey) : json.error?.code === "invalid_input" ? "missions.errors.invalid" : "missions.errors.generic" });
  }

  const select = cx(inputClass, "mt-1.5 pr-8");
  const field = (label: string, value: string, set: (v: string) => void, opts: { name: string; placeholder?: string; max: number }) => (
    <label className="block">
      <span className="text-[13px] font-medium text-fg">{label}</span>
      <input name={opts.name} className={cx(inputClass, "mt-1.5")} value={value} placeholder={opts.placeholder} maxLength={opts.max} onChange={(e) => set(e.target.value)} disabled={disabled} />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="delegate-form" aria-describedby="delegate-free">
      <fieldset>
        <legend className="text-[14px] font-semibold text-fg">{t("missions.delegate.choose")}</legend>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {MISSION_TEMPLATES.map((id) => (
            <label key={id} className={cx("relative flex cursor-pointer flex-col rounded-xl border px-4 py-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40", template === id ? "border-brand bg-brand-soft/40" : "border-edge bg-surface hover:border-edge-strong", disabled && "cursor-not-allowed opacity-70")} data-testid={`template-${id}`}>
              <input type="radio" name="template" value={id} checked={template === id} onChange={() => setTemplate(id)} disabled={disabled} className="sr-only" />
              <span className="flex items-center gap-2 text-[14px] font-semibold text-fg">
                {template === id && <Icon name="check" size={14} className="text-brand" aria-hidden />}
                {t(`missions.templates.${id}.name`)}
              </span>
              <span className="mt-1 text-[13px] leading-relaxed text-fg-muted">{t(`missions.templates.${id}.body`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {template === "research_company" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {field(t("missions.form.target"), query, setQuery, { name: "target", placeholder: t("missions.form.targetPlaceholder"), max: 200 })}
          <label className="block">
            <span className="text-[13px] font-medium text-fg">{t("missions.form.network")}</span>
            <select name="company" className={select} value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={disabled || companies.length === 0}>
              <option value="">{t("missions.form.networkNone")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[13px] font-medium text-fg">{t("missions.form.intent")}</span>
            <select name="intent" className={select} value={intent} onChange={(e) => setIntent(e.target.value)} disabled={disabled}>
              {DISCOVERY_INTENTS.map((i) => (
                <option key={i} value={i}>
                  {t(`discover.intents.${i}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          {field(t("missions.form.objective"), objective, setObjective, { name: "objective", placeholder: t("missions.form.objectivePlaceholder"), max: 200 })}
          {field(t("missions.form.market"), market, setMarket, { name: "market", max: 60 })}
          {field(t("missions.form.geography"), geography, setGeography, { name: "geography", max: 60 })}
          {template === "prospect_and_research" && (
            <label className="block">
              <span className="text-[13px] font-medium text-fg">{t("missions.form.top")}</span>
              <select name="top" className={select} value={top} onChange={(e) => setTop(Number(e.target.value))} disabled={disabled}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="rounded-lg bg-subtle px-4 py-3 text-[13.5px]" data-testid="delegate-summary">
        <span className="font-semibold text-fg">{t("missions.delegate.summary")}</span> <span className="text-fg-muted">{will.charAt(0).toLowerCase() + will.slice(1)}</span>
        <p id="delegate-free" className="mt-1.5 text-[12.5px] text-fg-faint">
          {t("missions.free.title")} — {t("missions.free.body")}
        </p>
      </div>

      {locked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-caution-soft px-4 py-3 text-[13.5px] text-caution" data-testid="delegate-locked" data-locked={locked}>
          <span>{t(`missions.locked.${locked}`)}</span>
          {locked === "plan" && (
            <ButtonLink href="/workspace/plans" size="sm" className="min-h-11">
              {t("missions.locked.cta")}
            </ButtonLink>
          )}
        </div>
      ) : (
        <Button type="submit" variant="primary" size="lg" disabled={starting} data-testid="delegate-start" className={cx("min-h-11", focusRing)}>
          <Icon name="arrow" size={15} aria-hidden />
          {starting ? t("missions.delegate.starting") : t("missions.delegate.start")}
        </Button>
      )}
      {state.kind === "error" && (
        <p role="alert" className="rounded-lg bg-critical-soft px-4 py-3 text-[13.5px] text-critical" data-testid="delegate-error">
          {t(state.key)}
        </p>
      )}
    </form>
  );
}
