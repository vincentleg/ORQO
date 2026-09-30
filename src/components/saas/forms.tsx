"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, signUpAction, type AuthFormState } from "@/app/actions/auth";
import { addCompanyAction, createOrganizationAction, createOwnCompanyAction, setLocaleAction, type ActionState } from "@/app/actions/workspace";
import { Icon } from "@/components/orqo/icons";
import { Button, Field, TextArea, cx, focusRing, inputClass } from "@/components/orqo/ui";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";

const PASSWORD_MIN = 8;

function ErrorLine({ locale, error }: { locale: Locale; error?: MessageKey }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical">
      {createTranslator(locale)(error)}
    </p>
  );
}

const linkClass = cx("rounded font-medium text-brand hover:underline", focusRing);

export function SignInForm({ locale, next, initialError }: { locale: Locale; next: string; initialError?: MessageKey }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signInAction, { error: initialError });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label={t("common.email")} name="email" type="email" autoComplete="email" required />
      <Field label={t("common.password")} name="password" type="password" autoComplete="current-password" required />
      <ErrorLine locale={locale} error={state.error} />
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {t("common.signIn")}
      </Button>
      <p className="text-center text-[13px] text-fg-muted">
        {t("auth.noAccount")}{" "}
        <Link href="/signup" className={linkClass}>
          {t("common.signUp")}
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUpAction, {});
  if (state.confirmationSentTo) {
    return (
      <div className="space-y-2" data-testid="signup-confirmation">
        <h2 className="text-[15px] font-semibold text-fg">{t("auth.checkEmailTitle")}</h2>
        <p className="text-[13.5px] leading-relaxed text-fg-muted">{t("auth.checkEmailBody", { email: state.confirmationSentTo })}</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <Field label={t("auth.displayName")} name="displayName" autoComplete="name" maxLength={120} />
      <Field label={t("common.email")} name="email" type="email" autoComplete="email" required />
      <Field label={t("common.password")} hint={t("auth.passwordHint", { min: PASSWORD_MIN })} name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required />
      <ErrorLine locale={locale} error={state.error} />
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {t("common.signUp")}
      </Button>
      <p className="text-center text-[13px] text-fg-muted">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className={linkClass}>
          {t("common.signIn")}
        </Link>
      </p>
    </form>
  );
}

export function CreateOrganizationForm({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(createOrganizationAction, {});
  return (
    <form action={action} className="space-y-4">
      <Field label={t("onboarding.nameLabel")} name="name" placeholder={t("onboarding.namePlaceholder")} maxLength={120} required />
      <ErrorLine locale={locale} error={state.error} />
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {t("onboarding.submit")}
      </Button>
    </form>
  );
}

export function AddCompanyForm({ locale, organizationId }: { locale: Locale; organizationId: string }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(addCompanyAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="organizationId" value={organizationId} />
      <Field label={t("workspace.companyName")} name="name" maxLength={200} required />
      <Field label={t("workspace.website")} name="website" type="url" placeholder="https://" maxLength={500} />
      <Button type="submit" variant="primary" disabled={pending} className="h-10">
        <Icon name="plus" size={14} />
        {t("workspace.addCompany")}
      </Button>
      <div className="sm:col-span-3">
        <ErrorLine locale={locale} error={state.error} />
      </div>
    </form>
  );
}

/** One-click "Add to Network" for a Search target. Writes only what the user typed; nothing is researched. */
export function AddToNetworkButton({ locale, organizationId, name, website }: { locale: Locale; organizationId: string; name: string; website?: string }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(addCompanyAction, {});
  if (state.ok) {
    return (
      <p className="flex items-center gap-2 text-[13.5px] font-medium text-positive" role="status">
        <Icon name="check" size={15} />
        {t("search.result.added")}
        <Link href="/workspace/network" className={linkClass}>
          {t("search.result.openNetwork")}
        </Link>
      </p>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="name" value={name} />
      {website && <input type="hidden" name="website" value={website} />}
      <Button type="submit" variant="primary" size="sm" disabled={pending}>
        <Icon name="plus" size={14} />
        {t("search.result.addToNetwork")}
      </Button>
      <ErrorLine locale={locale} error={state.error} />
    </form>
  );
}

export function OwnCompanyForm({ locale, organizationId }: { locale: Locale; organizationId: string }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(createOwnCompanyAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("company.name")} name="name" maxLength={200} required />
        <Field label={t("company.website")} name="website" type="url" placeholder="https://" maxLength={500} />
      </div>
      <TextArea label={t("company.summary")} name="summary" maxLength={4000} rows={3} />
      <ErrorLine locale={locale} error={state.error} />
      <Button type="submit" variant="primary" disabled={pending}>
        {t("company.create")}
      </Button>
    </form>
  );
}

export function LocaleForm({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(setLocaleAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label className="text-[13px] font-medium text-fg-muted" htmlFor="locale">
        {t("common.language")}
      </label>
      <select id="locale" name="locale" defaultValue={locale} className={cx(inputClass, "h-9 w-auto")}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`locales.${l}`)}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        {t("common.save")}
      </Button>
      {state.ok && (
        <span className="text-[12.5px] text-positive" role="status">
          {t("workspace.languageSaved")}
        </span>
      )}
      <ErrorLine locale={locale} error={state.error} />
    </form>
  );
}
