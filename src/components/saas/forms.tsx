"use client";

import Link from "next/link";
import { useActionState, type InputHTMLAttributes } from "react";
import { signInAction, signUpAction, type AuthFormState } from "@/app/actions/auth";
import { addCompanyAction, createOrganizationAction, setLocaleAction, type ActionState } from "@/app/actions/workspace";
import { Button } from "@/components/ui";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";

const PASSWORD_MIN = 8;

function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[12.5px] text-muted">{label}</span>
      <input
        {...input}
        className="mt-1.5 block h-10 w-full rounded-lg border border-line-strong bg-panel-2 px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/60"
      />
      {hint && <span className="mt-1 block text-[11.5px] text-faint">{hint}</span>}
    </label>
  );
}

function ErrorLine({ locale, error }: { locale: Locale; error?: MessageKey }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-reject/30 bg-reject/[0.06] px-3 py-2 text-[12.5px] text-reject">
      {createTranslator(locale)(error)}
    </p>
  );
}

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
      <p className="text-center text-[12.5px] text-muted">
        {t("auth.noAccount")}{" "}
        <Link href="/signup" className="text-accent hover:underline">
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
        <h2 className="text-[15px] font-medium text-ink">{t("auth.checkEmailTitle")}</h2>
        <p className="text-[13px] leading-relaxed text-muted">{t("auth.checkEmailBody", { email: state.confirmationSentTo })}</p>
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
      <p className="text-center text-[12.5px] text-muted">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className="text-accent hover:underline">
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
    <form action={action} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <Field label={t("workspace.companyName")} name="name" maxLength={200} required />
      <Field label={t("workspace.website")} name="website" type="url" placeholder="https://" maxLength={500} />
      <Button type="submit" variant="primary" disabled={pending} className="h-10">
        {t("workspace.addCompany")}
      </Button>
      <div className="col-span-3">
        <ErrorLine locale={locale} error={state.error} />
      </div>
    </form>
  );
}

export function LocaleForm({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(setLocaleAction, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <label className="text-[12.5px] text-muted" htmlFor="locale">
        {t("common.language")}
      </label>
      <select id="locale" name="locale" defaultValue={locale} className="h-8 rounded-md border border-line-strong bg-panel-2 px-2 text-[12.5px] text-ink">
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`locales.${l}`)}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        {t("common.save")}
      </Button>
      {state.ok && <span className="text-[12px] text-match">{t("workspace.languageSaved")}</span>}
      <ErrorLine locale={locale} error={state.error} />
    </form>
  );
}
