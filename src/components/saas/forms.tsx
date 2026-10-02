"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, signUpAction, type AuthFormState } from "@/app/actions/auth";
import { addCompanyAction, createOrganizationAction, createOwnCompanyAction, setLocaleAction, updateOwnCompanyAction, type ActionState } from "@/app/actions/workspace";
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
      <ErrorLine locale={locale} error={state.error} />
      <Button type="submit" variant="primary" disabled={pending}>
        {t("company.create")}
      </Button>
    </form>
  );
}

const GOALS = ["customer", "supplier", "technology_partner", "oem", "integration", "channel", "strategic", "co_development", "market_entry"] as const;

export interface OwnProfileValues {
  name: string;
  website: string | null;
  summary: string;
  offerings: string[];
  customerSegments: string[];
  markets: string[];
  geographies: string[];
  soughtCapabilities: string[];
  partnershipGoals: string[];
}

/** Edits the own-company profile ORQO compares every search with. */
export function OwnProfileEditForm({ locale, organizationId, values }: { locale: Locale; organizationId: string; values: OwnProfileValues }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(updateOwnCompanyAction, {});
  const list = (name: keyof OwnProfileValues & ("offerings" | "customerSegments" | "markets" | "geographies" | "soughtCapabilities"), rows = 3) => (
    <TextArea label={t(`company.fields.${name}`)} name={name} rows={rows} maxLength={3000} defaultValue={values[name].join("\n")} placeholder={t("company.listHint")} />
  );
  return (
    <form action={action} className="space-y-4" data-testid="own-profile-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("company.name")} name="name" maxLength={200} required defaultValue={values.name} />
        <Field label={t("company.website")} name="website" type="url" placeholder="https://" maxLength={500} defaultValue={values.website ?? ""} />
      </div>
      <TextArea label={t("company.summary")} name="summary" maxLength={4000} rows={3} defaultValue={values.summary} />
      <div className="grid gap-4 sm:grid-cols-2">
        {list("offerings")}
        {list("customerSegments")}
        {list("markets", 2)}
        {list("geographies", 2)}
      </div>
      {list("soughtCapabilities")}
      <fieldset>
        <legend className="text-[13px] font-medium text-fg">{t("company.fields.partnershipGoals")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <label key={g} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-edge px-3 py-1 text-[12.5px] text-fg has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand">
              <input type="checkbox" name="partnershipGoals" value={g} defaultChecked={values.partnershipGoals.includes(g)} className="sr-only" />
              {t(`analysis.relationships.${g}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorLine locale={locale} error={state.error} />
      {state.ok && (
        <p role="status" className="text-[13px] font-medium text-positive">
          {t("company.saved")}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        {t("common.save")}
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
