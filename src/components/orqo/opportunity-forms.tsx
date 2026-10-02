"use client";

import Link from "next/link";
import { useActionState } from "react";
import { answerRelationshipAction, setTrackedStatusAction, trackOpportunityAction, type TrackState } from "@/app/actions/opportunities";
import type { ActionState } from "@/app/actions/workspace";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { Badge, Button, cx, focusRing } from "./ui";

const TRACKED_STATUSES = ["investigating", "validated", "paused", "closed"] as const;
const ROLE_ANSWERS = ["customer", "supplier", "channel", "partner", "competitor"] as const;

/**
 * "Track this opportunity". Sends only the remembered company (or, from Search, the query) and the scenario key:
 * the server recomputes the dossier and refuses anything that is not a credible opportunity.
 */
export function TrackButton({
  locale,
  organizationId,
  companyId,
  q,
  scenarioKey,
  trackedId,
  targetName,
}: {
  locale: Locale;
  organizationId: string;
  companyId: string | null;
  q: string | null;
  scenarioKey: string;
  trackedId: string | null;
  targetName: string;
}) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<TrackState, FormData>(trackOpportunityAction, {});
  const id = state.opportunityId ?? trackedId;
  if (id)
    return (
      <div className="flex flex-wrap items-center gap-3" data-testid="tracked" role="status">
        <Badge tone="positive" icon="check">
          {t("dossier.track.tracked")}
        </Badge>
        <Link href={`/workspace/opportunities/${id}`} className={cx("rounded text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
          {t("dossier.track.open")} →
        </Link>
      </div>
    );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      {companyId ? <input type="hidden" name="companyId" value={companyId} /> : <input type="hidden" name="q" value={q ?? ""} />}
      <input type="hidden" name="scenarioKey" value={scenarioKey} />
      <Button type="submit" variant="primary" disabled={pending} className="min-h-11" data-testid="track-opportunity">
        {pending ? t("dossier.track.tracking") : t("dossier.track.action")}
      </Button>
      {!companyId && <span className="text-[12.5px] text-fg-muted">{t("dossier.track.remembers", { target: targetName })}</span>}
      {state.error && (
        <span role="alert" className="text-[12.5px] text-critical">
          {t(state.error)}
        </span>
      )}
    </form>
  );
}

/** "How does this company work with you today?": only the user can know it; asked once, then remembered. */
export function RelationshipQuestion({ locale, organizationId, companyId, ownName, targetName }: { locale: Locale; organizationId: string; companyId: string; ownName: string; targetName: string }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(answerRelationshipAction, {});
  if (state.ok)
    return (
      <p role="status" className="text-[13.5px] text-positive" data-testid="relationship-saved">
        {t("dossier.relationship.saved")}
      </p>
    );
  return (
    <form action={action} className="space-y-3" data-testid="relationship-question">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="companyId" value={companyId} />
      <fieldset>
        <legend className="text-[15px] font-medium text-fg">{t("dossier.relationship.question", { target: targetName, own: ownName })}</legend>
        <p className="mt-1 text-[12.5px] text-fg-muted">{t("dossier.relationship.questionHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ROLE_ANSWERS.map((v) => (
            <label
              key={v}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-edge px-4 text-[13.5px] text-fg has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40"
            >
              <input type="checkbox" name="values" value={v} className="size-4 accent-[var(--color-brand)]" />
              {t(`dossier.relationship.answers.${v}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending} className="min-h-11">
          {pending ? t("dossier.relationship.saving") : t("dossier.relationship.submit")}
        </Button>
        <Button type="submit" name="values" value="none" disabled={pending} className="min-h-11">
          {t("dossier.relationship.answers.none")}
        </Button>
        <Button type="submit" name="values" value="not_sure" variant="ghost" disabled={pending} className="min-h-11">
          {t("dossier.relationship.answers.not_sure")}
        </Button>
        {state.error && (
          <span role="alert" className="text-[12.5px] text-critical">
            {t(state.error)}
          </span>
        )}
      </div>
    </form>
  );
}

/** Four plain statuses. Not a pipeline. */
export function StatusForm({ locale, organizationId, opportunityId, status }: { locale: Locale; organizationId: string; opportunityId: string; status: (typeof TRACKED_STATUSES)[number] }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(setTrackedStatusAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" data-testid="status-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <label className="block">
        <span className="block text-[12.5px] font-medium text-fg-muted">{t("opportunities.statusLabel")}</span>
        <select name="status" defaultValue={status} className={cx("mt-1 h-11 rounded-lg border border-edge-strong bg-surface px-3 text-[14px] text-fg", focusRing)}>
          {TRACKED_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`opportunities.status.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={pending} className="h-11">
        {t("opportunities.statusSave")}
      </Button>
      {state.ok && (
        <span role="status" className="pb-3 text-[12.5px] text-positive">
          {t("opportunities.statusSaved")}
        </span>
      )}
      {state.error && (
        <span role="alert" className="pb-3 text-[12.5px] text-critical">
          {t(state.error)}
        </span>
      )}
    </form>
  );
}
