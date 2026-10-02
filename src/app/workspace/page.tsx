import Link from "next/link";
import { redirect } from "next/navigation";
import { CeoAnswerView, CeoExamples, CeoInput, ContinueWorking, MemoryLine, OneQuestion, TopOpportunities } from "@/components/orqo/ceo";
import { cx, focusRing } from "@/components/orqo/ui";
import { createTranslator } from "@/lib/i18n/translate";
import { answerCeo } from "@/lib/server/ceo/answer";
import { loadBriefing } from "@/lib/server/ceo/briefing";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

/**
 * Work (Phase 16B): the authenticated home. The user states an objective to ORQO CEO; below, the briefing
 * shows only what helps decide what to do next, from what ORQO already knows.
 *
 * Read-only: this page researches nothing, fetches nothing, calls no provider or model and starts no agent.
 * The CEO answers with existing capabilities (see lib/server/ceo). The old Search home moved to Companies;
 * `/workspace?q=` keeps working by redirecting there.
 */
export default async function WorkPage({ searchParams }: PageProps<"/workspace">) {
  const params = await searchParams;
  if (typeof params.q === "string") redirect(`/workspace/companies?q=${encodeURIComponent(params.q)}`);
  const { db, active, locale, displayName } = await loadWorkspace();
  const t = createTranslator(locale);
  const ask = typeof params.ask === "string" ? params.ask.trim().slice(0, 500) : "";
  const canWrite = roleAtLeast(active.role, "member");
  const actions = { organizationId: active.organizationId, canWrite, locale };

  const answer = ask ? await answerCeo(db, active.organizationId, ask, { as: params.as, company: params.company }) : null;
  const briefing = answer ? null : await loadBriefing(db, active.organizationId);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 px-5 py-10 md:px-10 md:py-14">
      <header className="space-y-5">
        <div>
          {displayName && <p className="text-[15px] text-fg-muted">{t("work.greeting", { name: displayName })}</p>}
          <h1 className="mt-1 text-[30px] leading-tight font-semibold tracking-tight text-fg md:text-[36px]">{t("work.title")}</h1>
        </div>
        <CeoInput locale={locale} value={ask} autoFocus={!ask} />
        {!ask && <CeoExamples locale={locale} />}
        <p className="text-[13px] text-fg-muted" data-testid="work-basis">
          {t("work.basis")}
        </p>
      </header>

      {answer ? (
        <>
          <CeoAnswerView answer={answer} locale={locale} actions={actions} />
          <Link href="/workspace" className={cx("inline-flex min-h-11 items-center rounded text-[14px] font-medium text-brand hover:underline", focusRing)}>
            ← {t("work.back")}
          </Link>
        </>
      ) : (
        briefing && (
          <>
            <TopOpportunities items={briefing.top} locale={locale} headingId="work-top-title" />
            <OneQuestion question={briefing.question} locale={locale} organizationId={active.organizationId} canWrite={canWrite} headingId="work-question-title" />
            <ContinueWorking items={briefing.continue} locale={locale} headingId="work-continue-title" />
            <MemoryLine briefing={briefing} locale={locale} />
          </>
        )
      )}
    </div>
  );
}
