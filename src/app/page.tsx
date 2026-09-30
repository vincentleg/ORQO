import { redirect } from "next/navigation";
import { LanguageSwitch } from "@/components/orqo/shell-client";
import { Wordmark } from "@/components/orqo/shell";
import { ButtonLink } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { getAuthContext } from "@/lib/server/auth/context";
import { getRequestLocale } from "@/lib/server/i18n";
import { demoHref } from "@/lib/demo-path";

export const dynamic = "force-dynamic";

/** Production entry. Signed-in users go straight to Search; everyone can open the demo. */
export default async function Home() {
  if (await getAuthContext().catch(() => null)) redirect("/workspace");
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  return (
    <div className="orqo-light flex min-h-screen flex-col bg-canvas">
      <header className="flex h-16 items-center justify-between px-6 md:px-10">
        <Wordmark />
        <div className="flex items-center gap-4">
          <LanguageSwitch locale={locale} label={t("common.language")} names={{ en: t("locales.en"), fr: t("locales.fr") }} />
          <ButtonLink href="/login" size="sm">
            {t("common.signIn")}
          </ButtonLink>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-20">
        <div className="text-[12.5px] font-semibold uppercase tracking-wide text-brand">{t("common.tagline")}</div>
        <h1 className="mt-4 text-[38px] font-semibold leading-[1.15] tracking-tight text-fg md:text-[46px]">{t("home.title")}</h1>
        <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-fg-muted">{t("home.body")}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ButtonLink href="/signup" variant="primary" size="lg">
            {t("common.signUp")}
          </ButtonLink>
          <ButtonLink href="/login" size="lg">
            {t("common.signIn")}
          </ButtonLink>
          <ButtonLink href={demoHref("/")} variant="ghost" size="lg">
            {t("common.openDemo")} →
          </ButtonLink>
        </div>
        <p className="mt-3 text-[13px] text-fg-faint">{t("home.demoHint")}</p>
      </main>
    </div>
  );
}
