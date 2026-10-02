/**
 * Tracked opportunity view (Phase 16A). Server component, read-only: business language first, the seven
 * questions a tracked opportunity must answer, evidence on demand. No scores, no JSON, no engine objects.
 */
import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import type { TrackedOpportunity } from "@/lib/server/repositories/tracked-opportunities";
import type { CriticFinding, Scenario } from "@/lib/understanding/scenarios";
import { existingRoles } from "./dossier";
import { Badge, cx, focusRing } from "./ui";

type T = ReturnType<typeof createTranslator>;

export function trackedTitle(t: T, o: Pick<TrackedOpportunity, "mechanism" | "snapshot" | "targetName">): string {
  const own = o.snapshot.ownName;
  const s = o.snapshot.scenario;
  return t(`dossier.mechanisms.${o.mechanism}.title` as MessageKey, { provider: s.provider === "own" ? own : o.targetName, partner: s.provider === "own" ? o.targetName : own });
}

/** The decisive unknown: the scenario's first question. Like the dossier, questions are put to the other company. */
export function mainUnknown(t: T, o: Pick<TrackedOpportunity, "snapshot" | "targetName">, s: Scenario = o.snapshot.scenario): string | null {
  const key = s.questions[0];
  return key ? t(`dossier.questions.${key}` as MessageKey, { about: o.targetName, own: o.snapshot.ownName }) : null;
}

function H({ children }: { children: string }) {
  return <h2 className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">{children}</h2>;
}

export function TrackedOpportunityView({ o, scenario: s, locale }: { o: TrackedOpportunity; scenario: Scenario; locale: Locale }) {
  const t = createTranslator(locale);
  const own = o.snapshot.ownName;
  const target = o.targetName;
  const n = { provider: s.provider === "own" ? own : target, partner: s.provider === "own" ? target : own };
  const m = (k: string) => t(`dossier.mechanisms.${s.mechanism}.${k}` as MessageKey, n);
  const finding = (f: CriticFinding) => t(`dossier.critic.${f.code}` as MessageKey, { name: f.side === "own" ? own : f.side === "target" ? target : "" });
  const objections = s.critic.filter((f) => f.severity !== "minor");
  const support = [...s.contributions.provider.support, ...s.contributions.partner.support];

  return (
    <div className="space-y-7 text-[14.5px] leading-relaxed text-fg">
      <section>
        <H>{t("opportunities.sections.what")}</H>
        <p className="mt-1.5">{m("joint")}</p>
        <p className="mt-1 text-fg-muted">
          {t("dossier.revenueWho")}: {t(`dossier.payers.${s.revenue.payer}`, n)} · {t(`dossier.structures.${s.revenue.structure}`)}
        </p>
        {s.incremental && s.incremental.existing.length > 0 && (
          <p className="mt-2 rounded-lg bg-brand-soft/40 px-4 py-3 text-[14px]">
            {t("dossier.incremental", { target, own, existing: existingRoles(t, s.incremental.existing), creates: t(`dossier.roleNouns.${s.creates}`) })}
          </p>
        )}
      </section>

      <section>
        <H>{t("opportunities.sections.why")}</H>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>
            {t("dossier.brings", { name: n.provider })}: {m("provider")}
          </li>
          <li>
            {t("dossier.brings", { name: n.partner })}: {m("partner")}
          </li>
          <li>
            {m("problem")} <Badge tone="outline">{t("dossier.labels.hypothesis")}</Badge>
          </li>
        </ul>
        {s.whyNow.length > 0 && <p className="mt-2 text-fg-muted">{t("opportunities.whyNow", { list: s.whyNow.map((w) => w.statement.replace(/[.\s]+$/, "")).join(" · ") })}</p>}
      </section>

      <section>
        <H>{t("opportunities.sections.kill")}</H>
        {objections.length === 0 ? (
          <p className="mt-1.5 text-fg-muted">{t("opportunities.noKill")}</p>
        ) : (
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {objections.map((f) => (
              <li key={f.code}>{finding(f)}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <H>{t("opportunities.sections.evidence")}</H>
        <details className="mt-1.5" data-testid="tracked-evidence">
          <summary className={cx("cursor-pointer rounded text-[14px] font-medium text-brand", focusRing)}>{t("opportunities.evidenceCount", { count: support.length })}</summary>
          <ul className="mt-2 space-y-2">
            {support.map((x) => (
              <li key={`${x.side}:${x.key}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13.5px]">
                <Badge tone={x.state === "fact" ? "brand" : "neutral"}>{x.origin === "user" ? t("understanding.states.stated") : t(`understanding.states.${x.state}`)}</Badge>
                <span className="text-fg-muted">{x.side === "own" ? own : target}</span>
                <span className="min-w-0 break-words">
                  {["offering_form", "customer_scope", "revenue_model", "sales_motion", "regulation", "value_chain_role"].includes(x.facet)
                    ? t(`understanding.values.${x.facet}.${x.value}` as MessageKey)
                    : x.value}
                </span>
                {x.sourceUrl && (
                  <a href={x.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[12.5px] text-brand underline-offset-2 hover:underline">
                    {t("understanding.actions.source")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section>
        <H>{t("opportunities.sections.unknown")}</H>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">
          {s.questions.map((key) => (
            <li key={key}>{t(`dossier.questions.${key}` as MessageKey, { about: target, own })}</li>
          ))}
        </ol>
      </section>

      <section>
        <H>{t("opportunities.sections.next")}</H>
        <p className="mt-1.5 font-medium">{mainUnknown(t, o, s)}</p>
        <p className="mt-1 text-fg-muted">{m("experiment")}</p>
      </section>

      <section>
        <H>{t("opportunities.sections.companies")}</H>
        <ul className="mt-1.5 space-y-1">
          <li>
            {own} <span className="text-fg-muted">· {t("opportunities.ownRole")}</span>
          </li>
          <li>
            <Link href={`/workspace/network/${o.targetCompanyId}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
              {target}
            </Link>{" "}
            <span className="text-fg-muted">· {t("opportunities.targetRole")}</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
