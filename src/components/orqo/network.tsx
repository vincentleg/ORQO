import Link from "next/link";
import { formatDay } from "@/components/orqo/analysis";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { followUpBucket, type FollowUpView, type NetworkOrigin, type NetworkStage } from "@/lib/network/model";
import { FollowUpStatusButton } from "./network-forms";
import { Badge, cx, focusRing, type BadgeTone } from "./ui";

/*
 * Network relationship-memory display (Phase 6). Server components: they render
 * what people recorded, label it as private relationship knowledge, and show
 * "Not recorded" rather than guessing.
 */

const STAGE_TONE: Record<NetworkStage, BadgeTone> = {
  watching: "outline",
  identified: "neutral",
  contacted: "neutral",
  conversation: "brand",
  qualified: "brand",
  opportunity: "positive",
  customer_partner: "positive",
  dormant: "outline",
  not_relevant: "outline",
};

export function StageBadge({ locale, stage }: { locale: Locale; stage: NetworkStage | null }) {
  const t = createTranslator(locale);
  if (!stage) return <Badge tone="outline">{t("network.notRecorded")}</Badge>;
  return <Badge tone={STAGE_TONE[stage]}>{t(`network.stages.${stage}`)}</Badge>;
}

export function originLabel(locale: Locale, origin: NetworkOrigin | null): string {
  const t = createTranslator(locale);
  return origin ? t(`network.origins.${origin}`) : t("network.notRecorded");
}

/** A calendar day (YYYY-MM-DD) in the viewer's language. */
export function formatIsoDay(day: string, locale: Locale): string {
  return formatDay(`${day}T00:00:00Z`, locale);
}

export function dueText(locale: Locale, f: Pick<FollowUpView, "status" | "dueOn">, today: string): string {
  const t = createTranslator(locale);
  if (!f.dueOn) return t("network.due.none");
  const bucket = followUpBucket(f, today);
  if (bucket === "overdue") return t("network.due.overdue", { date: formatIsoDay(f.dueOn, locale) });
  if (bucket === "today") return t("network.due.today");
  return t("network.due.on", { date: formatIsoDay(f.dueOn, locale) });
}

export function DueLabel({ locale, followUp, today }: { locale: Locale; followUp: Pick<FollowUpView, "status" | "dueOn">; today: string }) {
  const bucket = followUpBucket(followUp, today);
  return <span className={cx("text-[12.5px] tabular-nums", bucket === "overdue" ? "font-medium text-critical" : bucket === "today" ? "font-medium text-caution" : "text-fg-muted")}>{dueText(locale, followUp, today)}</span>;
}

/** One follow-up with its company, due state and (for members) the actions that change it. */
export function FollowUpItem({
  locale,
  followUp,
  today,
  organizationId,
  canWrite,
  companyName,
  contactName,
  currentUserId,
}: {
  locale: Locale;
  followUp: FollowUpView;
  today: string;
  organizationId: string;
  canWrite: boolean;
  companyName?: string;
  contactName?: string | null;
  currentUserId: string;
}) {
  const t = createTranslator(locale);
  const open = followUp.status === "open";
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5" data-testid="follow-up-item">
      <div className="min-w-0 flex-1">
        <div className={cx("text-[14px] font-medium", open ? "text-fg" : "text-fg-muted line-through decoration-fg-faint")}>{followUp.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-fg-muted">
          {companyName && (
            <Link href={`/workspace/network/${followUp.companyId}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
              {companyName}
            </Link>
          )}
          {contactName && <span>· {contactName}</span>}
          {open ? (
            <DueLabel locale={locale} followUp={followUp} today={today} />
          ) : (
            <span>{t("network.followUps.closedOn", { status: t(`network.statuses.${followUp.status}`), date: followUp.closedAt ? formatDay(followUp.closedAt, locale) : "" })}</span>
          )}
          {followUp.priority === "high" && open && <Badge tone="caution">{t("network.priorities.high")}</Badge>}
          {followUp.origin === "interaction" && <span className="text-fg-faint">· {t("network.followUps.fromInteraction")}</span>}
          {followUp.origin === "signal" && <span className="text-fg-faint">· {t("network.followUps.fromSignal")}</span>}
          {followUp.assignedTo && <span className="text-fg-faint">· {followUp.assignedTo === currentUserId ? t("network.followUps.assignedToYou") : t("network.followUps.assigned")}</span>}
        </div>
        {followUp.description && <p className="mt-1 text-[13px] whitespace-pre-line text-fg-muted">{followUp.description}</p>}
      </div>
      {canWrite && (
        <div className="flex shrink-0 items-start gap-1.5">
          {open ? (
            <>
              <FollowUpStatusButton locale={locale} organizationId={organizationId} followUpId={followUp.id} status="done" />
              <FollowUpStatusButton locale={locale} organizationId={organizationId} followUpId={followUp.id} status="dismissed" variant="ghost" />
            </>
          ) : (
            <FollowUpStatusButton locale={locale} organizationId={organizationId} followUpId={followUp.id} status="open" variant="ghost" />
          )}
        </div>
      )}
    </li>
  );
}

