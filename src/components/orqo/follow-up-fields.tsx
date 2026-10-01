"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { FOLLOW_UP_PRIORITIES, type ContactView } from "@/lib/network/model";
import { Field, TextArea, cx, focusRing, inputClass } from "./ui";

/*
 * The fields of a follow-up, shared by every entry point ("Create follow-up"
 * and "Make it a follow-up" from the Next Best Action), so both have the same
 * due-date semantics and the same container-safe layout:
 *  - every grid child is min-w-0 and every control is w-full, so the form can
 *    never be wider than the column it is placed in;
 *  - the short controls use an auto-fit grid that wraps or stacks when the
 *    column is narrow, instead of a fixed column count.
 */

/** Wraps to as many ~12rem columns as fit, down to one; never wider than the parent. */
export const FOLLOW_UP_GRID = "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3";

export function Select({ label, name, defaultValue, children, required }: { label: string; name: string; defaultValue?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="text-[13px] font-medium text-fg-muted">{label}</span>
      <select name={name} defaultValue={defaultValue} required={required} className={cx(inputClass, "mt-1.5 min-w-0 truncate")}>
        {children}
      </select>
    </label>
  );
}

export function ContactSelect({ locale, contacts, label, defaultValue }: { locale: Locale; contacts: readonly ContactView[]; label: string; defaultValue?: string | null }) {
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

/**
 * What the due-date field draws. Exactly one thing occupies the field at a time:
 *  A. empty, idle → an ORQO control reading "No due date" (the native date
 *     input is NOT rendered; the form submits an empty dueOn);
 *  B. empty, active (focused / picker open) → only the native date input;
 *  C. a date selected → the native input showing that date, plus "Clear date";
 *  D. cleared → back to A;
 *  E. picker closed without a selection (blur, value still empty) → back to A.
 * Unmounting the native input in A and E is deliberate: Safari keeps drawing
 * its current date in an empty date input after interaction, whatever its
 * text colour, so the only reliable empty idle state is not to show it.
 */
export function dueDateView(value: string, active: boolean): { mode: "empty_idle" | "native"; showClear: boolean } {
  const empty = value === "";
  return { mode: empty && !active ? "empty_idle" : "native", showClear: !empty };
}

/**
 * Optional due date. The form value is the source of truth: nothing is
 * submitted unless the person picks a date, and a date the browser merely
 * displays is never taken as selected. See dueDateView for the states.
 */
export function DueDateField({ locale, defaultValue = "", initiallyActive = false }: { locale: Locale; defaultValue?: string; initiallyActive?: boolean }) {
  const t = createTranslator(locale);
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [active, setActive] = useState(initiallyActive);
  const [justActivated, setJustActivated] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const view = dueDateView(value, active);

  // After the person activates the empty control: focus the native input and, where supported, open its picker.
  useEffect(() => {
    if (!justActivated || !input.current) return;
    input.current.focus();
    try {
      input.current.showPicker?.();
    } catch {
      // Not supported or not allowed: the focused input still accepts keyboard entry and a click.
    }
  }, [justActivated]);

  return (
    <div className="min-w-0" data-testid="due-date-field" data-empty={value === "" ? "true" : "false"} data-mode={view.mode}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg-muted">
        {t("network.followUps.dueOn")} <span className="font-normal text-fg-faint">· {t("network.followUps.optional")}</span>
      </label>
      <div className="mt-1.5">
        {view.mode === "empty_idle" ? (
          <>
            <input type="hidden" name="dueOn" value="" />
            <button
              type="button"
              id={id}
              onClick={() => {
                setActive(true);
                setJustActivated(true);
              }}
              className={cx(inputClass, "min-w-0 truncate text-left text-fg-faint")}
              data-testid="due-date-empty"
            >
              {t("network.followUps.noDueDate")}
            </button>
          </>
        ) : (
          <input
            ref={input}
            id={id}
            type="date"
            name="dueOn"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setActive(true)}
            onBlur={() => {
              setActive(false);
              setJustActivated(false);
            }}
            className={cx(inputClass, "min-w-0")}
          />
        )}
      </div>
      {view.showClear && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            setActive(false);
            setJustActivated(false);
          }}
          className={cx("mt-1 rounded text-[12px] text-fg-muted hover:text-fg", focusRing)}
          data-testid="due-date-clear"
        >
          {t("network.followUps.clearDue")}
        </button>
      )}
    </div>
  );
}

export function FollowUpFields({ locale, contacts, preset }: { locale: Locale; contacts: readonly ContactView[]; preset?: { title: string; contactId: string | null } }) {
  const t = createTranslator(locale);
  return (
    <div className="min-w-0 space-y-3" data-testid="follow-up-fields">
      <Field label={t("network.followUps.titleField")} name="title" defaultValue={preset?.title} placeholder={t("network.followUps.titlePlaceholder")} maxLength={200} required className="min-w-0" />
      <TextArea label={t("network.followUps.description")} name="description" maxLength={4000} rows={2} className="min-w-0" />
      <div className={FOLLOW_UP_GRID} data-testid="follow-up-grid">
        <DueDateField locale={locale} />
        <Select label={t("network.followUps.priority")} name="priority" defaultValue="normal">
          {FOLLOW_UP_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`network.priorities.${p}`)}
            </option>
          ))}
        </Select>
        <ContactSelect locale={locale} contacts={contacts} label={t("network.followUps.contact")} defaultValue={preset?.contactId} />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-fg">
        <input type="checkbox" name="assignToMe" defaultChecked className="h-4 w-4 shrink-0 accent-brand" />
        {t("network.followUps.assignToMe")}
      </label>
    </div>
  );
}
