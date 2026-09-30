import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { featureAccess, type FeatureAccess, type FeatureKey, type Plan } from "@/lib/entitlements/plans";
import { Icon, type IconName } from "./icons";
import { Badge, ButtonLink, cx } from "./ui";

/**
 * Entitlement-aware presentation. Components ask `featureAccess(plan, key)`;
 * none of them compare plan strings. Presentation only — the authoritative
 * check for anything that costs money will live on the server.
 */

export const PLANS_HREF = "/workspace/plans";

export function PlanBadge({ plan, locale }: { plan: Plan; locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <Badge tone={plan === "free" ? "outline" : "brand"} className="uppercase tracking-wide" >
      {t(`plans.${plan}`)}
    </Badge>
  );
}

/** Small status pill for a feature: included, coming soon, or locked with its plan. */
export function AccessBadge({ access, locale }: { access: FeatureAccess; locale: Locale }) {
  const t = createTranslator(locale);
  if (access.state === "locked") return <Badge tone="brand" icon="lock">{t(`plans.${access.requiredPlan}`)}</Badge>;
  if (access.state === "coming_soon") return <Badge tone="neutral" icon="clock">{t("access.comingSoon")}</Badge>;
  return <Badge tone="positive" icon="check">{t("access.included")}</Badge>;
}

export function UpgradeLink({ plan, locale, size = "sm", variant = "primary" }: { plan: Plan; locale: Locale; size?: "sm" | "md"; variant?: "primary" | "secondary" }) {
  const t = createTranslator(locale);
  return (
    <ButtonLink href={PLANS_HREF} size={size} variant={variant}>
      {t("plans.upgradeTo", { plan: t(`plans.${plan}`) })}
    </ButtonLink>
  );
}

/**
 * A premium capability the user can see but not use. It explains what the
 * feature does, why it is unavailable and which plan includes it. It never
 * offers an action that would pretend to execute.
 */
export function FeatureCard({
  plan,
  feature,
  title,
  body,
  icon,
  locale,
  className,
}: {
  plan: Plan;
  feature: FeatureKey;
  title: string;
  body: string;
  icon: IconName;
  locale: Locale;
  className?: string;
}) {
  const t = createTranslator(locale);
  const access = featureAccess(plan, feature);
  const locked = access.state === "locked";
  return (
    <article
      className={cx("flex flex-col rounded-xl border bg-surface p-5 shadow-card", locked ? "border-edge" : "border-edge", className)}
      data-feature={feature}
      data-access={access.state}
      aria-label={locked ? `${title} — ${t("access.locked")}` : title}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cx("flex h-9 w-9 items-center justify-center rounded-lg", locked ? "bg-subtle text-fg-faint" : "bg-brand-soft text-brand")}>
          <Icon name={locked ? "lock" : icon} size={17} />
        </span>
        <AccessBadge access={access} locale={locale} />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-fg">{title}</h3>
      <p className="mt-1 flex-1 text-[13.5px] leading-relaxed text-fg-muted">{body}</p>
      <div className="mt-4 border-t border-edge pt-4">
        {locked ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12.5px] text-fg-muted">
              {t("plans.availableWith", { plan: t(`plans.${access.requiredPlan}`) })}
              <span className="sr-only"> · {t("access.lockedBody", { current: t(`plans.${plan}`) })}</span>
            </span>
            <UpgradeLink plan={access.requiredPlan} locale={locale} />
          </div>
        ) : (
          <span className="text-[12.5px] text-fg-faint">{access.state === "coming_soon" ? t("access.notRunYet") : t("access.included")}</span>
        )}
      </div>
    </article>
  );
}
