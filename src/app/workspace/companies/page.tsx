import Link from "next/link";
import { formatDay } from "@/components/orqo/analysis";
import { Icon } from "@/components/orqo/icons";
import { Badge, ButtonLink, cx, EmptyState, focusRing, inputClass, Monogram, Page } from "@/components/orqo/ui";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { parseSearchQuery, SEARCH_QUERY_MAX, findKnownCompany } from "@/lib/search/query";
import { loadWorkspaceMemory } from "@/lib/server/ceo/memory";
import { getOwnCompanyProfile, listCompanies } from "@/lib/server/repositories/companies";
import { loadWorkspace } from "@/lib/server/workspace";
import { NOT_SURE } from "@/lib/understanding/types";
import { SearchResult } from "./search-result";

export const dynamic = "force-dynamic";

/**
 * Companies (Phase 16B): the one place to look up a company and to see every company ORQO remembers.
 * Looking up is deterministic and reads stored records; research runs only when the user starts it (existing
 * research route, plan gates and quota). The list shows Business Memory signals, never engine internals.
 */
export default async function CompaniesPage({ searchParams }: PageProps<"/workspace/companies">) {
  const { db, active, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const q = (await searchParams).q;
  const raw = typeof q === "string" ? q : "";
  const target = parseSearchQuery(raw);
  const [memory, companies, own] = await Promise.all([loadWorkspaceMemory(db, active.organizationId), listCompanies(db, active.organizationId), getOwnCompanyProfile(db, active.organizationId)]);
  const known = target ? findKnownCompany(target, companies.filter((c) => !c.is_own_company)) : null;

  return (
    <Page>
      <header className="max-w-2xl">
        <h1 className="text-[28px] font-semibold tracking-tight text-fg">{t("companies.title")}</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-fg-muted">{t("companies.subtitle")}</p>
      </header>

      <form action="/workspace/companies" method="get" role="search" className="max-w-2xl" data-testid="companies-search">
        <label htmlFor="q" className="sr-only">
          {t("companies.searchLabel")}
        </label>
        <div className="flex flex-col gap-2 sm:relative sm:block">
          <span className="pointer-events-none absolute top-[28px] left-4 hidden -translate-y-1/2 text-fg-faint sm:block">
            <Icon name="search" size={18} />
          </span>
          <input id="q" name="q" type="search" defaultValue={raw} maxLength={SEARCH_QUERY_MAX} placeholder={t("companies.searchPlaceholder")} autoComplete="off" className={cx(inputClass, "h-14 rounded-2xl px-5 text-[16px] shadow-raised sm:pr-36 sm:pl-12")} />
          <button type="submit" className={cx("h-12 rounded-xl bg-brand px-5 text-[15px] font-medium text-white hover:bg-brand-strong sm:absolute sm:top-1/2 sm:right-2 sm:h-10 sm:-translate-y-1/2", focusRing)}>
            {t("companies.searchSubmit")}
          </button>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-fg-muted">
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
        </p>
      </form>

      {raw && !target && (
        <p role="alert" className="max-w-2xl rounded-lg bg-caution-soft px-4 py-3 text-[13.5px] text-caution">
          {t("search.invalid")}
        </p>
      )}

      {target ? (
        <div className="max-w-3xl">
          <SearchResult target={target} known={known} own={own} role={active.role} db={db} organizationId={active.organizationId} locale={locale} plan={plan} query={raw} />
        </div>
      ) : memory.companies.length === 0 ? (
        <div className="rounded-2xl bg-surface shadow-card" data-testid="companies-empty">
          <EmptyState icon="company" title={t("companies.empty.title")} body={t("companies.empty.body")} />
        </div>
      ) : (
        <section aria-labelledby="remembered-title" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="remembered-title" className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
              {t("companies.rememberedTitle", { count: memory.companies.length })}
            </h2>
            <Link href="/workspace/network" className={cx("rounded text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
              {t("companies.relationshipView")}
            </Link>
          </div>
          <ul className="divide-y divide-edge rounded-2xl bg-surface shadow-card" data-testid="companies-list">
            {memory.companies.map((r) => (
              <li key={r.company.id}>
                <Link href={`/workspace/companies/${r.company.id}`} className={cx("flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3", focusRing)} data-testid="company-item">
                  <span className="flex min-w-0 items-center gap-3">
                    <Monogram name={r.company.name} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg">{r.company.name}</span>
                      {r.domain && <span className="block truncate text-[13px] text-fg-muted">{r.domain}</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
                    {r.research ? <span>{t("work.signals.researched", { date: formatDay(r.research.researchedAt, locale) })}</span> : <span>{t("work.signals.notResearched")}</span>}
                    {r.statedRelationship && r.statedRelationship !== NOT_SURE && <span>{t("work.signals.relationshipKnown")}</span>}
                    {r.tracked.length > 0 && <Badge tone="brand">{t("work.signals.tracked")}</Badge>}
                    {r.company.stage && <span>{t(`network.stages.${r.company.stage}` as MessageKey)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!target && memory.unremembered.length > 0 && (
        <section aria-labelledby="researched-title" className="space-y-3">
          <h2 id="researched-title" className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
            {t("companies.researchedTitle", { count: memory.unremembered.length })}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {memory.unremembered.slice(0, 12).map((r) => (
              <li key={r.domain}>
                <Link href={`/workspace/companies?q=${encodeURIComponent(r.domain)}`} className={cx("inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-[14px] text-fg hover:border-brand/40", focusRing)}>
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!target && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-subtle px-5 py-5" aria-labelledby="find-title">
          <div className="max-w-xl">
            <h2 id="find-title" className="text-[15px] font-semibold text-fg">
              {t("companies.find")}
            </h2>
            <p className="mt-0.5 text-[14px] text-fg-muted">{t("companies.findBody")}</p>
          </div>
          <ButtonLink href="/workspace/discover" className="min-h-11">
            {t("companies.find")}
          </ButtonLink>
        </section>
      )}
    </Page>
  );
}
