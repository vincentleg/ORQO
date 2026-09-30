"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { setLocaleAction, type ActionState } from "@/app/actions/workspace";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { Icon, type IconName } from "./icons";
import { cx, focusRing } from "./ui";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/workspace" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar (vertical) or compact top bar (horizontal) navigation with the current page marked. */
export function NavList({ items, label, orientation = "vertical" }: { items: NavItem[]; label: string; orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const horizontal = orientation === "horizontal";
  return (
    <nav aria-label={label}>
      <ul className={horizontal ? "flex gap-1 overflow-x-auto px-4 pb-2" : "space-y-0.5"}>
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2.5 rounded-lg px-3 text-[14px] transition-colors",
                  horizontal ? "h-8" : "h-9",
                  active ? "bg-brand-soft font-medium text-brand" : "text-fg-muted hover:bg-subtle hover:text-fg",
                  focusRing,
                )}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** EN / FR segmented switch. Saves to the profile (and the locale cookie) through the existing Server Action. */
export function LanguageSwitch({ locale, label, names }: { locale: Locale; label: string; names: Record<Locale, string> }) {
  const [, action, pending] = useActionState<ActionState, FormData>(setLocaleAction, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <span className="text-[12.5px] text-fg-faint" id="language-switch-label">
        {label}
      </span>
      <div role="group" aria-labelledby="language-switch-label" className="inline-flex rounded-lg border border-edge bg-subtle p-0.5">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="submit"
            name="locale"
            value={l}
            disabled={pending}
            aria-pressed={l === locale}
            aria-label={names[l]}
            className={cx("h-6 rounded-md px-2 text-[12px] font-medium uppercase transition-colors", l === locale ? "bg-surface text-fg shadow-card" : "text-fg-faint hover:text-fg", focusRing)}
          >
            {l}
          </button>
        ))}
      </div>
    </form>
  );
}
