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
import { Icon } from "./icons";
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
 * The authenticated ORQO application frame (Phase 16B): four destinations organized around the user's job
 * (Work, Companies, Opportunities, Events), a quiet "More" area for everything else (your company, Discover,
 * Signals, Agents, Overview, Plans, Settings), the active workspace, language and account.
 * Engine concepts (agents, graph, signal engines) are never primary destinations; their routes still work.
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
    { href: "/workspace", label: t("nav.work"), icon: "work" },
    { href: "/workspace/companies", label: t("nav.companies"), icon: "company", match: ["/workspace/network", "/workspace/report"] },
    { href: "/workspace/opportunities", label: t("nav.opportunities"), icon: "opportunities" },
    { href: "/workspace/events", label: t("nav.events"), icon: "events" },
  ];
  const secondary: NavItem[] = [
    { href: "/workspace/company", label: t("nav.yourCompany"), icon: "company" },
    { href: "/workspace/discover", label: t("nav.findCompanies"), icon: "discover" },
    { href: "/workspace/intelligence", label: t("nav.signals"), icon: "intelligence" },
    { href: "/workspace/agents", label: t("nav.agents"), icon: "agents" },
    { href: "/workspace/dashboard", label: t("nav.overview"), icon: "dashboard" },
    { href: PLANS_HREF, label: t("nav.plans"), icon: "plans" },
    { href: "/workspace/settings", label: t("nav.settings"), icon: "settings" },
  ];
  const names = { en: t("locales.en"), fr: t("locales.fr") };

  const workspace = (
    <div className="px-3">
      {organizations.length > 1 ? (
        <form action={selectOrganizationAction} className="flex items-center gap-1.5">
          <label htmlFor="org-switch" className="sr-only">
            {t("nav.switchWorkspace")}
          </label>
          <select id="org-switch" name="organizationId" defaultValue={active.organizationId} className={cx("h-9 min-w-0 flex-1 rounded-md border border-edge bg-surface px-2 text-[13px] text-fg", focusRing)}>
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
        <div className="truncate text-[14px] font-semibold text-fg" data-testid="workspace-name">
          {active.name}
        </div>
      )}
      <Link href={PLANS_HREF} className={cx("mt-1.5 inline-flex rounded-full", focusRing)} data-testid="plan-badge">
        <PlanBadge plan={plan} locale={locale} />
      </Link>
    </div>
  );

  const account = (id: string) => (
    <div className="space-y-3 px-3">
      <LanguageSwitch locale={locale} label={t("common.language")} names={names} id={id} />
      {email && <div className="truncate text-[12.5px] text-fg-muted">{email}</div>}
      <div className="flex items-center justify-between gap-2">
        <form action={signOutAction}>
          <Button type="submit" size="sm" variant="ghost" className="-ml-3 min-h-9">
            {t("common.signOut")}
          </Button>
        </form>
        <Link href={demoHref("/")} className={cx("rounded text-[12.5px] text-fg-muted hover:text-fg", focusRing)}>
          {t("common.openDemo")}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="orqo-light min-h-screen bg-canvas md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 overflow-y-auto px-3 py-6 md:flex print:hidden">
        <div className="px-3">
          <Wordmark href="/workspace" />
        </div>
        {workspace}
        <NavList items={primary} label={t("nav.primary")} />
        <div className="mt-auto space-y-5">
          <div>
            <p className="px-3 pb-1 text-[12px] font-medium text-fg-muted" id="nav-more-label">
              {t("nav.more")}
            </p>
            <NavList items={secondary} label={t("nav.more")} size="secondary" />
          </div>
          <div className="border-t border-edge pt-4">{account("language-switch-label")}</div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-edge bg-canvas/95 backdrop-blur md:hidden print:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Wordmark href="/workspace" />
          <details className="group relative" data-testid="mobile-more">
            <summary className={cx("flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl px-3 text-[14px] text-fg-muted hover:bg-subtle [&::-webkit-details-marker]:hidden", focusRing)}>
              <span className="max-w-[38vw] truncate font-medium text-fg">{active.name}</span>
              <Icon name="more" size={18} />
              <span className="sr-only">{t("nav.more")}</span>
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-2xl border border-edge bg-surface p-3 shadow-raised">
              {workspace}
              <NavList items={secondary} label={t("nav.more")} size="secondary" />
              <div className="border-t border-edge pt-3">{account("language-switch-label-mobile")}</div>
            </div>
          </details>
        </div>
        <div className="px-2 pb-2">
          <NavList items={primary} label={t("nav.primary")} orientation="horizontal" />
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
