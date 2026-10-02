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
  /** Other paths that belong to this destination (e.g. compatibility routes). */
  match?: string[];
}

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/workspace") return pathname === "/workspace";
  return under(pathname, item.href) || (item.match ?? []).some((m) => under(pathname, m));
}

/** Sidebar (vertical) or compact top bar (horizontal) navigation with the current page marked. */
export function NavList({ items, label, orientation = "vertical", size = "primary" }: { items: NavItem[]; label: string; orientation?: "vertical" | "horizontal"; size?: "primary" | "secondary" }) {
  const pathname = usePathname();
  const horizontal = orientation === "horizontal";
  return (
    <nav aria-label={label}>
      <ul className={horizontal ? "grid grid-cols-4 gap-1" : "space-y-0.5"}>
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center rounded-xl transition-colors",
                  horizontal ? "min-h-12 flex-col justify-center gap-0.5 px-1 text-[12px]" : size === "primary" ? "h-11 gap-3 px-3 text-[15px]" : "h-9 gap-2.5 px-3 text-[13.5px]",
                  active ? "bg-brand-soft font-medium text-brand" : "text-fg-muted hover:bg-subtle hover:text-fg",
                  focusRing,
                )}
              >
                <Icon name={item.icon} size={horizontal || size === "primary" ? 18 : 15} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** EN / FR segmented switch. Saves to the profile (and the locale cookie) through the existing Server Action. */
export function LanguageSwitch({ locale, label, names, id = "language-switch-label" }: { locale: Locale; label: string; names: Record<Locale, string>; id?: string }) {
  const [, action, pending] = useActionState<ActionState, FormData>(setLocaleAction, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <span className="text-[12.5px] text-fg-muted" id={id}>
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="inline-flex rounded-lg border border-edge bg-subtle p-0.5">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="submit"
            name="locale"
            value={l}
            disabled={pending}
            aria-pressed={l === locale}
            aria-label={names[l]}
            className={cx("h-8 min-w-9 rounded-md px-2 text-[12.5px] font-medium uppercase transition-colors", l === locale ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg", focusRing)}
          >
            {l}
          </button>
        ))}
      </div>
    </form>
  );
}
