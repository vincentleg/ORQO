import Link from "next/link";
import { CenteredFrame } from "@/components/saas/frame";
import { SignInForm } from "@/components/saas/forms";
import { createTranslator } from "@/lib/i18n/translate";
import { safeNextPath } from "@/lib/server/auth/flows";
import { getRequestLocale } from "@/lib/server/i18n";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  return (
    <CenteredFrame
      title={t("auth.signInTitle")}
      footer={
        <Link href="/tour" className="hover:text-fg">
          {t("common.openDemo")} →
        </Link>
      }
    >
      <SignInForm locale={locale} next={safeNextPath(params.next)} initialError={params.error === "confirm" ? "auth.confirmFailed" : undefined} />
    </CenteredFrame>
  );
}
