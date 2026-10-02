import Link from "next/link";
import { EvidenceCard, formatDate, formatDay, validationQuestion, RelevanceSection, UnderstandingCard, UnknownsCard } from "@/components/orqo/analysis";
import { Icon } from "@/components/orqo/icons";
import { AddSearchedToNetworkButton } from "@/components/orqo/network-forms";
import { EvidenceLegend, NextBestAction } from "@/components/orqo/patterns";
import { ResearchRunner, type RunOption } from "@/components/orqo/research-runner";
import { FeatureCard } from "@/components/orqo/plan";
import { Badge, Card, cx, focusRing, inputClass } from "@/components/orqo/ui";
import type { Plan } from "@/lib/entitlements/plans";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { analyzeRelevance } from "@/lib/intelligence/relevance";
import { findKnownCompany, parseSearchQuery, SEARCH_QUERY_MAX, websiteDomain, type SearchTarget } from "@/lib/search/query";
import { getOwnCompanyProfile, listCompanies, type OwnProfileRow } from "@/lib/server/repositories/companies";
import type { CompanyRow } from "@/lib/server/orqo/schemas";
import { cacheStatus } from "@/lib/server/research/config";
import { researchAvailability, type ModeAvailability } from "@/lib/server/research/policy";
import { findIntelligence } from "@/lib/server/research/repository";
import type { Db } from "@/lib/server/supabase/types";
import { roleAtLeast, type OrgRole } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";
import { getDossier, getOwnUnderstanding, loadOwnContext } from "@/lib/server/repositories/understanding";
import { understandCompany } from "@/lib/understanding";
import { DossierView } from "@/components/orqo/dossier";

export const dynamic = "force-dynamic";

const STEPS = [
  ["search.steps.understand", "search.steps.understandBody"],
  ["search.steps.compare", "search.steps.compareBody"],
  ["search.steps.synergies", "search.steps.synergiesBody"],
  ["search.steps.explain", "search.steps.explainBody"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

/**
 * Search — the ORQO home. Parsing, the "already in your Network" check and the
 * rendering of stored analyses are deterministic and read only this
 * workspace's data. Research runs only when the user asks for it, through the
 * research API route, which enforces entitlement, quota and hard limits.
 */
export default async function SearchPage({ searchParams }: PageProps<"/workspace">) {
  const { db, active, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const q = (await searchParams).q;
  const raw = typeof q === "string" ? q : "";
  const target = parseSearchQuery(raw);
  const [companies, own] = await Promise.all([listCompanies(db, active.organizationId), getOwnCompanyProfile(db, active.organizationId)]);
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
        <SearchResult target={target} known={known} own={own} role={active.role} db={db} organizationId={active.organizationId} locale={locale} plan={plan} query={raw} />
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

async function SearchResult({
  target,
  known,
  own,
  role,
  db,
  organizationId,
  locale,
  plan,
  query,
}: {
  target: SearchTarget;
  known: CompanyRow | null;
  own: OwnProfileRow | null;
  role: OrgRole;
  db: Db;
  organizationId: string;
  locale: Locale;
  plan: Plan;
  query: string;
}) {
  const t = createTranslator(locale);
  const canWrite = roleAtLeast(role, "member");
  const knownDomain = known?.website ? websiteDomain(known.website) : null;
  const domainKey = target.kind === "website" ? target.domain : knownDomain;
  const [intel, availability] = await Promise.all([
    findIntelligence(db, organizationId, domainKey ? { domain: domainKey } : { name: target.kind === "name" ? target.name : null }),
    researchAvailability(db, organizationId, role),
  ]);
  const ownCtx = own ? await loadOwnContext(db, organizationId, own) : null;
  // Phase 15: the dossier (scenarios, critic, revenue hypotheses) replaces the hardware-shaped relevance block.
  const ownUnderstanding = intel ? await getOwnUnderstanding(db, organizationId) : null;
  const dossier = intel ? await getDossier(db, organizationId, intel, ownUnderstanding) : null;
  const traits = intel && ownUnderstanding ? { own: new Set(ownUnderstanding.understanding.dna.traits), target: new Set(understandCompany({ companyName: intel.profile.name, website: intel.profile.website, intelligence: intel, validations: [] }).dna.traits) } : undefined;
  const analysis = intel ? analyzeRelevance(ownCtx, intel.profile, intel.hypotheses, traits) : null;
  const profile = intel?.profile ?? null;
  const label = profile?.name ?? (target.kind === "website" ? target.domain : target.name);
  const cache = intel ? cacheStatus(intel.researchedAt) : null;
  const stale = cache?.stale ?? false;
  const refreshFrom = cache?.refreshFrom ?? null;
  const canRefresh = cache?.canRefresh ?? true;

  const denied = (a: ModeAvailability): MessageKey | null => (a.state === "available" ? null : `research.denied.${a.reason}`);
  const options: RunOption[] = [{ mode: "basic", deniedKey: denied(availability.basic) }];
  if (availability.deep.state === "available" || (availability.deep.state === "denied" && availability.deep.reason !== "plan_required")) {
    if (availability.deep.state === "available" || intel?.mode !== "deep") options.push({ mode: "deep", deniedKey: denied(availability.deep) });
  }
  const top = analysis?.opportunities[0] ?? analysis?.hypotheses[0];
  // The next action targets the unknown that would most quickly confirm or kill the leading opportunity.
  const question = top ? validationQuestion(top, label, own?.name ?? "", locale) : null;
  const nba = !analysis
    ? null
    : analysis.status === "own_profile_missing"
      ? { title: t("analysis.completeProfile"), body: t("analysis.ownMissingBody"), href: "/workspace/company" }
      : top && question
        ? {
            title: question,
            body: t("analysis.nbaBody", { relationship: t(`analysis.relationships.${top.relationship}`) }),
            href: known ? `/workspace/network/${known.id}` : "#search-result",
          }
        : null;

  return (
    <div className="mt-8 space-y-5" data-testid="search-result" id="search-result">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Icon name={target.kind === "website" || profile ? "globe" : "company"} size={20} />
            </span>
            <div className="min-w-0">
              <div className="text-[12px] font-medium uppercase tracking-wide text-fg-faint">{t(target.kind === "website" ? "search.result.website" : "search.result.name")}</div>
              <div className="truncate text-[20px] font-semibold tracking-tight text-fg" data-testid="target-name">
                {label}
              </div>
              {profile && (
                <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow" className={cx("rounded text-[13px] text-brand hover:underline", focusRing)}>
                  {profile.domain}
                </a>
              )}
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
        {intel && profile && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-fg-muted" data-testid="research-meta">
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" size={13} />
              {t("analysis.researchedAt", { date: formatDate(intel.researchedAt, locale) })}
            </span>
            <span>· {profile.sources.length === 1 ? t("analysis.source") : t("analysis.sources", { n: profile.sources.length })}</span>
            <span>· {intel.mode === "deep" ? t("analysis.modeDeep") : t("analysis.modeBasic")}</span>
            {stale && <Badge tone="caution">{t("analysis.stale")}</Badge>}
            <span className="w-full text-[12px] text-fg-faint">{t("analysis.stored")}</span>
          </div>
        )}
        {profile?.resolution.method === "inferred_domain" && (
          <p className="mt-3 rounded-lg bg-caution-soft px-3 py-2 text-[12.5px] text-caution" data-testid="inferred-website">
            {t("analysis.inferredWebsite")}
          </p>
        )}
        <div className="mt-4 border-t border-edge pt-4">
          {known ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px] text-fg-muted">
                <span className="font-medium text-fg">{known.name}</span> · {t("search.result.alreadyKnown", { date: formatDay(known.created_at, locale) })}
              </p>
              <Link href={`/workspace/network/${known.id}`} className={cx("rounded text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
                {t("search.result.openNetwork")} →
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-[13.5px] text-fg-muted">{t("search.result.notInNetworkBody")}</p>
              {canWrite && (
<AddSearchedToNetworkButton locale={locale} organizationId={organizationId} query={query} />
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5" data-testid="research-panel">
        {!intel && (
          <>
            <h2 className="text-[15px] font-semibold text-fg">{t("research.runTitle", { target: label })}</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-fg-muted">{own ? t("research.runBody", { own: own.name }) : t("research.runBodyNoOwn")}</p>
          </>
        )}
        <div className={cx(!intel && "mt-4")}>
          {intel && !canRefresh ? (
            <p className="flex items-center gap-2 text-[12.5px] text-fg-muted" data-testid="refresh-later">
              <Icon name="refresh" size={13} />
              {t("research.refreshAfter", { date: formatDate(refreshFrom ?? intel.researchedAt, locale) })}
            </p>
          ) : (
            <ResearchRunner locale={locale} organizationId={organizationId} query={profile?.domain ?? query} ownName={own?.name ?? null} options={options} refresh={Boolean(intel)} />
          )}
          {availability.basic.state === "available" && (!intel || canRefresh) && (
            <p className="mt-2 text-[12px] text-fg-faint" data-testid="research-remaining">
              {t("research.remaining", { n: availability.basic.remaining, limit: availability.basic.limit })}
              {intel && ` ${t("research.refreshLimitNote")}`}
            </p>
          )}
        </div>
      </Card>

      {intel && profile && analysis && (
        <>
          {dossier ? (
            <>
              <DossierView dossier={dossier} locale={locale} reportHref={`/workspace/report?q=${encodeURIComponent(profile.domain)}`} />
              <UnderstandingCard profile={profile} locale={locale} />
            </>
          ) : (
            <>
              <UnderstandingCard profile={profile} locale={locale} />
              <RelevanceSection analysis={analysis} profile={profile} own={own?.name ?? null} ownContext={ownCtx} locale={locale} canEditProfile={canWrite} />
              {nba && <NextBestAction locale={locale} title={nba.title} body={nba.body} href={nba.href} />}
            </>
          )}
          <UnknownsCard analysis={analysis} locale={locale} canEditProfile={canWrite} />
          <EvidenceCard profile={profile} locale={locale} deep={intel.mode === "deep"} />
        </>
      )}

      {!intel && (
        <div className="rounded-xl border border-edge bg-surface p-5 shadow-card">
          <EvidenceLegend locale={locale} />
        </div>
      )}

      {availability.deep.state === "denied" && availability.deep.reason === "plan_required" && (
        <FeatureCard plan={plan} feature="search.deepResearch" title={t("search.result.deepResearch")} body={t("search.result.deepResearchBody")} icon="search" locale={locale} />
      )}
    </div>
  );
}
