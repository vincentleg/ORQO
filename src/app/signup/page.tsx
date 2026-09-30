import { CenteredFrame } from "@/components/saas/frame";
import { SignUpForm } from "@/components/saas/forms";
import { createTranslator } from "@/lib/i18n/translate";
import { getRequestLocale } from "@/lib/server/i18n";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const locale = await getRequestLocale();
  return (
    <CenteredFrame title={createTranslator(locale)("auth.signUpTitle")}>
      <SignUpForm locale={locale} />
    </CenteredFrame>
  );
}
