"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type {
  CheckResult,
  Company,
  ConfidenceLevel,
  CriticVerdict,
  Epistemic,
  LifecycleStage,
  Person,
  Visibility,
} from "@/lib/domain/types";

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "match" | "signal";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.1)]",
  secondary: "bg-panel-3 text-ink border border-line-strong hover:border-white/25 hover:bg-white/[0.06]",
  ghost: "text-muted hover:text-ink hover:bg-white/[0.04]",
  match: "bg-match text-bg hover:brightness-110",
  signal: "bg-signal text-bg hover:brightness-110",
};

interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-4 text-sm", lg: "h-11 px-5 text-[15px]" };

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.98]",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Panel({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel", className)} {...rest}>
      {children}
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-faint", className)}>{children}</div>;
}

export function PanelHeader({ title, action, eyebrow }: { title: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
      <div>
        {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
        <h2 className="text-[13.5px] font-medium text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Chip({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider", TONES[tone], className)}>
      {children}
    </span>
  );
}

type Tone = "neutral" | "accent" | "match" | "signal" | "reject" | "quiet";

const TONES: Record<Tone, string> = {
  neutral: "border-line-strong text-muted bg-white/[0.02]",
  quiet: "border-transparent text-faint",
  accent: "border-accent/30 text-accent bg-accent/[0.07]",
  match: "border-match/30 text-match bg-match/[0.07]",
  signal: "border-signal/30 text-signal bg-signal/[0.07]",
  reject: "border-reject/30 text-reject bg-reject/[0.07]",
};

export function Dot({ tone = "accent", pulse }: { tone?: Tone; pulse?: boolean }) {
  const color = { accent: "bg-accent", match: "bg-match", signal: "bg-signal", reject: "bg-reject", neutral: "bg-muted", quiet: "bg-faint" }[tone];
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", color)} />}
      <span className={cx("relative inline-flex h-1.5 w-1.5 rounded-full", color)} />
    </span>
  );
}

export function monogram(name: string): string {
  const caps = name.match(/[A-Z]/g) ?? [];
  return (caps.length >= 2 ? caps.slice(0, 2).join("") : name.slice(0, 2)).toUpperCase();
}

export function CompanyMark({ company, size = 28 }: { company: Pick<Company, "name" | "accent">; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        letterSpacing: "-0.02em",
        color: company.accent,
        background: `color-mix(in oklab, ${company.accent} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${company.accent} 35%, transparent)`,
      }}
    >
      {monogram(company.name)}
    </span>
  );
}

export function Avatar({ person, accent, size = 28 }: { person: Pick<Person, "name">; accent?: string; size?: number }) {
  const initials = person.name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-panel-3 font-medium text-ink"
      style={{ width: size, height: size, fontSize: size * 0.36, boxShadow: `0 0 0 1px ${accent ?? "rgba(255,255,255,0.12)"}` }}
    >
      {initials}
    </span>
  );
}

const EPISTEMIC: Record<Epistemic, { label: string; tone: Tone }> = {
  fact: { label: "Fact", tone: "match" },
  inference: { label: "Inference", tone: "accent" },
  assumption: { label: "Assumption", tone: "signal" },
};

export function EpistemicTag({ kind }: { kind: Epistemic }) {
  return <Chip tone={EPISTEMIC[kind].tone}>{EPISTEMIC[kind].label}</Chip>;
}

const VISIBILITY: Record<Visibility, string> = {
  public: "Public",
  network: "Network",
  connection: "Connection",
  "agent-only": "Agent-only",
  private: "Private",
};

export function VisibilityTag({ v }: { v: Visibility }) {
  return (
    <Chip tone={v === "agent-only" || v === "private" ? "signal" : "quiet"} className="!px-1">
      <LockIcon open={v === "public" || v === "network"} />
      {VISIBILITY[v]}
    </Chip>
  );
}

export function LockIcon({ open }: { open?: boolean }) {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden>
      <rect x="0.75" y="4.25" width="7.5" height="5" rx="1.25" stroke="currentColor" strokeWidth="1.1" />
      <path d={open ? "M2.5 4.25V3a2 2 0 0 1 3.9-.6" : "M2.5 4.25V3a2 2 0 0 1 4 0v1.25"} stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

const STAGES: Record<LifecycleStage, { label: string; tone: Tone }> = {
  discovered: { label: "Discovered", tone: "accent" },
  interested: { label: "Interested", tone: "accent" },
  "mutual-interest": { label: "Business match", tone: "match" },
  meeting: { label: "Meeting", tone: "match" },
  qualified: { label: "Qualified", tone: "match" },
  pilot: { label: "Pilot", tone: "match" },
  partnership: { label: "Partnership", tone: "match" },
  revenue: { label: "Revenue", tone: "match" },
  rejected: { label: "Closed", tone: "reject" },
  dormant: { label: "Not now", tone: "neutral" },
};

export function stageLabel(stage: LifecycleStage): string {
  return STAGES[stage].label;
}

export function StageBadge({ stage }: { stage: LifecycleStage }) {
  return <Chip tone={STAGES[stage].tone}>{STAGES[stage].label}</Chip>;
}

const CONFIDENCE: Record<ConfidenceLevel, { label: string; bars: number; tone: string }> = {
  strong: { label: "Strong evidence", bars: 3, tone: "bg-match" },
  moderate: { label: "Moderate evidence", bars: 2, tone: "bg-accent" },
  limited: { label: "Limited evidence", bars: 1, tone: "bg-signal" },
};

export function ConfidenceMeter({ level }: { level: ConfidenceLevel }) {
  const c = CONFIDENCE[level];
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-muted">
      <span className="flex items-end gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx("w-[3px] rounded-sm", i < c.bars ? c.tone : "bg-white/10")} style={{ height: 6 + i * 3 }} />
        ))}
      </span>
      {c.label}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: CriticVerdict }) {
  const tone: Tone = verdict === "pass" ? "match" : verdict === "weak" ? "signal" : "reject";
  return <Chip tone={tone}>Critic · {verdict}</Chip>;
}

export function CheckIcon({ result }: { result: CheckResult }) {
  if (result === "pass")
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className="text-match" aria-hidden>
        <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.35" />
        <path d="M4.2 7.2l1.9 1.9 3.7-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (result === "warn")
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className="text-signal" aria-hidden>
        <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.35" />
        <path d="M7 3.8v3.8M7 9.8v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="text-reject" aria-hidden>
      <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 h-8 w-8 rounded-full border border-dashed border-line-strong" />
      <div className="text-sm font-medium text-ink">{title}</div>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return new Date(iso).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function relativeTo(iso: string, now: string): string {
  const days = Math.round((Date.parse(now) - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
