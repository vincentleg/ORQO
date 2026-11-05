import Link from "next/link";
import { notFound } from "next/navigation";
import { MissionLive } from "@/components/orqo/mission-live";
import { formatDay, titleText } from "@/components/orqo/missions";
import { cx, focusRing, Page } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { AppError } from "@/lib/server/errors";
import { getMissionDetail, missionBody, type MissionDetail } from "@/lib/server/missions/service";
import { listCompanies } from "@/lib/server/repositories/companies";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * One mission (Phase 17C): its live progress and, once finished, the ORQO Briefing. The page renders the
 * persisted state (so a refresh shows exactly where the mission is); for members the live view then drives
 * the mission through the execute API. Only the creator or an admin is offered Stop (cancel_mission checks it).
 */
export default async function MissionPage({ params }: PageProps<"/workspace/missions/[missionId]">) {
  const { missionId } = await params;
  const { db, user, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  let detail: MissionDetail;
  try {
    detail = await getMissionDetail(db, user.id, active.organizationId, missionId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const view = missionBody(detail);
  const companies = (await listCompanies(db, active.organizationId)).filter((c) => !c.is_own_company);
  const names = Object.fromEntries(companies.map((c) => [c.id, c.name]));
  const canExecute = roleAtLeast(active.role, "member");
  const canCancel = canExecute && (detail.mission.created_by === user.id || roleAtLeast(active.role, "admin"));

  return (
    <Page width="narrow">
      <Link href="/workspace/missions" className={cx("inline-block rounded text-[13px] font-medium text-brand hover:underline", focusRing)}>
        ← {t("missions.back")}
      </Link>
      <header className="-mt-4 space-y-1">
        <p className="text-[12px] font-semibold tracking-wide text-brand uppercase">{t("missions.title")}</p>
        <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-fg md:text-[28px]" data-testid="mission-title">
          {titleText(t, view, names)}
        </h1>
        <p className="text-[13px] text-fg-faint">{view.mission.finishedAt ? t("missions.finished", { date: formatDay(view.mission.finishedAt, locale) }) : t("missions.started", { date: formatDay(view.mission.createdAt, locale) })}</p>
      </header>
      <MissionLive initial={view} locale={locale} organizationId={active.organizationId} canExecute={canExecute} canCancel={canCancel} names={names} />
    </Page>
  );
}
