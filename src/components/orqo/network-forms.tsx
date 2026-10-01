"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import {
  addSearchedCompanyAction,
  createFollowUpAction,
  recordInteractionAction,
  saveContactAction,
  setFollowUpStatusAction,
  updateRelationshipAction,
  type AddSearchedState,
} from "@/app/actions/network";
import type { ActionState } from "@/app/actions/workspace";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { INTERACTION_KINDS, NETWORK_ORIGINS, NETWORK_STAGES, type ContactView, type FollowUpStatus, type NetworkOrigin, type NetworkStage } from "@/lib/network/model";
import { FollowUpFields } from "./follow-up-fields";
import { Icon } from "./icons";
import { Button, Field, TextArea, cx, focusRing, inputClass } from "./ui";

/*
 * Network relationship-memory forms (Phase 6). Each one posts to a server
 * action that re-checks membership and validates input; the organization id
 * is only a lookup key. Nothing here calls a provider or contacts anyone.
 */

type ServerAction<S> = (state: S, form: FormData) => Promise<S>;

function ErrorLine({ locale, error }: { locale: Locale; error?: MessageKey }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical">
      {createTranslator(locale)(error)}
    </p>
  );
}

function Select({ label, name, defaultValue, children, required }: { label: string; name: string; defaultValue?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg">{label}</span>
      <select name={name} defaultValue={defaultValue} required={required} className={inputClass}>
        {children}
      </select>
    </label>
  );
}

function Hidden({ organizationId, companyId }: { organizationId: string; companyId?: string }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
    </>
  );
}

/** A form inside a disclosure that closes itself once the action succeeds. */
function useClosingAction(server: ServerAction<ActionState>, initiallyOpen = false) {
  const [open, setOpen] = useState(initiallyOpen);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const next = await server(prev, form);
    if (next.ok) setOpen(false);
    return next;
  }, {});
  return { open, setOpen, state, action, pending };
}

function Disclosure({ open, setOpen, label, icon = "plus", children, testId }: { open: boolean; setOpen: (v: boolean) => void; label: string; icon?: "plus" | "settings"; children: ReactNode; testId?: string }) {
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid={testId}>
        <Icon name={icon} size={14} />
        {label}
      </Button>
    );
  }
  return <div className="w-full min-w-0 rounded-xl border border-edge bg-subtle/60 p-4">{children}</div>;
}

// ---------------------------------------------------------------------------
// Relationship (stage, origin, why it matters)
// ---------------------------------------------------------------------------

export function RelationshipForm({ locale, organizationId, companyId, stage, origin, reason }: { locale: Locale; organizationId: string; companyId: string; stage: NetworkStage | null; origin: NetworkOrigin | null; reason: string }) {
  const t = createTranslator(locale);
  const f = useClosingAction(updateRelationshipAction);
  return (
    <Disclosure open={f.open} setOpen={f.setOpen} label={t("network.relationship.edit")} icon="settings" testId="edit-relationship">
      <form action={f.action} className="space-y-3" data-testid="relationship-form">
        <Hidden organizationId={organizationId} companyId={companyId} />
        <Select label={t("network.relationship.stage")} name="stage" defaultValue={stage ?? ""}>
          <option value="">{t("network.notRecorded")}</option>
          {NETWORK_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`network.stages.${s}`)}
            </option>
          ))}
        </Select>
        <Select label={t("network.relationship.origin")} name="origin" defaultValue={origin ?? ""}>
          <option value="">{t("network.notRecorded")}</option>
          {NETWORK_ORIGINS.map((o) => (
            <option key={o} value={o}>
              {t(`network.origins.${o}`)}
            </option>
          ))}
        </Select>
        <TextArea label={t("network.relationship.reason")} name="reason" defaultValue={reason} maxLength={2000} rows={3} placeholder={t("network.relationship.reasonPlaceholder")} />
        <ErrorLine locale={locale} error={f.state.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={f.pending}>
            {t("network.relationship.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => f.setOpen(false)}>
            {t("network.contacts.cancel")}
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export function ContactForm({ locale, organizationId, companyId, contact }: { locale: Locale; organizationId: string; companyId: string; contact?: ContactView }) {
  const t = createTranslator(locale);
  const f = useClosingAction(saveContactAction);
  return (
    <Disclosure open={f.open} setOpen={f.setOpen} label={contact ? t("network.contacts.edit") : t("network.contacts.add")} icon={contact ? "settings" : "plus"} testId={contact ? `edit-contact-${contact.id}` : "add-contact"}>
      <form action={f.action} className="space-y-3" data-testid="contact-form">
        <Hidden organizationId={organizationId} companyId={companyId} />
        {contact && <input type="hidden" name="contactId" value={contact.id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("network.contacts.name")} name="name" defaultValue={contact?.name} maxLength={200} required />
          <Field label={t("network.contacts.role")} name="role" defaultValue={contact?.role} maxLength={200} />
          <Field label={t("network.contacts.email")} name="email" type="email" defaultValue={contact?.email ?? ""} maxLength={254} />
          <Field label={t("network.contacts.phone")} name="phone" type="tel" defaultValue={contact?.phone ?? ""} maxLength={50} />
        </div>
        <Field label={t("network.contacts.profileUrl")} name="profileUrl" type="url" placeholder="https://" defaultValue={contact?.profileUrl ?? ""} maxLength={500} />
        <TextArea label={t("network.contacts.notes")} name="notes" defaultValue={contact?.notes} maxLength={4000} rows={2} />
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <input type="checkbox" name="isPrimary" defaultChecked={contact?.isPrimary ?? false} className="h-4 w-4 accent-brand" />
          {t("network.contacts.primary")}
        </label>
        <p className="text-[12px] text-fg-faint">{t("network.contacts.manualOnly")}</p>
        <ErrorLine locale={locale} error={f.state.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={f.pending}>
            {t("network.contacts.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => f.setOpen(false)}>
            {t("network.contacts.cancel")}
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

function ContactSelect({ locale, contacts, label, defaultValue }: { locale: Locale; contacts: readonly ContactView[]; label: string; defaultValue?: string | null }) {
  const t = createTranslator(locale);
  if (contacts.length === 0) return null;
  return (
    <Select label={label} name="contactId" defaultValue={defaultValue ?? ""}>
      <option value="">{t("network.interactions.noContact")}</option>
      {contacts.map((c) => (
        <option key={c.id} value={c.id}>
          {c.role ? `${c.name} · ${c.role}` : c.name}
        </option>
      ))}
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function InteractionForm({ locale, organizationId, companyId, contacts }: { locale: Locale; organizationId: string; companyId: string; contacts: readonly ContactView[] }) {
  const t = createTranslator(locale);
  const f = useClosingAction(async (prev, form) => {
    // datetime-local is the viewer's wall-clock time; store the instant.
    const when = new Date(String(form.get("when") ?? ""));
    form.set("occurredAt", Number.isNaN(when.getTime()) ? "" : when.toISOString());
    return recordInteractionAction(prev, form);
  });
  return (
    <Disclosure open={f.open} setOpen={f.setOpen} label={t("network.interactions.record")} testId="record-interaction">
      <form action={f.action} className="space-y-3" data-testid="interaction-form">
        <Hidden organizationId={organizationId} companyId={companyId} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t("network.interactions.kind")} name="kind" defaultValue="meeting" required>
            {INTERACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`network.interactionKinds.${k}`)}
              </option>
            ))}
          </Select>
          <Field label={t("network.interactions.when")} name="when" type="datetime-local" defaultValue={localNow()} required suppressHydrationWarning />
          <ContactSelect locale={locale} contacts={contacts} label={t("network.interactions.contact")} />
        </div>
        <Field label={t("network.interactions.titleField")} name="title" placeholder={t("network.interactions.titlePlaceholder")} maxLength={200} required />
        <TextArea label={t("network.interactions.summary")} name="summary" maxLength={8000} rows={3} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("network.interactions.outcome")} name="outcome" maxLength={2000} />
          <Field label={t("network.interactions.nextStep")} name="nextStep" maxLength={500} />
        </div>
        <ErrorLine locale={locale} error={f.state.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={f.pending}>
            {t("network.interactions.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => f.setOpen(false)}>
            {t("network.contacts.cancel")}
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export function FollowUpForm({
  locale,
  organizationId,
  companyId,
  contacts,
  preset,
  label,
}: {
  locale: Locale;
  organizationId: string;
  companyId: string;
  contacts: readonly ContactView[];
  /** Prefill from an interaction's next step. */
  preset?: { title: string; interactionId: string; contactId: string | null };
  label?: string;
}) {
  const t = createTranslator(locale);
  const f = useClosingAction(createFollowUpAction);
  return (
    <Disclosure open={f.open} setOpen={f.setOpen} label={label ?? t("network.followUps.create")} testId={preset ? "follow-up-from-step" : "create-follow-up"}>
      <form action={f.action} className="min-w-0 space-y-3" data-testid="follow-up-form">
        <Hidden organizationId={organizationId} companyId={companyId} />
        {preset && <input type="hidden" name="interactionId" value={preset.interactionId} />}
        <FollowUpFields locale={locale} contacts={contacts} preset={preset} />
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
    </Disclosure>
  );
}

export function FollowUpStatusButton({ locale, organizationId, followUpId, status, variant = "secondary" }: { locale: Locale; organizationId: string; followUpId: string; status: FollowUpStatus; variant?: "primary" | "secondary" | "ghost" }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(setFollowUpStatusAction, {});
  const label: MessageKey = status === "done" ? "network.followUps.done" : status === "dismissed" ? "network.followUps.dismiss" : "network.followUps.reopen";
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="followUpId" value={followUpId} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" size="sm" variant={variant} disabled={pending} data-testid={`follow-up-${status}`}>
        {status === "done" && <Icon name="check" size={14} />}
        {t(label)}
      </Button>
      <ErrorLine locale={locale} error={state.error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Search → Add to Network
// ---------------------------------------------------------------------------

/** Search "Add to Network": sends only the query; the server derives the company from its stored analysis and never duplicates it. */
export function AddSearchedToNetworkButton({ locale, organizationId, query }: { locale: Locale; organizationId: string; query: string }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<AddSearchedState, FormData>(addSearchedCompanyAction, {});
  if (state.ok && state.companyId) {
    return (
      <p className="flex items-center gap-2 text-[13.5px] font-medium text-positive" role="status">
        <Icon name="check" size={15} />
        {t("search.result.added")}
        <Link href={`/workspace/network/${state.companyId}`} className={cx("rounded font-medium text-brand hover:underline", focusRing)}>
          {t("search.result.openNetwork")}
        </Link>
      </p>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="q" value={query} />
      <Button type="submit" variant="primary" size="sm" disabled={pending} data-testid="add-to-network">
        <Icon name="plus" size={14} />
        {t("search.result.addToNetwork")}
      </Button>
      <ErrorLine locale={locale} error={state.error} />
    </form>
  );
}
