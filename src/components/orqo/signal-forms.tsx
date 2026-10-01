"use client";

import { useActionState, useState } from "react";
import { createFollowUpFromSignalAction, recordSignalAction, setSignalStatusAction } from "@/app/actions/signals";
import type { ActionState } from "@/app/actions/workspace";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import type { ContactView } from "@/lib/network/model";
import { SIGNAL_KINDS } from "@/lib/signals/model";
import { FollowUpFields } from "./follow-up-fields";
import { Icon } from "./icons";
import { Button, Field, TextArea, inputClass } from "./ui";

/*
 * Intelligence & signals forms (Phase 7). Each posts to a server action that
 * re-checks membership and validates input; the organization id is only a
 * lookup key. Nothing here fetches a URL, calls a provider or contacts anyone.
 */

function ErrorLine({ locale, error }: { locale: Locale; error?: MessageKey }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical">
      {createTranslator(locale)(error)}
    </p>
  );
}

/** Reviewed / dismissed / restored: an explicit, visible state change. */
export function SignalStatusButton({ locale, organizationId, signalId, status, label }: { locale: Locale; organizationId: string; signalId: string; status: "new" | "reviewed" | "dismissed"; label: MessageKey }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(setSignalStatusAction, {});
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="signalId" value={signalId} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" size="sm" variant={status === "reviewed" ? "secondary" : "ghost"} disabled={pending} data-testid={`signal-${status}`}>
        {status === "reviewed" && <Icon name="check" size={14} />}
        {t(label)}
      </Button>
      <ErrorLine locale={locale} error={state.error} />
    </form>
  );
}

function useClosing(server: (s: ActionState, f: FormData) => Promise<ActionState>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const next = await server(prev, form);
    if (next.ok) setOpen(false);
    return next;
  }, {});
  return { open, setOpen, state, action, pending };
}

/** A follow-up on the signal's company, prefilled with the public change and its source. Created only on submit. */
export function SignalFollowUpForm({ locale, organizationId, signalId, contacts, title, description }: { locale: Locale; organizationId: string; signalId: string; contacts: readonly ContactView[]; title: string; description: string }) {
  const t = createTranslator(locale);
  const f = useClosing(createFollowUpFromSignalAction);
  if (!f.open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => f.setOpen(true)} data-testid="signal-create-follow-up">
        <Icon name="plus" size={14} />
        {t("signals.actions.createFollowUp")}
      </Button>
    );
  }
  return (
    <div className="w-full min-w-0 rounded-xl border border-edge bg-subtle/60 p-4">
      <form action={f.action} className="min-w-0 space-y-3" data-testid="signal-follow-up-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="signalId" value={signalId} />
        <FollowUpFields locale={locale} contacts={contacts} preset={{ title: title.slice(0, 200), contactId: null, description: description.slice(0, 4000) }} />
        <ErrorLine locale={locale} error={f.state.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={f.pending}>
            {t("network.followUps.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => f.setOpen(false)}>
            {t("network.contacts.cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** A public change a person read, with its source link. The link is stored, never fetched. */
export function RecordSignalForm({ locale, organizationId, companyId }: { locale: Locale; organizationId: string; companyId: string }) {
  const t = createTranslator(locale);
  const f = useClosing(recordSignalAction);
  if (!f.open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => f.setOpen(true)} data-testid="record-signal">
        <Icon name="plus" size={14} />
        {t("signals.record.button")}
      </Button>
    );
  }
  return (
    <div className="w-full min-w-0 rounded-xl border border-edge bg-subtle/60 p-4">
      <form action={f.action} className="min-w-0 space-y-3" data-testid="record-signal-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="companyId" value={companyId} />
        <p className="text-[12.5px] text-fg-muted">{t("signals.record.help")}</p>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-fg">{t("signals.record.kind")}</span>
          <select name="kind" defaultValue="geographic_expansion" required className={inputClass}>
            {SIGNAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`signals.kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <Field label={t("signals.record.headline")} name="headline" placeholder={t("signals.record.headlinePlaceholder")} minLength={3} maxLength={400} required className="min-w-0" />
        <TextArea label={t("signals.record.detail")} name="detail" maxLength={1000} rows={2} className="min-w-0" />
        <Field label={t("signals.record.sourceUrl")} name="sourceUrl" type="url" placeholder="https://" maxLength={2000} required className="min-w-0" />
        <fieldset className="min-w-0">
          <legend className="mb-1.5 block text-[13px] font-medium text-fg">{t("signals.record.sourceAuthority")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-fg">
            <label className="flex items-center gap-2">
              <input type="radio" name="sourceAuthority" value="official" defaultChecked className="accent-brand" />
              {t("signals.record.official")}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="sourceAuthority" value="third_party" className="accent-brand" />
              {t("signals.record.thirdParty")}
            </label>
          </div>
        </fieldset>
        {/* Plain text, not a native date input: an empty Safari date field paints today's date, which would read as "published today". Empty stays unknown. */}
        <Field label={t("signals.record.publishedOn")} hint={t("signals.record.publishedHelp")} name="publishedOn" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" maxLength={10} autoComplete="off" className="min-w-0" data-testid="signal-published-on" />
        <ErrorLine locale={locale} error={f.state.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={f.pending}>
            {t("signals.record.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => f.setOpen(false)}>
            {t("signals.record.cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}
