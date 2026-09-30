import Link from "next/link";
import { AddToNetworkButton } from "@/components/saas/forms";
import { Icon } from "@/components/orqo/icons";
import { EvidenceLegend } from "@/components/orqo/patterns";
import { FeatureCard } from "@/components/orqo/plan";
import { Badge, Card, cx, focusRing, inputClass } from "@/components/orqo/ui";
import type { Plan } from "@/lib/entitlements/plans";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { findKnownCompany, parseSearchQuery, SEARCH_QUERY_MAX, type SearchTarget } from "@/lib/search/query";
import { listCompanies } from "@/lib/server/repositories/companies";
import type { CompanyRow } from "@/lib/server/orqo/schemas";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const STEPS = [
  ["search.steps.understand", "search.steps.understandBody"],
  ["search.steps.compare", "search.steps.compareBody"],
  ["search.steps.synergies", "search.steps.synergiesBody"],
  ["search.steps.explain", "search.steps.explainBody"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const QUESTIONS = ["what", "bring", "need", "why", "whyNow", "next"] as const;

/**
 * Search — the ORQO home. Parsing and the "already in your Network" check are
 * deterministic and read only this workspace's data; no query is sent to an
 * AI or web provider. Company analysis arrives with Web Intelligence.
 */
export default async function SearchPage({ searchParams }: PageProps<"/workspace">) {
  const { db, active, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const q = (await searchParams).q;
  const raw = typeof q === "string" ? q : "";
  const target = parseSearchQuery(raw);
  const companies = await listCompanies(db, active.organizationId);
  const own = companies.find((c) => c.is_own_company) ?? null;
  const known = target ? findKnownCompany(target, companies.filter((c) => !c.is_own_company)) : null;

  return (
    <div className={cx("mx-auto w-full max-w-3xl px-5 md:px-10", target || raw ? "py-10" : "py-16 md:py-24")}>
      <div className={cx(!target && !raw && "text-center")}>
        <h1 className={cx("font-semibold tracking-tight text-fg", target || raw ? "text-[24px]" : "text-[32px] md:text-[38px]")}>{t("search.title")}</h1>
      </div>

      <form action="/workspace" method="get" role="search" className="mt-6">
        <label htmlFor="q" className="sr-only">
          {t("search.label")}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-fg-faint">
            <Icon name="search" size={18} />
          </span>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={raw}
            maxLength={SEARCH_QUERY_MAX}
            placeholder={t("search.placeholder")}
            autoComplete="off"
            autoFocus={!raw}
            className={cx(inputClass, "h-14 rounded-2xl pr-32 pl-12 text-[16px] shadow-raised")}
          />
          <button type="submit" className={cx("absolute top-1/2 right-2 h-10 -translate-y-1/2 rounded-xl bg-brand px-5 text-[14px] font-medium text-white hover:bg-brand-strong", focusRing)}>
            {t("search.submit")}
          </button>
        </div>
      </form>

      <div className={cx("mt-3 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted", !target && !raw && "justify-center")}>
        {own ? (
          <span className="inline-flex items-center gap-1.5" data-testid="search-context">
            <Icon name="company" size={14} />
            {t("search.comparingAs", { company: own.name })}
          </span>
        ) : (
          <span>
            {t("search.noOwnCompany")}{" "}
            <Link href="/workspace/company" className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
              {t("search.setUpCompany")}
            </Link>
          </span>
        )}
      </div>

      {raw && !target && (
        <p role="alert" className="mt-6 rounded-lg bg-caution-soft px-4 py-3 text-[13.5px] text-caution">
          {t("search.invalid")}
        </p>
      )}

      {target ? (
        <SearchResult target={target} known={known} canWrite={roleAtLeast(active.role, "member")} organizationId={active.organizationId} locale={locale} plan={plan} />
      ) : (
        <section className="mt-14" aria-labelledby="steps-title">
          <h2 id="steps-title" className="text-center text-[12.5px] font-semibold uppercase tracking-wide text-fg-faint">
            {t("search.stepsTitle")}
          </h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="rounded-xl border border-edge bg-surface p-4 shadow-card">
                <span className="text-[12px] font-semibold text-brand tabular-nums">0{i + 1}</span>
                <div className="mt-1.5 text-[14px] font-semibold text-fg">{t(title)}</div>
                <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{t(body)}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-center text-[12.5px] text-fg-faint">{t("search.honesty")}</p>
        </section>
      )}
    </div>
  );
}

function SearchResult({
  target,
  known,
  canWrite,
  organizationId,
  locale,
  plan,
}: {
  target: SearchTarget;
  known: CompanyRow | null;
  canWrite: boolean;
  organizationId: string;
  locale: Locale;
  plan: Plan;
}) {
  const t = createTranslator(locale);
  const label = target.kind === "website" ? target.domain : target.name;
  return (
    <div className="mt-8 space-y-5" data-testid="search-result">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Icon name={target.kind === "website" ? "globe" : "company"} size={20} />
            </span>
            <div className="min-w-0">
              <div className="text-[12px] font-medium uppercase tracking-wide text-fg-faint">{t(target.kind === "website" ? "search.result.website" : "search.result.name")}</div>
              <div className="truncate text-[20px] font-semibold tracking-tight text-fg">{label}</div>
            </div>
          </div>
          {known ? (
            <Badge tone="positive" icon="check">
              {t("search.result.inNetwork")}
            </Badge>
          ) : (
            <Badge tone="outline">{t("search.result.notInNetwork")}</Badge>
          )}
        </div>
        <div className="mt-4 border-t border-edge pt-4">
          {known ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px] text-fg-muted">
                <span className="font-medium text-fg">{known.name}</span> · {t("search.result.inNetworkBody")}
              </p>
              <Link href="/workspace/network" className={cx("rounded text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
                {t("search.result.openNetwork")} →
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-[13.5px] text-fg-muted">{t("search.result.notInNetworkBody")}</p>
              {canWrite && (
                <AddToNetworkButton locale={locale} organizationId={organizationId} name={target.kind === "website" ? target.domain : target.name} website={target.kind === "website" ? target.url : undefined} />
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5" data-testid="analysis-preview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-fg">{t("search.result.analysisTitle")}</h2>
          <Badge tone="neutral" icon="clock">
            {t("access.comingSoon")}
          </Badge>
        </div>
        <p className="mt-1 text-[13.5px] text-fg-muted">{t("search.result.analysisStatus")}</p>
        <h3 className="mt-5 text-[13px] font-semibold text-fg">{t("search.result.questionsTitle")}</h3>
        <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {QUESTIONS.map((k) => (
            <li key={k} className="flex items-start gap-2 text-[13.5px] text-fg-muted">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-faint" aria-hidden />
              {t(`search.result.questions.${k}`)}
            </li>
          ))}
        </ul>
        <div className="mt-5 border-t border-edge pt-5">
          <EvidenceLegend locale={locale} />
        </div>
      </Card>

      <FeatureCard plan={plan} feature="search.deepResearch" title={t("search.result.deepResearch")} body={t("search.result.deepResearchBody")} icon="search" locale={locale} />
    </div>
  );
}
