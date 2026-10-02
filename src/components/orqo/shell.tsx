import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
import { selectOrganizationAction } from "@/app/actions/workspace";
import { Logo } from "@/components/logo";
import { demoHref } from "@/lib/demo-path";
import type { Plan } from "@/lib/entitlements/plans";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import type { OrganizationMembership } from "@/lib/server/repositories/tenancy";
import { PLANS_HREF, PlanBadge } from "./plan";
import { LanguageSwitch, NavList, type NavItem } from "./shell-client";
import { Button, cx, focusRing } from "./ui";

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className={cx("flex items-center gap-2.5 rounded-md text-fg", focusRing)}>
      <span className="text-brand">
        <Logo />
      </span>
      <span className="text-[15px] font-semibold tracking-[0.18em]">ORQO</span>
    </Link>
  );
}

/**
 * The authenticated ORQO application frame: seven principal spaces, secondary
 * areas, the active workspace (and its presented plan), language and account.
 */
export function AppFrame({
  locale,
  active,
  organizations,
  plan,
  email,
  children,
}: {
  locale: Locale;
  active: OrganizationMembership;
  organizations: OrganizationMembership[];
  plan: Plan;
  email?: string;
  children: ReactNode;
}) {
  const t = createTranslator(locale);
  const primary: NavItem[] = [
    { href: "/workspace", label: t("nav.search"), icon: "search" },
    { href: "/workspace/discover", label: t("nav.discover"), icon: "discover" },
    { href: "/workspace/network", label: t("nav.network"), icon: "network" },
    { href: "/workspace/intelligence", label: t("nav.intelligence"), icon: "intelligence" },
    { href: "/workspace/events", label: t("nav.events"), icon: "events" },
    { href: "/workspace/agents", label: t("nav.agents"), icon: "agents" },
    { href: "/workspace/dashboard", label: t("nav.dashboard"), icon: "dashboard" },
  ];
  const secondary: NavItem[] = [
    { href: "/workspace/company", label: t("nav.company"), icon: "company" },
    { href: PLANS_HREF, label: t("nav.plans"), icon: "plans" },
    { href: "/workspace/settings", label: t("nav.settings"), icon: "settings" },
  ];
  const names = { en: t("locales.en"), fr: t("locales.fr") };

  const workspace = (
    <div className="rounded-xl border border-edge bg-surface px-3 py-2.5 shadow-card">
      <div className="text-[11.5px] font-medium uppercase tracking-wide text-fg-faint">{t("nav.workspace")}</div>
      {organizations.length > 1 ? (
        <form action={selectOrganizationAction} className="mt-1 flex items-center gap-1.5">
          <label htmlFor="org-switch" className="sr-only">
            {t("nav.switchWorkspace")}
          </label>
          <select id="org-switch" name="organizationId" defaultValue={active.organizationId} className={cx("h-8 min-w-0 flex-1 rounded-md border border-edge bg-surface px-2 text-[13px] text-fg", focusRing)}>
            {organizations.map((o) => (
              <option key={o.organizationId} value={o.organizationId}>
                {o.name}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="ghost" className="px-2">
            {t("nav.open")}
          </Button>
        </form>
      ) : (
        <div className="mt-0.5 truncate text-[14px] font-semibold text-fg" data-testid="workspace-name">
          {active.name}
        </div>
      )}
      <Link href={PLANS_HREF} className={cx("mt-2 inline-flex rounded-full", focusRing)} data-testid="plan-badge">
        <PlanBadge plan={plan} locale={locale} />
      </Link>
    </div>
  );

  return (
    <div className="orqo-light min-h-screen bg-canvas md:flex">
      <aside className="sticky top-0 hidden print:hidden h-screen w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-edge bg-canvas px-4 py-5 md:flex">
        <div className="px-2">
          <Wordmark href="/workspace" />
        </div>
        {workspace}
        <NavList items={primary} label={t("nav.primary")} />
        <div className="mt-auto space-y-4">
          <NavList items={secondary} label={t("nav.settings")} />
          <div className="space-y-3 border-t border-edge px-2 pt-4">
            <LanguageSwitch locale={locale} label={t("common.language")} names={names} />
            {email && <div className="truncate text-[12.5px] text-fg-faint">{email}</div>}
            <div className="flex items-center justify-between gap-2">
              <form action={signOutAction}>
                <Button type="submit" size="sm" variant="ghost" className="-ml-3">
                  {t("common.signOut")}
                </Button>
              </form>
              <Link href={demoHref("/")} className={cx("rounded text-[12.5px] text-fg-faint hover:text-fg", focusRing)}>
                {t("common.openDemo")}
              </Link>
            </div>
          </div>
        </div>
      </aside>

      <header className="border-b border-edge bg-canvas md:hidden print:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Wordmark href="/workspace" />
          <div className="flex items-center gap-3">
            <span className="max-w-[40vw] truncate text-[13px] font-medium text-fg">{active.name}</span>
            <PlanBadge plan={plan} locale={locale} />
          </div>
        </div>
        <NavList items={[...primary, ...secondary]} label={t("nav.primary")} orientation="horizontal" />
      </header>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
