import { CenteredFrame } from "@/components/saas/frame";
import { CreateOrganizationForm } from "@/components/saas/forms";
import { createTranslator } from "@/lib/i18n/translate";
import { requirePageAuth } from "@/lib/server/auth/page";
import { getRequestLocale } from "@/lib/server/i18n";
import { getProfile } from "@/lib/server/repositories/tenancy";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { db, user } = await requirePageAuth("/onboarding");
  const profile = await getProfile(db, user.id);
  const locale = await getRequestLocale(profile?.locale);
  const t = createTranslator(locale);
  return (
    <CenteredFrame title={t("onboarding.title")} body={t("onboarding.body")}>
      <CreateOrganizationForm locale={locale} />
    </CenteredFrame>
  );
}
