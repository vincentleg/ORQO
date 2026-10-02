import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDay } from "@/components/orqo/analysis";
import { StatusForm } from "@/components/orqo/opportunity-forms";
import { TrackedOpportunityView, trackedTitle } from "@/components/orqo/tracked-opportunity";
import { Badge, cx, focusRing, Page } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { getTrackedOpportunity } from "@/lib/server/repositories/tracked-opportunities";
import { getCompanyDossier } from "@/lib/server/repositories/understanding";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";
import { trackableScenario } from "@/lib/understanding/dossier";

export const dynamic = "force-dynamic";

/**
 * One tracked opportunity. The id comes from the URL and is only a lookup key: the record must belong to the
 * active organization (RLS + organization filter). The current assessment is recomputed from stored evidence
 * (no research, no provider) and compared with what was tracked.
 */
export default async function OpportunityPage({ params }: PageProps<"/workspace/opportunities/[opportunityId]">) {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const { opportunityId } = await params;
  const o = await getTrackedOpportunity(db, active.organizationId, opportunityId);
  if (!o) notFound();

  const resolved = await getCompanyDossier(db, active.organizationId, o.targetCompanyId);
  const live = resolved?.dossier ? trackableScenario(resolved.dossier, o.scenarioKey) : null;
  const now = live ? "same" : resolved?.dossier ? "changed" : "missing";
  const scenario = live ?? o.snapshot.scenario;
  const canWrite = roleAtLeast(active.role, "member");

  return (
    <Page width="narrow">
      <div>
        <Link href="/workspace/opportunities" className={cx("inline-flex items-center gap-1 rounded text-[13px] text-fg-muted hover:text-fg", focusRing)}>
          ← {t("opportunities.back")}
        </Link>
        <h1 className="mt-3 text-[24px] font-semibold tracking-tight text-fg" data-testid="opportunity-title">
          {trackedTitle(t, o)}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
          <Badge tone={o.status === "closed" ? "neutral" : o.status === "validated" ? "positive" : o.status === "paused" ? "caution" : "brand"}>{t(`opportunities.status.${o.status}`)}</Badge>
          <span>{t("opportunities.with", { target: o.targetName })}</span>
          <span>· {t("opportunities.trackedOn", { date: formatDay(o.createdAt, locale) })}</span>
        </div>
        <p
          className={cx("mt-4 rounded-lg px-4 py-3 text-[13.5px]", now === "same" ? "bg-positive-soft text-positive" : "bg-caution-soft text-caution")}
          role="status"
          data-testid="opportunity-now"
          data-now={now}
        >
          {t(`opportunities.now.${now}`, { target: o.targetName })}
          {now !== "same" && ` ${t("opportunities.asTracked", { date: formatDay(o.createdAt, locale) })}`}
        </p>
      </div>

      {canWrite && <StatusForm locale={locale} organizationId={active.organizationId} opportunityId={o.id} status={o.status} />}

      <TrackedOpportunityView o={o} scenario={scenario} locale={locale} />
    </Page>
  );
}
