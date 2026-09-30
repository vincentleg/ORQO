import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { selectOrganizationAction } from "@/app/actions/workspace";
import { Logo } from "@/components/logo";
import { AddCompanyForm, LocaleForm } from "@/components/saas/forms";
import { Button, Chip, Eyebrow, Panel, PanelHeader } from "@/components/ui";
import { demoHref } from "@/lib/demo-path";
import { createTranslator } from "@/lib/i18n/translate";
import { requireWorkspace } from "@/lib/server/auth/page";
import { getRequestLocale } from "@/lib/server/i18n";
import { listCompanies } from "@/lib/server/repositories/companies";
import { getProfile, listMembers } from "@/lib/server/repositories/tenancy";
import { roleAtLeast } from "@/lib/server/tenancy/roles";

export const dynamic = "force-dynamic";

/**
 * Minimal protected workspace (Phase 1): proves authenticated, organization-
 * scoped persistence. The full Search-first shell arrives in Phase 2.
 */
export default async function WorkspacePage() {
  const { db, user, active, organizations } = await requireWorkspace("/workspace");
  const [profile, companies, members] = await Promise.all([getProfile(db, user.id), listCompanies(db, active.organizationId), listMembers(db, active.organizationId)]);
  const locale = await getRequestLocale(profile?.locale);
  const t = createTranslator(locale);
  const canWrite = roleAtLeast(active.role, "member");

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-line px-6">
        <div className="flex items-center gap-4">
          <Link href="/workspace" className="flex items-center gap-2.5 text-ink">
            <Logo />
            <span className="text-[15px] font-semibold tracking-[0.18em]">ORQO</span>
          </Link>
          {organizations.length > 1 ? (
            <form action={selectOrganizationAction} className="flex items-center gap-2">
              <select name="organizationId" defaultValue={active.organizationId} className="h-8 rounded-md border border-line-strong bg-panel-2 px-2 text-[12.5px] text-ink">
                {organizations.map((o) => (
                  <option key={o.organizationId} value={o.organizationId}>
                    {o.name}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="ghost">
                ↵
              </Button>
            </form>
          ) : (
            <span className="text-[13.5px] text-ink" data-testid="workspace-name">
              {active.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Link href={demoHref("/")} className="text-[12.5px] text-muted hover:text-ink">
            {t("common.openDemo")}
          </Link>
          <form action={signOutAction}>
            <Button type="submit" size="sm">
              {t("common.signOut")}
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1100px] grid-cols-[minmax(0,1fr)_320px] gap-6 px-8 py-8">
        <div className="space-y-6">
          <div>
            <Eyebrow>{t("workspace.yourRole", { role: t(`roles.${active.role}`) })}</Eyebrow>
            <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">{active.name}</h1>
          </div>
          <Panel>
            <PanelHeader title={t("workspace.companies")} action={<span className="font-mono text-[11px] text-faint">{t("workspace.count", { count: companies.length })}</span>} />
            {companies.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted">{t("workspace.companiesEmpty")}</p>
            ) : (
              <ul className="divide-y divide-line" data-testid="company-list">
                {companies.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-5 py-3 text-[13.5px]">
                    <span className="text-ink">{c.name}</span>
                    {c.website && <span className="text-[12px] text-faint">{c.website}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line px-5 py-4">
              {canWrite ? <AddCompanyForm locale={locale} organizationId={active.organizationId} /> : <p className="text-[12.5px] text-faint">{t("workspace.viewerReadOnly")}</p>}
            </div>
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader title={t("workspace.members")} />
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <span className="truncate text-ink">{m.displayName ?? (m.userId === user.id ? user.email : "—")}</span>
                  <Chip tone="quiet">{t(`roles.${m.role}`)}</Chip>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title={t("workspace.account")} />
            <div className="space-y-3 px-5 py-4">
              <div className="truncate text-[12.5px] text-muted">{user.email}</div>
              <LocaleForm locale={locale} />
            </div>
          </Panel>
        </aside>
      </main>
    </div>
  );
}
