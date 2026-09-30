import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { LocaleForm } from "@/components/saas/forms";
import { ButtonLink } from "@/components/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { getAuthContext } from "@/lib/server/auth/context";
import { getRequestLocale } from "@/lib/server/i18n";
import { demoHref } from "@/lib/demo-path";

export const dynamic = "force-dynamic";

/** Production entry. Signed-in users go straight to their workspace; everyone can open the demo. */
export default async function Home() {
  if (await getAuthContext().catch(() => null)) redirect("/workspace");
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-line px-6">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <Logo />
          <span className="text-[15px] font-semibold tracking-[0.18em]">ORQO</span>
        </Link>
        <div className="flex items-center gap-4">
          <LocaleForm locale={locale} />
          <ButtonLink href="/login" size="sm">
            {t("common.signIn")}
          </ButtonLink>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-20">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">{t("common.tagline")}</div>
        <h1 className="mt-4 text-[40px] font-semibold leading-tight tracking-tight text-ink">{t("home.title")}</h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">{t("home.body")}</p>
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
        <p className="mt-3 text-[12.5px] text-faint">{t("home.demoHint")}</p>
      </main>
    </div>
  );
}
