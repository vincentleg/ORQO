import { ButtonLink } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { getRequestLocale } from "@/lib/server/i18n";

export default async function NotFound() {
  const t = createTranslator(await getRequestLocale());
  return (
    <div className="orqo-light flex min-h-screen flex-col items-center justify-center bg-canvas px-8 text-center">
      <div className="text-[12.5px] font-semibold text-fg-faint tabular-nums">404</div>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{t("notFound.title")}</h1>
      <ButtonLink href="/" className="mt-6">
        {t("notFound.back")}
      </ButtonLink>
    </div>
  );
}
