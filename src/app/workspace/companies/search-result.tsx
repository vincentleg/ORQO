/**
 * Company lookup result (moved from the old Search home in Phase 16B; behaviour unchanged).
 * Parsing, the "already remembered" check and the rendering of stored analyses are deterministic and read only
 * this workspace's data. Research runs only when the user asks for it, through the research API route, which
 * enforces entitlement, quota and hard limits.
 */
import Link from "next/link";
import { EvidenceCard, formatDate, formatDay, validationQuestion, RelevanceSection, UnderstandingCard, UnknownsCard } from "@/components/orqo/analysis";
import { Icon } from "@/components/orqo/icons";
import { AddSearchedToNetworkButton } from "@/components/orqo/network-forms";
import { EvidenceLegend, NextBestAction } from "@/components/orqo/patterns";
import { ResearchRunner, type RunOption } from "@/components/orqo/research-runner";
import { FeatureCard } from "@/components/orqo/plan";
import { Badge, Card, cx, focusRing } from "@/components/orqo/ui";
import type { Plan } from "@/lib/entitlements/plans";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { analyzeRelevance } from "@/lib/intelligence/relevance";
import { websiteDomain, type SearchTarget } from "@/lib/search/query";
import type { OwnProfileRow } from "@/lib/server/repositories/companies";
import type { CompanyRow } from "@/lib/server/orqo/schemas";
import { cacheStatus } from "@/lib/server/research/config";
import { researchAvailability, type ModeAvailability } from "@/lib/server/research/policy";
import { findIntelligence } from "@/lib/server/research/repository";
import type { Db } from "@/lib/server/supabase/types";
import { roleAtLeast, type OrgRole } from "@/lib/server/tenancy/roles";
import { getDossier, getOwnUnderstanding, loadOwnContext } from "@/lib/server/repositories/understanding";
import { understandCompany } from "@/lib/understanding";
import { DossierView } from "@/components/orqo/dossier";
import { listTrackedOpportunities } from "@/lib/server/repositories/tracked-opportunities";
import { getNetworkCompany } from "@/lib/server/repositories/network-memory";

export async function SearchResult({
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
  // Phase 16A: a remembered company brings its relationship answer and Network stage; its tracked opportunities show as tracked.
  const [dossier, tracked] = await Promise.all([
    intel ? getDossier(db, organizationId, intel, ownUnderstanding, known ? { id: known.id, stage: (await getNetworkCompany(db, organizationId, known.id))?.stage ?? null } : null) : Promise.resolve(null),
    known ? listTrackedOpportunities(db, organizationId, { companyId: known.id }) : Promise.resolve([]),
  ]);
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
            href: known ? `/workspace/companies/${known.id}` : "#search-result",
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
              <Link href={`/workspace/companies/${known.id}`} className={cx("rounded text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
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
              <DossierView
                dossier={dossier}
                locale={locale}
                reportHref={`/workspace/report?q=${encodeURIComponent(profile.domain)}`}
                actions={{ organizationId, companyId: known?.id ?? null, q: known ? null : query, tracked: Object.fromEntries(tracked.map((o) => [o.scenarioKey, o.id])), canWrite, locale }}
              />
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
