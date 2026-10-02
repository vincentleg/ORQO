"use client";

import { useActionState } from "react";
import { validateUnderstandingAction, type ActionState } from "@/app/actions/workspace";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { Button, cx, focusRing } from "./ui";

/** Confirm / "not right" for one understanding item. The server re-checks membership and that the item exists. */
export function ItemValidation({ locale, organizationId, itemKey, label, confirmed }: { locale: Locale; organizationId: string; itemKey: string; label: string; confirmed: boolean }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(validateUnderstandingAction, {});
  return (
    <form action={action} className="flex shrink-0 items-center gap-1.5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="itemKey" value={itemKey} />
      {!confirmed && (
        <button type="submit" name="kind" value="confirm" disabled={pending} aria-label={t("understanding.actions.confirmLabel", { value: label })} className={cx("min-h-9 rounded-full border border-edge px-3 text-[12.5px] text-fg-muted hover:border-positive hover:text-positive disabled:opacity-50", focusRing)}>
          {t("understanding.actions.confirm")}
        </button>
      )}
      <button type="submit" name="kind" value="reject" disabled={pending} aria-label={t("understanding.actions.rejectLabel", { value: label })} className={cx("min-h-9 rounded-full border border-edge px-3 text-[12.5px] text-fg-muted hover:border-critical hover:text-critical disabled:opacity-50", focusRing)}>
        {t("understanding.actions.reject")}
      </button>
      {state.error && (
        <span role="alert" className="text-[12px] text-critical">
          {t(state.error)}
        </span>
      )}
    </form>
  );
}

/** "The one thing I need from you": up to three choices among the options plausible for this company, or "not sure". */
export function QuestionForm({ locale, organizationId, dimension, prompt, options }: { locale: Locale; organizationId: string; dimension: string; prompt: string; options: { value: string; label: string }[] }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(validateUnderstandingAction, {});
  return (
    <form action={action} className="space-y-4" data-testid="next-question">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="kind" value="answer" />
      <input type="hidden" name="dimension" value={dimension} />
      <fieldset>
        <legend className="text-[15px] font-medium text-fg">{prompt}</legend>
        <p className="mt-1 text-[12.5px] text-fg-muted">{t("understanding.question.hint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((o) => (
            <label key={o.value} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-edge px-4 text-[13.5px] text-fg has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40">
              <input type="checkbox" name="values" value={o.value} className="size-4 accent-[var(--color-brand)]" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {t("understanding.question.submit")}
        </Button>
        <Button type="submit" name="values" value="not_sure" disabled={pending}>
          {t("understanding.question.notSure")}
        </Button>
        {state.error && (
          <span role="alert" className="text-[13px] text-critical">
            {t(state.error)}
          </span>
        )}
        {state.ok && (
          <span role="status" className="text-[13px] text-positive">
            {t("understanding.question.thanks")}
          </span>
        )}
      </div>
    </form>
  );
}
