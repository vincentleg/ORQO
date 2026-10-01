"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  addEventTargetAction,
  captureEncounterAction,
  createEventAction,
  createEventFollowUpAction,
  removeEventTargetAction,
  setEventArchivedAction,
  setTargetReviewedAction,
  setTargetStatusAction,
  updateEventAction,
  updateEventTargetAction,
  type AddTargetState,
  type CaptureState,
  type CreateEventState,
} from "@/app/actions/events";
import type { ActionState } from "@/app/actions/workspace";
import { ATTENDANCE, EVENT_OBJECTIVES, TARGET_PRIORITIES, canTransitionTarget, type EventTargetView, type EventView, type TargetStatus } from "@/lib/events/model";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import type { ContactView } from "@/lib/network/model";
import { DueDateField, FOLLOW_UP_GRID, FollowUpFields, Select } from "./follow-up-fields";
import { Icon } from "./icons";
import { Disclosure, ErrorLine, useClosingAction } from "./network-forms";
import { Button, Field, TextArea, cx, focusRing, inputClass } from "./ui";

/*
 * Events forms (Phase 8). Each one posts to a server action that re-checks
 * membership and validates input; the organization id is only a lookup key.
 * Companies, contacts, interactions and follow-ups are written as canonical
 * Network records. Nothing here calls a provider, fetches a URL or contacts
 * anyone, and no follow-up is created without an explicit submit.
 */

/** Minimal company / contact references passed to the browser: names and roles only, never contact channels or notes. */
export interface CompanyOption {
  id: string;
  name: string;
}
export interface ContactOption {
  id: string;
  companyId: string;
  name: string;
  role: string;
}

function Hidden({ organizationId, eventId }: { organizationId: string; eventId: string }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="eventId" value={eventId} />
    </>
  );
}

function Actions({ locale, pending, save, onCancel }: { locale: Locale; pending: boolean; save: string; onCancel?: () => void }) {
  const t = createTranslator(locale);
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="primary" size="sm" disabled={pending}>
        {save}
      </Button>
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("events.form.cancel")}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event (create / edit / archive)
// ---------------------------------------------------------------------------

function EventFields({ locale, event }: { locale: Locale; event?: EventView }) {
  const t = createTranslator(locale);
  return (
    <div className="min-w-0 space-y-3">
      <Field label={t("events.form.name")} name="name" defaultValue={event?.name} placeholder={t("events.form.namePlaceholder")} maxLength={200} required />
      <Select label={t("events.form.objectiveKind")} name="objectiveKind" defaultValue={event?.objectiveKind ?? ""}>
        <option value="">{t("events.form.objectiveNone")}</option>
        {EVENT_OBJECTIVES.map((o) => (
          <option key={o} value={o}>
            {t(`events.objectives.${o}`)}
          </option>
        ))}
      </Select>
      <TextArea label={t("events.form.objective")} name="objective" defaultValue={event?.objective} placeholder={t("events.form.objectivePlaceholder")} maxLength={2000} rows={3} />
      <div className={FOLLOW_UP_GRID}>
        {/* Same Safari-safe optional day as follow-ups: an empty field shows "No date" and submits nothing. */}
        <DueDateField locale={locale} name="startsOn" label={t("events.form.startsOn")} emptyLabel={t("events.form.noDate")} defaultValue={event?.startsOn ?? ""} />
        <DueDateField locale={locale} name="endsOn" label={t("events.form.endsOn")} emptyLabel={t("events.form.noDate")} defaultValue={event?.endsOn ?? ""} />
      </div>
      <p className="text-[12px] text-fg-faint">{t("events.form.datesHint")}</p>
      <div className={FOLLOW_UP_GRID}>
        <Field label={t("events.form.location")} name="location" defaultValue={event?.location} maxLength={200} className="min-w-0" />
        <Field label={t("events.form.website")} name="website" type="url" placeholder="https://" defaultValue={event?.website ?? ""} maxLength={500} hint={t("events.form.websiteHint")} className="min-w-0" />
      </div>
      <Field label={t("events.form.topics")} name="topics" defaultValue={event?.topics.join(", ")} hint={t("events.form.topicsHint")} maxLength={1000} />
      <TextArea label={t("events.form.descriptionField")} name="description" defaultValue={event?.description} maxLength={4000} rows={2} />
    </div>
  );
}

export function CreateEventForm({ locale, organizationId }: { locale: Locale; organizationId: string }) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CreateEventState, FormData>(createEventAction, {});
  useEffect(() => {
    if (state.ok && state.eventId) router.push(`/workspace/events/${state.eventId}`);
  }, [state, router]);
  return (
    <Disclosure open={open} setOpen={setOpen} label={t("events.create")} testId="create-event">
      <form action={action} className="space-y-3" data-testid="event-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <EventFields locale={locale} />
        <ErrorLine locale={locale} error={state.error} />
        <Actions locale={locale} pending={pending} save={t("events.form.save")} onCancel={() => setOpen(false)} />
      </form>
    </Disclosure>
  );
}

export function EditEventForm({ locale, organizationId, event }: { locale: Locale; organizationId: string; event: EventView }) {
  const t = createTranslator(locale);
  const f = useClosingAction(updateEventAction);
  return (
    <Disclosure open={f.open} setOpen={f.setOpen} label={t("events.form.edit")} icon="settings" testId="edit-event">
      <form action={f.action} className="space-y-3" data-testid="event-form">
        <Hidden organizationId={organizationId} eventId={event.id} />
        <EventFields locale={locale} event={event} />
        <ErrorLine locale={locale} error={f.state.error} />
        <Actions locale={locale} pending={f.pending} save={t("events.form.save")} onCancel={() => f.setOpen(false)} />
      </form>
    </Disclosure>
  );
}

function SmallAction({ locale, server, fields, label, variant = "ghost", testId }: { locale: Locale; server: (s: ActionState, f: FormData) => Promise<ActionState>; fields: Record<string, string>; label: string; variant?: "primary" | "secondary" | "ghost"; testId?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(server, {});
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" size="sm" variant={variant} disabled={pending} data-testid={testId}>
        {label}
      </Button>
      <ErrorLine locale={locale} error={state.error} />
    </form>
  );
}

export function ArchiveEventButton({ locale, organizationId, eventId, archived }: { locale: Locale; organizationId: string; eventId: string; archived: boolean }) {
  const t = createTranslator(locale);
  return (
    <SmallAction
      locale={locale}
      server={setEventArchivedAction}
      fields={{ organizationId, eventId, archived: archived ? "false" : "true" }}
      label={archived ? t("events.form.restore") : t("events.form.archive")}
      testId={archived ? "restore-event" : "archive-event"}
    />
  );
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

function TargetDetailFields({ locale, target }: { locale: Locale; target?: Pick<EventTargetView, "priority" | "attendance" | "why" | "prepNotes"> }) {
  const t = createTranslator(locale);
  return (
    <>
      <div className={FOLLOW_UP_GRID}>
        <Select label={t("events.targets.priority")} name="priority" defaultValue={target?.priority ?? "medium"}>
          {TARGET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`events.priorities.${p}`)}
            </option>
          ))}
        </Select>
        <Select label={t("events.targets.attendance")} name="attendance" defaultValue={target?.attendance ?? "unknown"}>
          {ATTENDANCE.map((a) => (
            <option key={a} value={a}>
              {t(`events.attendance.${a}`)}
            </option>
          ))}
        </Select>
      </div>
      <TextArea label={t("events.targets.why")} name="why" defaultValue={target?.why} placeholder={t("events.targets.whyPlaceholder")} maxLength={2000} rows={2} />
    </>
  );
}

export function AddTargetForm({ locale, organizationId, eventId, companies }: { locale: Locale; organizationId: string; eventId: string; companies: readonly CompanyOption[] }) {
  const t = createTranslator(locale);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"network" | "new">(companies.length > 0 ? "network" : "new");
  const [state, action, pending] = useActionState<AddTargetState, FormData>(async (prev, form) => {
    const next = await addEventTargetAction(prev, form);
    if (next.ok && !next.alreadyTargeted) setOpen(false);
    return next;
  }, {});
  return (
    <Disclosure open={open} setOpen={setOpen} label={t("events.targets.add")} testId="add-target">
      <form action={action} className="min-w-0 space-y-3" data-testid="add-target-form">
        <Hidden organizationId={organizationId} eventId={eventId} />
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {(["network", "new"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cx("rounded-full border px-3 py-1 text-[13px]", mode === m ? "border-brand bg-brand-soft text-brand" : "border-edge text-fg-muted hover:text-fg", focusRing)}
            >
              {m === "network" ? t("events.targets.fromNetwork") : t("events.targets.newCompany")}
            </button>
          ))}
        </div>
        {mode === "network" ? (
          companies.length === 0 ? (
            <p className="text-[13px] text-fg-muted">{t("events.targets.noNetworkCompanies")}</p>
          ) : (
            <Select label={t("events.targets.pickCompany")} name="companyId" defaultValue="" required>
              <option value="" disabled>
                {t("events.targets.pickPlaceholder")}
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )
        ) : (
          <>
            <div className={FOLLOW_UP_GRID}>
              <Field label={t("events.targets.companyName")} name="companyName" maxLength={200} required className="min-w-0" />
              <Field label={t("events.targets.companyWebsite")} name="companyWebsite" type="url" placeholder="https://" maxLength={500} className="min-w-0" />
            </div>
            <p className="text-[12px] text-fg-faint">{t("events.targets.reuseHint")}</p>
          </>
        )}
        <TargetDetailFields locale={locale} />
        {state.ok && state.alreadyTargeted && (
          <p role="status" className="text-[13px] text-fg-muted">
            {t("events.targets.alreadyTargeted")}
          </p>
        )}
        <ErrorLine locale={locale} error={state.error} />
        <Actions locale={locale} pending={pending} save={t("events.targets.save")} onCancel={() => setOpen(false)} />
      </form>
    </Disclosure>
  );
}

export function TargetDetailsForm({ locale, organizationId, target }: { locale: Locale; organizationId: string; target: EventTargetView }) {
  const t = createTranslator(locale);
  const f = useClosingAction(updateEventTargetAction);
  return (
    <Disclosure open={f.open} setOpen={f.setOpen} label={t("events.targets.editDetails")} icon="settings" testId="edit-target">
      <form action={f.action} className="min-w-0 space-y-3" data-testid="target-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="targetId" value={target.id} />
        <TargetDetailFields locale={locale} target={target} />
        <TextArea label={t("events.targets.prepNotes")} name="prepNotes" defaultValue={target.prepNotes} maxLength={4000} rows={3} />
        <ErrorLine locale={locale} error={f.state.error} />
        <Actions locale={locale} pending={f.pending} save={t("events.targets.saveDetails")} onCancel={() => f.setOpen(false)} />
      </form>
    </Disclosure>
  );
}

const STATUS_LABEL: Record<TargetStatus, MessageKey> = {
  planned: "events.targets.markPlanned",
  targeted: "events.targets.reset",
  met: "events.targets.markMet",
  missed: "events.targets.markMissed",
  skipped: "events.targets.markSkipped",
};

/** The lifecycle moves a person may make from the current status (checked again on the server). */
export function TargetStatusButtons({ locale, organizationId, target }: { locale: Locale; organizationId: string; target: Pick<EventTargetView, "id" | "status"> }) {
  const t = createTranslator(locale);
  const order: TargetStatus[] = ["met", "missed", "skipped", "planned", "targeted"];
  return (
    <div className="flex flex-wrap items-start gap-1" data-testid="target-status-actions">
      {order
        .filter((s) => canTransitionTarget(target.status, s) && !(s === "planned" && target.status !== "targeted"))
        .map((s) => (
          <SmallAction key={s} locale={locale} server={setTargetStatusAction} fields={{ organizationId, targetId: target.id, status: s }} label={t(STATUS_LABEL[s])} variant={s === "met" ? "secondary" : "ghost"} testId={`target-${s}`} />
        ))}
    </div>
  );
}

export function TargetReviewButton({ locale, organizationId, targetId, reviewed }: { locale: Locale; organizationId: string; targetId: string; reviewed: boolean }) {
  const t = createTranslator(locale);
  return (
    <SmallAction
      locale={locale}
      server={setTargetReviewedAction}
      fields={{ organizationId, targetId, reviewed: reviewed ? "false" : "true" }}
      label={reviewed ? t("events.review.undoNoAction") : t("events.review.noAction")}
      testId={reviewed ? "target-unreview" : "target-review"}
    />
  );
}

export function RemoveTargetButton({ locale, organizationId, targetId }: { locale: Locale; organizationId: string; targetId: string }) {
  const t = createTranslator(locale);
  return <SmallAction locale={locale} server={removeEventTargetAction} fields={{ organizationId, targetId }} label={t("events.targets.remove")} testId="remove-target" />;
}

// ---------------------------------------------------------------------------
// Fast capture
// ---------------------------------------------------------------------------

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Built for someone standing at an event: company, optional contact, what
 * happened, outcome, next step — one form, one save. The company and contact
 * are reused when known; new ones go through the canonical server paths.
 */
export function CaptureForm({
  locale,
  organizationId,
  event,
  targets,
  companies,
  contacts,
  initiallyOpen = false,
}: {
  locale: Locale;
  organizationId: string;
  event: Pick<EventView, "id" | "name">;
  targets: readonly CompanyOption[];
  companies: readonly CompanyOption[];
  contacts: readonly ContactOption[];
  initiallyOpen?: boolean;
}) {
  const t = createTranslator(locale);
  const [open, setOpen] = useState(initiallyOpen);
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [state, action, pending] = useActionState<CaptureState, FormData>(async (prev, form) => {
    const picked = String(form.get("companyId") ?? "");
    const name = picked === "new" ? String(form.get("companyName") ?? "") : ([...targets, ...companies].find((c) => c.id === picked)?.name ?? "");
    // datetime-local is the viewer's wall-clock time; store the instant.
    const when = new Date(String(form.get("when") ?? ""));
    form.set("occurredAt", Number.isNaN(when.getTime()) ? "" : when.toISOString());
    const next = await captureEncounterAction(prev, form);
    setSavedName(next.ok ? name : null);
    if (next.ok) {
      setCompany("");
      setContact("");
      setFormKey((k) => k + 1);
    }
    return next;
  }, {});
  const targetIds = new Set(targets.map((c) => c.id));
  const others = companies.filter((c) => !targetIds.has(c.id));
  const companyContacts = contacts.filter((c) => c.companyId === company);

  return (
    <Disclosure open={open} setOpen={setOpen} label={t("events.capture.open")} testId="open-capture">
      <form key={formKey} action={action} className="min-w-0 space-y-3" data-testid="capture-form">
        <Hidden organizationId={organizationId} eventId={event.id} />
        <label className="block min-w-0">
          <span className="text-[13px] font-medium text-fg-muted">{t("events.capture.company")}</span>
          <select
            name="companyId"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setContact("");
            }}
            required
            className={cx(inputClass, "mt-1.5 min-w-0 truncate")}
            data-testid="capture-company"
          >
            <option value="" disabled>
              {t("events.capture.companyPick")}
            </option>
            {targets.length > 0 && (
              <optgroup label={t("events.capture.targetsGroup")}>
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={t("events.capture.networkGroup")}>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="new">{t("events.capture.newCompanyOption")}</option>
          </select>
        </label>
        {company === "new" && (
          <div className={FOLLOW_UP_GRID}>
            <Field label={t("events.targets.companyName")} name="companyName" maxLength={200} required className="min-w-0" />
            <Field label={t("events.targets.companyWebsite")} name="companyWebsite" type="url" placeholder="https://" maxLength={500} className="min-w-0" />
          </div>
        )}
        <label className="block min-w-0">
          <span className="text-[13px] font-medium text-fg-muted">{t("events.capture.contact")}</span>
          <select name="contactId" value={contact} onChange={(e) => setContact(e.target.value)} className={cx(inputClass, "mt-1.5 min-w-0 truncate")} data-testid="capture-contact">
            <option value="">{t("events.capture.noContact")}</option>
            {companyContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.role ? `${c.name} · ${c.role}` : c.name}
              </option>
            ))}
            <option value="new">{t("events.capture.newContactOption")}</option>
          </select>
        </label>
        {contact === "new" && (
          <div className="min-w-0 space-y-3 rounded-lg border border-edge bg-surface p-3">
            <div className={FOLLOW_UP_GRID}>
              <Field label={t("events.capture.contactName")} name="contactName" maxLength={200} required className="min-w-0" />
              <Field label={t("events.capture.contactRole")} name="contactRole" maxLength={200} className="min-w-0" />
              <Field label={t("events.capture.contactEmail")} name="contactEmail" type="email" maxLength={254} className="min-w-0" />
              <Field label={t("events.capture.contactPhone")} name="contactPhone" type="tel" maxLength={50} className="min-w-0" />
            </div>
            <Field label={t("events.capture.contactProfile")} name="contactProfileUrl" type="url" placeholder="https://" maxLength={500} />
            <TextArea label={t("events.capture.contactNotes")} name="contactNotes" maxLength={4000} rows={2} />
          </div>
        )}
        <div className={FOLLOW_UP_GRID}>
          <Field label={t("events.capture.when")} name="when" type="datetime-local" defaultValue={localNow()} required suppressHydrationWarning className="min-w-0" />
          <Field label={t("events.capture.titleField")} name="title" defaultValue={t("events.capture.defaultTitle", { event: event.name }).slice(0, 200)} maxLength={200} required className="min-w-0" />
        </div>
        <TextArea label={t("events.capture.summary")} name="summary" maxLength={8000} rows={3} />
        <div className={FOLLOW_UP_GRID}>
          <Field label={t("events.capture.outcome")} name="outcome" maxLength={2000} className="min-w-0" />
          <Field label={t("events.capture.nextStep")} name="nextStep" maxLength={500} hint={t("events.capture.nextStepHint")} className="min-w-0" />
        </div>
        <p className="text-[12px] text-fg-faint">{t("events.capture.manualOnly")}</p>
        {savedName !== null && (
          <p role="status" className="flex items-center gap-2 text-[13.5px] font-medium text-positive" data-testid="capture-saved">
            <Icon name="check" size={15} />
            {t("events.capture.saved", { company: savedName })}
          </p>
        )}
        <ErrorLine locale={locale} error={state.error} />
        <Actions locale={locale} pending={pending} save={t("events.capture.save")} onCancel={() => setOpen(false)} />
      </form>
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// Follow-up in the context of an event (canonical follow-up, explicit only)
// ---------------------------------------------------------------------------

export function EventFollowUpForm({
  locale,
  organizationId,
  eventId,
  companyId,
  contacts,
  preset,
  label,
}: {
  locale: Locale;
  organizationId: string;
  eventId: string;
  companyId: string;
  contacts: readonly ContactView[];
  preset?: { title: string; interactionId: string | null; contactId: string | null; description?: string };
  label: string;
}) {
  const t = createTranslator(locale);
  const f = useClosingAction(createEventFollowUpAction);
  return (
    <Disclosure open={f.open} setOpen={f.setOpen} label={label} testId="event-follow-up">
      <form action={f.action} className="min-w-0 space-y-3" data-testid="follow-up-form">
        <Hidden organizationId={organizationId} eventId={eventId} />
        <input type="hidden" name="companyId" value={companyId} />
        {preset?.interactionId && <input type="hidden" name="interactionId" value={preset.interactionId} />}
        <FollowUpFields locale={locale} contacts={contacts} preset={preset} />
        <ErrorLine locale={locale} error={f.state.error} />
        <Actions locale={locale} pending={f.pending} save={t("network.followUps.save")} onCancel={() => f.setOpen(false)} />
      </form>
    </Disclosure>
  );
}

/** Link-styled tab for the event page (server-rendered GET navigation, no client state). */
export function EventTabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cx("rounded-lg px-3 py-1.5 text-[13.5px] font-medium", active ? "bg-brand-soft text-brand" : "text-fg-muted hover:bg-subtle hover:text-fg", focusRing)}
    >
      {children}
    </Link>
  );
}
