import Link from "next/link";
import { AddCompanyForm } from "@/components/saas/forms";
import { formatDay } from "@/components/orqo/analysis";
import { DueLabel, FollowUpItem, StageBadge, originLabel } from "@/components/orqo/network";
import { OpportunityGraphSection } from "@/components/orqo/opportunity-graph";
import { FeatureCard } from "@/components/orqo/plan";
import { Badge, Card, CardHeader, cx, focusRing, inputClass, Monogram, Page, PageHeader } from "@/components/orqo/ui";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import {
  FOLLOW_UP_BUCKETS,
  NETWORK_ORIGINS,
  NETWORK_STAGES,
  compareFollowUps,
  followUpBucket,
  groupFollowUps,
  isoDay,
  primaryContact,
  type FollowUpView,
} from "@/lib/network/model";
import { getNetworkOverview, type NetworkCompany } from "@/lib/server/repositories/network-memory";
import { roleAtLeast } from "@/lib/server/tenancy/roles";
import { loadWorkspace } from "@/lib/server/workspace";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

/**
 * Network — the organization's business relationship memory. Everything shown
 * is what this workspace recorded (companies, people, interactions,
 * follow-ups); no provider or model is called to render it.
 */
export default async function NetworkPage({ searchParams }: PageProps<"/workspace/network">) {
  const { db, active, user, locale, plan } = await loadWorkspace();
  const t = createTranslator(locale);
  const params = await searchParams;
  const view = one(params.view) === "follow-ups" ? "follow-ups" : one(params.view) === "graph" ? "graph" : "companies";
  const overview = await getNetworkOverview(db, active.organizationId);
  const canWrite = roleAtLeast(active.role, "member");
  // Calendar days are UTC (documented limitation): deterministic on every server.
  const today = isoDay(new Date());

  const open = overview.followUps.filter((f) => f.status === "open");
  const counts = { overdue: 0, today: 0, this_week: 0 };
  for (const f of open) {
    const b = followUpBucket(f, today);
    if (b === "overdue" || b === "today" || b === "this_week") counts[b] += 1;
  }
  const names = new Map(overview.companies.map((c) => [c.id, c.name]));
  const contactNames = new Map([...overview.contactsByCompany.values()].flat().map((c) => [c.id, c.name]));

  return (
    <Page>
      <PageHeader title={t("network.title")} description={t("network.description")} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface px-4 py-3 shadow-card" data-testid="network-attention">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="font-semibold text-fg">{t("network.attention.title")}</span>
          {counts.overdue + counts.today + counts.this_week === 0 ? (
            <span className="text-fg-muted">{t("network.attention.none")}</span>
          ) : (
            <>
              {counts.overdue > 0 && <span className="font-medium text-critical">{t("network.attention.overdue", { n: counts.overdue })}</span>}
              {counts.today > 0 && <span className="font-medium text-caution">{t("network.attention.today", { n: counts.today })}</span>}
              {counts.this_week > 0 && <span className="text-fg-muted">{t("network.attention.thisWeek", { n: counts.this_week })}</span>}
            </>
          )}
        </div>
        <nav className="flex gap-1 rounded-lg bg-subtle p-1" aria-label={t("network.title")}>
          {(["companies", "follow-ups", "graph"] as const).map((v) => (
            <Link
              key={v}
              href={v === "companies" ? "/workspace/network" : `/workspace/network?view=${v}`}
              aria-current={view === v ? "page" : undefined}
              className={cx("rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", view === v ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg", focusRing)}
              data-testid={`network-view-${v}`}
            >
              {v === "companies" ? t("network.views.companies") : v === "graph" ? t("network.views.graph") : `${t("network.views.followUps")}${open.length ? ` · ${open.length}` : ""}`}
            </Link>
          ))}
        </nav>
      </div>

      {view === "graph" ? (
        // Phase 10: derived from this workspace's records; degrades inside the section, never fails the page.
        <OpportunityGraphSection
          db={db}
          locale={locale}
          organizationId={active.organizationId}
          canRebuild={roleAtLeast(active.role, "admin")}
          focusCompanyId={one(params.focus) || undefined}
          candidateId={one(params.candidate) || undefined}
        />
      ) : view === "follow-ups" ? (
        <FollowUpsView locale={locale} followUps={overview.followUps} today={today} names={names} contactNames={contactNames} organizationId={active.organizationId} canWrite={canWrite} userId={user.id} />
      ) : (
        <CompaniesView
          locale={locale}
          overview={overview}
          today={today}
          filters={{ q: one(params.q).trim().slice(0, 100), stage: one(params.stage), origin: one(params.origin), due: one(params.due) === "1" }}
          organizationId={active.organizationId}
          canWrite={canWrite}
        />
      )}

      <FeatureCard plan={plan} feature="agents.relationship" title={t("agents.items.relationship.name")} body={t("agents.items.relationship.purpose")} icon="agents" locale={locale} />
    </Page>
  );
}

function CompaniesView({
  locale,
  overview,
  today,
  filters,
  organizationId,
  canWrite,
}: {
  locale: Locale;
  overview: Awaited<ReturnType<typeof getNetworkOverview>>;
  today: string;
  filters: { q: string; stage: string; origin: string; due: boolean };
  organizationId: string;
  canWrite: boolean;
}) {
  const t = createTranslator(locale);
  const openByCompany = new Map<string, FollowUpView[]>();
  for (const f of overview.followUps.filter((x) => x.status === "open").sort(compareFollowUps)) openByCompany.set(f.companyId, [...(openByCompany.get(f.companyId) ?? []), f]);

  const q = filters.q.toLowerCase();
  const matches = (c: NetworkCompany) => {
    if (q && !c.name.toLowerCase().includes(q) && !(c.website ?? "").toLowerCase().includes(q)) return false;
    if (filters.stage === "none" ? c.stage !== null : filters.stage && c.stage !== filters.stage) return false;
    if (filters.origin && c.origin !== filters.origin) return false;
    if (filters.due) {
      const next = openByCompany.get(c.id)?.[0];
      const b = next ? followUpBucket(next, today) : null;
      if (b !== "overdue" && b !== "today") return false;
    }
    return true;
  };
  const filtered = filters.q || filters.stage || filters.origin || filters.due;
  const companies = overview.companies.filter((c) => !filtered || (!c.isOwnCompany && matches(c)));

  return (
    <Card>
      <CardHeader title={t("network.companies")} action={<span className="text-[12.5px] text-fg-faint tabular-nums">{t("workspace.count", { count: companies.length })}</span>} />
      <form method="get" action="/workspace/network" className="flex flex-wrap items-end gap-2 border-b border-edge px-5 py-3" role="search" data-testid="network-filters">
        <label className="min-w-48 flex-1">
          <span className="sr-only">{t("network.filters.search")}</span>
          <input name="q" defaultValue={filters.q} placeholder={t("network.filters.search")} maxLength={100} className={cx(inputClass, "h-9")} />
        </label>
        <label>
          <span className="sr-only">{t("network.filters.stage")}</span>
          <select name="stage" defaultValue={filters.stage} className={cx(inputClass, "h-9 w-auto")}>
            <option value="">{t("network.filters.anyStage")}</option>
            {NETWORK_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`network.stages.${s}`)}
              </option>
            ))}
            <option value="none">{t("network.filters.noStage")}</option>
          </select>
        </label>
        <label>
          <span className="sr-only">{t("network.filters.origin")}</span>
          <select name="origin" defaultValue={filters.origin} className={cx(inputClass, "h-9 w-auto")}>
            <option value="">{t("network.filters.anyOrigin")}</option>
            {NETWORK_ORIGINS.map((o) => (
              <option key={o} value={o}>
                {t(`network.origins.${o}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 px-1 text-[13px] text-fg">
          <input type="checkbox" name="due" value="1" defaultChecked={filters.due} className="h-4 w-4 accent-brand" />
          {t("network.filters.due")}
        </label>
        <button type="submit" className={cx("h-9 rounded-lg border border-edge-strong bg-surface px-3 text-[13px] font-medium text-fg shadow-card hover:bg-subtle", focusRing)}>
          {t("network.filters.apply")}
        </button>
        {filtered && (
          <Link href="/workspace/network" className={cx("rounded px-1 text-[13px] text-fg-muted hover:text-fg", focusRing)}>
            {t("network.filters.clear")}
          </Link>
        )}
      </form>
      {overview.companies.length === 0 ? (
        <p className="px-5 py-6 text-[13.5px] text-fg-muted">{t("network.empty")}</p>
      ) : companies.length === 0 ? (
        <p className="px-5 py-6 text-[13.5px] text-fg-muted">{t("network.noMatch")}</p>
      ) : (
        <ul className="divide-y divide-edge" data-testid="company-list">
          {companies.map((c) => {
            if (c.isOwnCompany) {
              return (
                <li key={c.id}>
                  <Link href="/workspace/company" className={cx("flex items-center gap-3 px-5 py-3.5 hover:bg-subtle/60", focusRing)}>
                    <Monogram name={c.name} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{c.name}</span>
                    <Badge tone="brand">{t("network.ownCompany")}</Badge>
                  </Link>
                </li>
              );
            }
            const contact = primaryContact(overview.contactsByCompany.get(c.id) ?? []);
            const latest = overview.latestInteractionByCompany.get(c.id);
            const next = openByCompany.get(c.id)?.[0];
            return (
              <li key={c.id} data-testid="company-row">
                <Link href={`/workspace/network/${c.id}`} className={cx("flex items-start gap-3 px-5 py-3.5 hover:bg-subtle/60", focusRing)}>
                  <Monogram name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-fg">{c.name}</span>
                      <StageBadge locale={locale} stage={c.stage} />
                      {c.origin && <span className="text-[12px] text-fg-faint">{originLabel(locale, c.origin)}</span>}
                    </div>
                    <div className="mt-1 grid gap-x-5 gap-y-0.5 text-[12.5px] text-fg-muted sm:grid-cols-3">
                      <span className="truncate">
                        <span className="text-fg-faint">{t("network.row.primary")} · </span>
                        {contact ? (contact.role ? `${contact.name}, ${contact.role}` : contact.name) : t("network.row.noContact")}
                      </span>
                      <span className="truncate">
                        <span className="text-fg-faint">{t("network.row.latest")} · </span>
                        {latest ? `${t(`network.interactionKinds.${latest.kind}`)} · ${formatDay(latest.occurredAt, locale)}` : t("network.row.noActivity")}
                      </span>
                      <span className="truncate">
                        <span className="text-fg-faint">{t("network.row.next")} · </span>
                        {next ? (
                          <>
                            {next.title} · <DueLabel locale={locale} followUp={next} today={today} />
                          </>
                        ) : latest?.nextStep ? (
                          `${t("network.row.nextStep")}: ${latest.nextStep}`
                        ) : (
                          t("network.row.noNext")
                        )}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t border-edge bg-subtle/50 px-5 py-4">
        {canWrite ? <AddCompanyForm locale={locale} organizationId={organizationId} /> : <p className="text-[13px] text-fg-faint">{t("workspace.viewerReadOnly")}</p>}
      </div>
    </Card>
  );
}

function FollowUpsView({
  locale,
  followUps,
  today,
  names,
  contactNames,
  organizationId,
  canWrite,
  userId,
}: {
  locale: Locale;
  followUps: FollowUpView[];
  today: string;
  names: Map<string, string>;
  contactNames: Map<string, string>;
  organizationId: string;
  canWrite: boolean;
  userId: string;
}) {
  const t = createTranslator(locale);
  const groups = groupFollowUps(followUps, today);
  if (followUps.length === 0) {
    return (
      <Card>
        <p className="px-5 py-6 text-[13.5px] text-fg-muted">{t("network.followUps.emptyAll")}</p>
      </Card>
    );
  }
  return (
    <div className="space-y-4" data-testid="follow-ups-view">
      {FOLLOW_UP_BUCKETS.filter((b) => groups[b].length > 0).map((b) => (
        <Card key={b}>
          <CardHeader title={<span className={cx(b === "overdue" && "text-critical")}>{t(`network.buckets.${b}`)}</span>} action={<span className="text-[12.5px] text-fg-faint tabular-nums">{groups[b].length}</span>} />
          <ul className="divide-y divide-edge" data-testid={`bucket-${b}`}>
            {groups[b].map((f) => (
              <FollowUpItem
                key={f.id}
                locale={locale}
                followUp={f}
                today={today}
                organizationId={organizationId}
                canWrite={canWrite}
                companyName={names.get(f.companyId)}
                contactName={f.contactId ? contactNames.get(f.contactId) : null}
                currentUserId={userId}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
