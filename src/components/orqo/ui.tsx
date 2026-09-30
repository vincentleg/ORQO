import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/**
 * ORQO production design system (light). Server-safe primitives: no hooks, so
 * they render in Server and Client Components alike. The demo keeps its own
 * dark components in `components/ui.tsx`.
 */

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE = `inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white shadow-card hover:bg-brand-strong",
  secondary: "border border-edge-strong bg-surface text-fg shadow-card hover:bg-subtle",
  ghost: "text-fg-muted hover:bg-subtle hover:text-fg",
};
const BUTTON_SIZES: Record<ButtonSize, string> = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-4 text-sm", lg: "h-11 px-5 text-[15px]" };

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

export function Button({ variant, size, className, type = "button", ...rest }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({ variant, size, className, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export const inputClass = `block h-10 w-full rounded-lg border border-edge-strong bg-surface px-3 text-[14px] text-fg shadow-card transition-colors placeholder:text-fg-faint focus:border-brand ${focusRing}`;

export function Field({ label, hint, className, ...input }: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className={cx("block", className)}>
      <span className="text-[13px] font-medium text-fg-muted">{label}</span>
      <input {...input} className={cx(inputClass, "mt-1.5")} />
      {hint && <span className="mt-1 block text-[12px] text-fg-faint">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, className, ...input }: { label: string } & ComponentProps<"textarea">) {
  return (
    <label className={cx("block", className)}>
      <span className="text-[13px] font-medium text-fg-muted">{label}</span>
      <textarea {...input} className={cx(inputClass, "mt-1.5 h-auto min-h-24 py-2.5")} />
    </label>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-xl border border-edge bg-surface shadow-card", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export type BadgeTone = "neutral" | "brand" | "positive" | "caution" | "critical" | "outline";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-subtle text-fg-muted",
  brand: "bg-brand-soft text-brand",
  positive: "bg-positive-soft text-positive",
  caution: "bg-caution-soft text-caution",
  critical: "bg-critical-soft text-critical",
  outline: "border border-edge-strong text-fg-muted",
};

export function Badge({ tone = "neutral", icon, children, className }: { tone?: BadgeTone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap", BADGE_TONES[tone], className)}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1.5 text-[14.5px] leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Page body container: consistent width and vertical rhythm for every space. */
export function Page({ children, width = "default" }: { children: ReactNode; width?: "default" | "narrow" }) {
  return <div className={cx("mx-auto w-full space-y-8 px-5 py-8 md:px-10 md:py-10", width === "narrow" ? "max-w-3xl" : "max-w-5xl")}>{children}</div>;
}

export function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon = "search", title, body, action, className }: { icon?: IconName; title: string; body: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-12 text-center", className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-fg-faint">
        <Icon name={icon} size={18} />
      </span>
      <h3 className="mt-3 text-[14.5px] font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-md text-[13.5px] leading-relaxed text-fg-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-md bg-subtle", className)} />;
}

export function ListRow({ leading, title, meta, trailing }: { leading?: ReactNode; title: ReactNode; meta?: ReactNode; trailing?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-fg">{title}</div>
        {meta && <div className="truncate text-[12.5px] text-fg-faint">{meta}</div>}
      </div>
      {trailing}
    </li>
  );
}

export function Monogram({ name, size = 32 }: { name: string; size?: number }) {
  const letters = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-soft font-semibold text-brand" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {letters}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-card">
      <div className="text-[13px] text-fg-muted">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tracking-tight text-fg tabular-nums">{value}</div>
    </div>
  );
}
