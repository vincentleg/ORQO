import Link from "next/link";
import { DossierView } from "@/components/orqo/dossier";
import { UnderstandingCard } from "@/components/orqo/analysis";
import { PrintButton } from "@/components/orqo/print-button";
import { Card, Page, cx, focusRing } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { getDossier } from "@/lib/server/repositories/understanding";
import { findIntelligence } from "@/lib/server/research/repository";
import { loadWorkspace } from "@/lib/server/workspace";
import { parseSearchQuery } from "@/lib/search/query";

export const dynamic = "force-dynamic";

/**
 * Deal Intelligence Report (Phase 15). Built ONLY from intelligence already stored in this workspace: it never
 * researches, never calls a provider and never writes. Membership is enforced by the workspace loader and every
 * read is tenant-scoped (RLS). "Download PDF" is the browser's print-to-PDF.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { db, active, locale } = await loadWorkspace();
  const t = createTranslator(locale);
  const target = parseSearchQuery((await searchParams).q ?? null);
  const intel = target ? await findIntelligence(db, active.organizationId, target.kind === "website" ? { domain: target.domain } : { name: target.name }) : null;
  const dossier = intel ? await getDossier(db, active.organizationId, intel) : null;
  const backHref = intel ? `/workspace?q=${encodeURIComponent(intel.profile.domain)}` : "/workspace";

  if (!intel || !dossier) {
    return (
      <Page width="narrow">
        <Card className="px-5 py-6" data-testid="report-missing">
          <h1 className="text-[20px] font-semibold text-fg">{t("dossier.reportTitle")}</h1>
          <p className="mt-2 text-[14px] text-fg-muted">{intel ? t("dossier.status.own_missing") : t("dossier.reportMissing")}</p>
          <Link href={intel ? "/workspace/company" : backHref} className={cx("mt-3 inline-block text-[13.5px] font-medium text-brand hover:underline", focusRing)}>
            {intel ? t("dossier.readOwn") : t("dossier.reportBack")} →
          </Link>
        </Card>
      </Page>
    );
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "long" });
  return (
    <Page width="narrow">
      <article className="space-y-5" data-testid="deal-report">
        <header className="space-y-2 border-b border-edge pb-4">
          <p className="text-[12.5px] font-semibold tracking-wide text-brand uppercase">ORQO · {t("dossier.reportTitle")}</p>
          <h1 className="text-[26px] font-semibold text-fg">{t("dossier.reportSubtitle", { own: dossier.ownName, target: dossier.targetName })}</h1>
          <p className="text-[13px] text-fg-muted" data-testid="report-stored">{t("dossier.reportStored")}</p>
          <p className="text-[12.5px] text-fg-faint">{t("dossier.reportGenerated", { date: fmt(new Date().toISOString()), researched: fmt(intel.researchedAt) })}</p>
          <div className="flex flex-wrap items-center gap-3 pt-1 print:hidden">
            <PrintButton label={t("dossier.reportPrint")} />
            <span className="text-[12.5px] text-fg-muted">{t("dossier.reportPrintHint")}</span>
            <Link href={backHref} className={cx("text-[13px] text-brand hover:underline", focusRing)}>
              {t("dossier.reportBack")}
            </Link>
          </div>
        </header>
        <DossierView dossier={dossier} locale={locale} reportHref={null} expanded />
        <UnderstandingCard profile={intel.profile} locale={locale} />
        <section data-testid="report-sources">
          <h2 className="text-[15px] font-semibold text-fg">{t("dossier.sources")}</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-fg-muted">
            {intel.profile.sources.map((s) => (
              <li key={s.key}>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand hover:underline">
                  {s.url}
                </a>{" "}
                · {fmt(s.retrievedAt)}
              </li>
            ))}
          </ol>
        </section>
      </article>
    </Page>
  );
}
