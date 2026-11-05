"use client";

/**
 * The guided tour's views (Nov 2026). Each view is the ORQO interface for one moment of the scenario, built
 * from the product's own components (BusinessDnaCard, MarketModelCard, UnderstandingCard, EvidenceCard,
 * CompanyComparison, DossierView, OpportunityMapView, TrackedOpportunityView) and the product's own copy, fed
 * with what the product engine computed for the scenario. Read-only: no form, no action, no request.
 */
import { EvidenceCard, UnderstandingCard } from "@/components/orqo/analysis";
import { CompanyComparison } from "@/components/orqo/compare";
import { DossierView, investigationText, questionText, scenarioTitle } from "@/components/orqo/dossier";
import { Icon, type IconName } from "@/components/orqo/icons";
import { OpportunityMapView } from "@/components/orqo/opportunity-map";
import { TrackedOpportunityView } from "@/components/orqo/tracked-opportunity";
import { Badge, ButtonLink, Card, CardHeader, cx } from "@/components/orqo/ui";
import { BusinessDnaCard, MarketModelCard } from "@/components/orqo/understanding";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { conceptLabel } from "@/lib/intelligence/concepts";
import { MONITORING_EVENTS, QUESTION_ROLES, type TourData } from "@/lib/tour/scenario";
import type { NavId, ViewId } from "@/lib/tour/script";

const locale = "en" as const;
const t = createTranslator(locale);

export interface ViewFrame {
  view: ViewId;
  /** Text typed so far, by field. */
  typed: Record<string, string>;
  /** Progressive reveal count of the current view (undefined: everything). */
  reveal: number | undefined;
  /** The current scene id (some views highlight per scene). */
  sceneId: string;
  /** Scenes already passed (e.g. the candidate appears once the search is typed). */
  passed: (id: string) => boolean;
}

function DemoNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-dashed border-edge-strong bg-surface px-3 py-2 text-[12.5px] text-fg-muted">
      <Badge tone="caution">Demo</Badge>
      <span>{children}</span>
    </p>
  );
}

function FieldBox({ label, value, tour, multiline = false, typing = false }: { label: string; value: string; tour: string; multiline?: boolean; typing?: boolean }) {
  return (
    <div data-tour={tour}>
      <div className="mb-1 text-[12.5px] font-medium text-fg-muted">{label}</div>
      <div className={cx("rounded-lg border border-edge-strong bg-surface px-3 py-2 text-[14px] text-fg shadow-card", multiline ? "min-h-[64px]" : "min-h-10")}>
        {value}
        {typing && <span className="tour-caret ml-px inline-block h-4 w-[2px] translate-y-[3px] bg-brand" aria-hidden />}
      </div>
    </div>
  );
}

function Heading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-faint">{eyebrow}</div>
      <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Shell: the workspace navigation, with the active section of the scene.
// ---------------------------------------------------------------------------------------------------------

const NAV: { id: NavId; label: string; icon: IconName }[] = [
  { id: "work", label: t("nav.work"), icon: "work" },
  { id: "company", label: t("nav.yourCompany"), icon: "company" },
  { id: "discover", label: t("nav.findCompanies"), icon: "discover" },
  { id: "companies", label: t("nav.companies"), icon: "network" },
  { id: "opportunities", label: t("nav.opportunities"), icon: "opportunities" },
  { id: "agents", label: t("nav.agents"), icon: "agents" },
  { id: "signals", label: t("nav.signals"), icon: "intelligence" },
];

export function TourShell({ nav, children }: { nav: NavId; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="ORQO navigation (demo)" data-tour="nav" className="hidden w-[200px] shrink-0 flex-col gap-0.5 border-r border-edge bg-surface px-3 py-4 md:flex">
        <div className="mb-5 flex items-center gap-2 px-2">
          <span className="text-[15px] font-semibold tracking-[0.18em] text-fg">ORQO</span>
          <Badge tone="outline">Demo</Badge>
        </div>
        <div className="mb-2 rounded-lg bg-subtle px-2.5 py-2 text-[12.5px] text-fg-muted">
          Workspace · <span className="font-medium text-fg">INFODIP</span>
        </div>
        {NAV.map((n) => (
          <div
            key={n.id}
            data-tour={`nav-${n.id}`}
            aria-current={n.id === nav ? "page" : undefined}
            className={cx("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]", n.id === nav ? "bg-brand-soft font-medium text-brand" : "text-fg-muted")}
          >
            <Icon name={n.icon} size={16} />
            {n.label}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-1 overflow-x-auto border-b border-edge bg-surface px-3 py-2 md:hidden" aria-hidden>
          {NAV.map((n) => (
            <span key={n.id} data-tour={`nav-${n.id}-m`} className={cx("shrink-0 rounded-lg px-2.5 py-1 text-[12.5px]", n.id === nav ? "bg-brand-soft font-medium text-brand" : "text-fg-muted")}>
              {n.label}
            </span>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------

function Home({ f }: { f: ViewFrame }) {
  const ask = f.typed.ask ?? "";
  return (
    <div className="mx-auto max-w-[860px] space-y-5">
      <h1 data-tour="home-title" className="text-[28px] font-semibold tracking-tight text-fg">
        {t("work.title")}
      </h1>
      <div data-tour="home-ask" className="flex items-center gap-3 rounded-2xl border border-edge-strong bg-surface px-4 py-3.5 shadow-card">
        <Icon name="search" size={18} />
        <span className={cx("text-[15px]", ask ? "text-fg" : "text-fg-faint")}>{ask || "Ask ORQO about a company, a market or an objective…"}</span>
        {f.sceneId === "case" && <span className="tour-caret inline-block h-4 w-[2px] bg-brand" aria-hidden />}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["1", "Describe your company", "ORQO compares every company with it."],
          ["2", "Find and research companies", "Facts from official sources, structured."],
          ["3", "Track credible opportunities", "Only what survives the critic."],
        ].map(([n, title, body]) => (
          <Card key={n} className="px-4 py-4">
            <div className="text-[12px] font-semibold text-brand">Step {n}</div>
            <div className="mt-1 text-[14px] font-medium text-fg">{title}</div>
            <div className="mt-0.5 text-[13px] text-fg-muted">{body}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Profile({ f }: { f: ViewFrame }) {
  const typingField = ({ what: "summary", offer: "offerings", markets: "geographies" } as Record<string, string>)[f.sceneId];
  const typing = (field: string) => typingField === field;
  return (
    <div className="mx-auto max-w-[760px]">
      <Heading eyebrow={t("nav.yourCompany")} title={t("company.title")}>
        <p className="mt-1 text-[13.5px] text-fg-muted">{t("company.description")}</p>
      </Heading>
      <Card className="space-y-4 px-5 py-5" data-tour="profile-form">
        <FieldBox label={t("company.name")} value="INFODIP" tour="field-name" />
        <FieldBox label={t("company.summary")} value={f.typed.summary ?? ""} tour="field-summary" multiline typing={typing("summary")} />
        <FieldBox label={t("company.fields.offerings")} value={f.typed.offerings ?? ""} tour="field-offerings" multiline typing={typing("offerings")} />
        <FieldBox label={`${t("company.fields.customerSegments")} · ${t("company.fields.geographies")}`} value={f.typed.geographies ?? ""} tour="field-geographies" typing={typing("geographies")} />
      </Card>
      <div className="mt-3">
        <DemoNote>INFODIP&apos;s profile uses only the capabilities INFODIP describes publicly — no customer, price or contact.</DemoNote>
      </div>
    </div>
  );
}

function Dna({ data }: { data: TourData }) {
  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <Heading eyebrow={t("nav.yourCompany")} title="INFODIP — Business DNA" />
      <BusinessDnaCard dna={data.dossier.ownDna} locale={locale} organizationId="demo" canWrite={false} action={null} />
      <MarketModelCard market={data.own.market} locale={locale} />
    </div>
  );
}

function Discover({ f, data }: { f: ViewFrame; data: TourData }) {
  const p = data.target.research.profile;
  const claim = (field: string) => p.claims.find((c) => c.field === field)?.statement ?? "";
  const shown = f.passed("search");
  return (
    <div className="mx-auto max-w-[820px] space-y-4">
      <Heading eyebrow={t("nav.findCompanies")} title="Find companies" />
      <div data-tour="search" className="flex items-center gap-3 rounded-xl border border-edge-strong bg-surface px-4 py-3 shadow-card">
        <span className="text-[12.5px] font-medium text-fg-muted">{t("companies.searchLabel")}</span>
        <span className="flex-1 text-[15px] text-fg">{f.typed.search ?? ""}</span>
        <span className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white">{t("companies.searchSubmit")}</span>
      </div>
      {shown && (
        <Card data-tour="candidate" className={cx("tour-fade px-5 py-4", f.sceneId !== "search" && "ring-2 ring-brand/30")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold text-fg">{p.name}</span>
            <Badge tone="caution">Fictional company · demo</Badge>
            <span className="text-[12.5px] text-fg-muted">{p.domain}</span>
          </div>
          <ul data-tour="candidate-reasons" className="mt-3 space-y-1.5 text-[13.5px] text-fg">
            {[claim("product"), claim("geography"), claim("strategy")].map((s) => (
              <li key={s} className="flex gap-2">
                <Icon name="check" size={16} />
                <span>
                  {s} <span className="text-[11.5px] text-fg-faint">— fact, official site</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const RESEARCH_STAGES = ["resolving", "sources", "reading", "structuring", "comparing", "evaluating"] as const;

function Research({ f, data }: { f: ViewFrame; data: TourData }) {
  const done = f.reveal ?? RESEARCH_STAGES.length;
  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <Heading eyebrow={t("nav.companies")} title={`Analyzing ${data.target.research.profile.domain}`}>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="brand">{t("analysis.modeBasic")}</Badge>
          <Badge tone="caution">Prepared demo evidence</Badge>
        </div>
      </Heading>
      <Card data-tour="research-stages" className="px-5 py-4">
        <ol className="space-y-2.5">
          {RESEARCH_STAGES.map((s, i) => (
            <li key={s} className={cx("flex items-center gap-3 text-[14px] transition-opacity duration-300", i < done ? "text-fg" : i === done ? "text-fg-muted" : "text-fg-faint opacity-60")}>
              <span className={cx("grid h-6 w-6 place-items-center rounded-full border text-[11px]", i < done ? "border-positive bg-positive-soft text-positive" : "border-edge-strong")}>{i < done ? "✓" : i + 1}</span>
              {t(`research.stages.${s}` as MessageKey, { own: "INFODIP" })}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Understanding({ data }: { data: TourData }) {
  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <Heading eyebrow={t("nav.companies")} title={data.target.research.profile.name}>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="caution">Fictional company · demo</Badge>
          <Badge tone="neutral">Prepared, reproducible research</Badge>
        </div>
      </Heading>
      <UnderstandingCard profile={data.target.research.profile} locale={locale} />
      <EvidenceCard profile={data.target.research.profile} locale={locale} deep={false} />
    </div>
  );
}

function Compare({ f, data }: { f: ViewFrame; data: TourData }) {
  return (
    <div className="mx-auto max-w-[980px] space-y-3">
      <Heading eyebrow={t("nav.companies")} title={`INFODIP and ${data.dossier.targetName}`} />
      <CompanyComparison dossier={data.dossier} locale={locale} reveal={f.reveal} highlight={f.sceneId === "complement" ? "complement" : null} />
    </div>
  );
}

const DIM_ORDER = ["evidence", "strategicFit", "marketCompatibility", "timing", "feasibility", "risk"] as const;

function Assessment({ f, data }: { f: ViewFrame; data: TourData }) {
  const s = data.lead;
  const shown = f.reveal ?? DIM_ORDER.length;
  const shared = [...s.shared.industries, ...s.shared.technologies].map((k) => conceptLabel(k, locale));
  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <Heading eyebrow={t("nav.companies")} title={`Compatibility — ${scenarioTitle(t, data.dossier, s)}`} />
      <div data-tour="dimensions" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DIM_ORDER.map((k, i) => (
          <Card key={k} data-tour={`dim-${k}`} className={cx("px-4 py-3.5 transition-all duration-500", i < shown ? "opacity-100" : "opacity-0")}>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-faint">{{ evidence: "Evidence", strategicFit: "Strategic fit", marketCompatibility: "Market fit", timing: "Timing", feasibility: "Effort", risk: "Risk" }[k]}</div>
            <div className="mt-1 text-[15px] font-medium text-fg">{t(`dossier.dimensions.${k}.${s.dimensions[k]}` as MessageKey)}</div>
            {k === "timing" && s.whyNow[0] && <p className="mt-1.5 text-[12.5px] leading-snug text-fg-muted">“{s.whyNow[0].statement}”</p>}
            {k === "strategicFit" && shared.length > 0 && <p className="mt-1.5 text-[12.5px] text-fg-muted">Shared ground: {shared.join(", ")}</p>}
          </Card>
        ))}
      </div>
      <Card data-tour="no-score" className="px-5 py-4 text-[13.5px] leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">How ORQO judges compatibility.</span> Each dimension is derived from the evidence by documented rules (Business DNA, market model, partnership mechanisms and a critic). ORQO shows these reasons instead of a single score, so every judgement can be checked and challenged.
      </Card>
    </div>
  );
}

function DossierPage({ data }: { data: TourData }) {
  return (
    <div className="mx-auto max-w-[900px] space-y-3">
      <Heading eyebrow={t("nav.companies")} title={data.dossier.targetName} />
      <DossierView dossier={data.dossier} locale={locale} reportHref={null} actions={null} />
    </div>
  );
}

function Agents({ f, data }: { f: ViewFrame; data: TourData }) {
  const d = data.dossier;
  const p = data.target.research.profile;
  const steps: { name: string; does: string; produced: string; kind: string }[] = [
    { name: "Research Agent", does: "Reads the official website and organizes facts, inferences and unknowns.", produced: `${p.claims.length} findings from ${p.sources.length} official page`, kind: "Agent · runs in your workspace" },
    { name: "Business understanding", does: "Turns the findings into Business DNA and a market model.", produced: `${d.targetDna.items.length} DNA items for ${d.targetName}`, kind: "Engine · deterministic" },
    { name: "Partnership mechanisms", does: "Generates the ways the two companies could work together.", produced: `${d.scenarios.length + d.novel.length + d.considered.length} ideas examined`, kind: "Engine · deterministic" },
    { name: "Critic", does: "Tries to reject every idea; only what survives is recommended.", produced: `${d.considered.length} rejected · ${d.scenarios.length + d.novel.length} credible`, kind: "Engine · deterministic" },
    { name: "Partnership Agent", does: "Explains the opportunity with its cited evidence and what to validate next.", produced: `${d.questions.length} questions to validate`, kind: "Agent · runs in your workspace" },
    { name: "Opportunity qualification", does: "Keeps the credible opportunity as a tracked, evidence-backed record.", produced: `Tracked as “${t(`opportunities.status.${data.tracked.status}` as MessageKey)}”`, kind: "Product · your opportunities" },
  ];
  const done = f.reveal ?? steps.length;
  return (
    <div className="mx-auto max-w-[860px] space-y-3">
      <Heading eyebrow={t("nav.agents")} title="The business-development workflow" />
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={s.name} data-tour={`agent-${i}`}>
            <Card className={cx("flex items-start gap-3 px-4 py-3 transition-all duration-500", i < done ? "opacity-100" : i === done ? "opacity-70" : "opacity-35")}>
              <span className={cx("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold", i < done ? "bg-positive-soft text-positive" : i === done ? "bg-brand-soft text-brand" : "bg-subtle text-fg-faint")}>{i < done ? "✓" : i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-fg">{s.name}</span>
                  <span className="text-[11.5px] text-fg-faint">{s.kind}</span>
                </div>
                <p className="text-[13px] text-fg-muted">{s.does}</p>
                {i < done && <p className="mt-1 text-[12.5px] font-medium text-fg">→ {s.produced}</p>}
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <DemoNote>In this demo the steps replay prepared results. In your workspace the agents run on your data under your plan; paid AI is off unless you enable it.</DemoNote>
    </div>
  );
}

function Critic({ data }: { data: TourData }) {
  const d = data.dossier;
  const s = data.lead;
  const names = (provider: "own" | "target") => (provider === "own" ? { provider: d.ownName, partner: d.targetName } : { provider: d.targetName, partner: d.ownName });
  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <Heading eyebrow={t("nav.companies")} title="Critical evaluation" />
      <Card data-tour="critic-rejected">
        <CardHeader title="Ideas the critic rejected" description="Considered, not recommended — with the reasons." />
        <ul className="divide-y divide-edge px-5 pb-3">
          {d.considered.map((c) => (
            <li key={c.key} className="py-2.5">
              <div className="text-[14px] font-medium text-fg">{t(`dossier.mechanisms.${c.mechanism}.title` as MessageKey, names(c.provider))}</div>
              <ul className="mt-1 space-y-0.5 text-[13px] text-fg-muted">
                {c.critic
                  .filter((x) => x.severity !== "minor")
                  .slice(0, 3)
                  .map((x) => (
                    <li key={x.code}>✕ {t(`dossier.critic.${x.code}` as MessageKey, { name: x.side === "own" ? d.ownName : d.targetName })}</li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>
      <Card data-tour="critic-questions">
        <CardHeader title={t("dossier.toValidate")} />
        <ul className="list-disc space-y-1 px-5 pb-4 pl-10 text-[13.5px] text-fg">
          {d.questions.map((q) => (
            <li key={q.key}>{questionText(t, d, q)}</li>
          ))}
        </ul>
      </Card>
      <Card data-tour="critic-lead" className="border-positive/40 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="positive">{t(`dossier.labels.${s.verdict}` as MessageKey)}</Badge>
          <span className="text-[14.5px] font-medium text-fg">{scenarioTitle(t, d, s)}</span>
        </div>
        <p className="mt-2 text-[13.5px] text-fg-muted">
          {[t(`dossier.dimensions.evidence.${s.dimensions.evidence}` as MessageKey), s.needShown ? "need shown in its own evidence" : null, t(`dossier.dimensions.timing.${s.dimensions.timing}` as MessageKey), t(`dossier.dimensions.risk.${s.dimensions.risk}` as MessageKey)].filter(Boolean).join(" · ")}
        </p>
      </Card>
    </div>
  );
}

function MapPage({ f, data }: { f: ViewFrame; data: TourData }) {
  return (
    <div className="mx-auto max-w-[1100px]">
      <Heading eyebrow={t("nav.opportunities")} title="Opportunity graph" />
      <OpportunityMapView dossier={data.dossier} locale={locale} reveal={f.reveal} />
    </div>
  );
}

function Proposal({ f, data }: { f: ViewFrame; data: TourData }) {
  const shown = f.reveal ?? 7;
  return (
    <div className="mx-auto max-w-[860px]">
      <Heading eyebrow={t("nav.opportunities")} title={scenarioTitle(t, data.dossier, data.lead)}>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="brand">{t(`opportunities.status.${data.tracked.status}` as MessageKey)}</Badge>
          <Badge tone="neutral">Partnership proposal</Badge>
        </div>
      </Heading>
      <Card className="tour-proposal px-5 py-5" data-tour="proposal">
        {/* Progressive construction: sections after `shown` stay hidden. */}
        <style>{`.tour-proposal section:nth-of-type(n+${shown + 1}) { opacity: 0; } .tour-proposal section { transition: opacity .6s; }`}</style>
        <TrackedOpportunityView o={data.tracked} scenario={data.tracked.snapshot.scenario} locale={locale} />
      </Card>
    </div>
  );
}

function Plan({ f, data }: { f: ViewFrame; data: TourData }) {
  const d = data.dossier;
  const s = data.lead;
  const n = s.provider === "own" ? { provider: d.ownName, partner: d.targetName } : { provider: d.targetName, partner: d.ownName };
  const m = (k: string) => t(`dossier.mechanisms.${s.mechanism}.${k}` as MessageKey, n);
  const shown = f.reveal ?? 4;
  const block = (i: number) => cx("transition-opacity duration-500", i < shown ? "opacity-100" : "opacity-0");
  return (
    <div className="mx-auto max-w-[900px] space-y-3">
      <Heading eyebrow={t("nav.opportunities")} title="Action plan" />
      <Card data-tour="plan-questions" className={block(0)}>
        <CardHeader title="Qualification questions — and who should answer" />
        <ul className="divide-y divide-edge px-5 pb-3 text-[13.5px]">
          {d.questions.map((q) => (
            <li key={q.key} className="py-2">
              <div className="text-fg">{questionText(t, d, q)}</div>
              <div className="text-[12.5px] text-fg-muted">Suggested: {QUESTION_ROLES[q.key] ?? `${q.about === "target" ? d.targetName : d.ownName}'s decision maker on this topic`}</div>
            </li>
          ))}
        </ul>
      </Card>
      <Card data-tour="plan-intro" className={block(1)}>
        <CardHeader title="Introduction strategy" />
        <p className="px-5 pb-4 text-[13.5px] leading-relaxed text-fg">
          Open with {d.targetName}&apos;s own announcement{s.whyNow[0] ? ` (“${s.whyNow[0].statement}”)` : ""}. Problem it solves: {m("problem").toLowerCase()} Proposed model: {m("joint")}
        </p>
      </Card>
      <Card data-tour="plan-meeting" className={block(2)}>
        <CardHeader title="Meeting preparation & technical validation" />
        <ul className="list-disc space-y-1 px-5 pb-4 pl-10 text-[13.5px] text-fg">
          <li>
            {t("dossier.brings", { name: n.provider })}: {m("provider").toLowerCase()} — {d.ownName}&apos;s integration, testing and EMEA deployment.
          </li>
          <li>Validate: {d.questions.map((q) => questionText(t, d, q)).join(" ")}</li>
          <li>Next investigation: {investigationText(t, d, d.next)}</li>
        </ul>
      </Card>
      <Card data-tour="plan-milestones" className={block(3)}>
        <CardHeader title="Milestones" />
        <ol className="space-y-1.5 px-5 pb-4 text-[13.5px] text-fg">
          <li>1 · Introduction call with {d.targetName}</li>
          <li>2 · Answer the qualification questions</li>
          <li>3 · Lowest-cost test: {m("experiment")}</li>
          <li>4 · Agree a {t(`dossier.structures.${s.revenue.structure}` as MessageKey)}</li>
        </ol>
      </Card>
      <DemoNote>Nothing is sent from the demo: no message, no email, no meeting invitation.</DemoNote>
    </div>
  );
}

function Monitoring({ f, data }: { f: ViewFrame; data: TourData }) {
  const shown = f.reveal ?? 4;
  return (
    <div className="mx-auto max-w-[860px] space-y-3">
      <Heading eyebrow={t("nav.signals")} title="Opportunity monitoring" />
      <Card data-tour="monitor-today" className="px-5 py-4 text-[13.5px] leading-relaxed">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="positive">Available today</Badge>
          <span className="font-medium text-fg">Re-analysis signals</span>
        </div>
        <p className="mt-1.5 text-fg-muted">When {data.dossier.targetName} is analyzed again, ORQO compares the new evidence with the previous analysis, records what changed as signals, and shows what it means for the opportunity.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="outline">Planned</Badge>
          <span className="text-fg-muted">Continuous automatic monitoring of every tracked company.</span>
        </div>
      </Card>
      <Card data-tour="monitor-timeline">
        <CardHeader title="What could change the picture" description="Illustrative events — this timeline is not real data." />
        <ol className="space-y-2.5 px-5 pb-4">
          {MONITORING_EVENTS.map((e, i) => (
            <li key={e.event} className={cx("flex gap-3 transition-opacity duration-500", i + 1 < shown ? "opacity-100" : "opacity-0")}>
              <span className="w-[72px] shrink-0 text-[12.5px] font-medium text-fg-faint">{e.when}</span>
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-fg">
                  {e.event} <Badge tone="caution">Illustrative</Badge>
                </div>
                <div className="text-[12.5px] text-fg-muted">{e.effect}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Summary({ data, onReplay }: { data: TourData; onReplay: () => void }) {
  const d = data.dossier;
  const s = data.lead;
  return (
    <div className="mx-auto max-w-[860px] space-y-4">
      <Card data-tour="summary" className="px-6 py-5">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-faint">Executive summary</div>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-fg">{scenarioTitle(t, d, s)}</h1>
        <dl className="mt-4 grid gap-3 text-[13.5px] sm:grid-cols-2">
          <div>
            <dt className="text-fg-faint">Companies</dt>
            <dd className="text-fg">
              {d.ownName} (France, OEM/ODM integration) · {d.targetName} (USA, edge AI — fictional)
            </dd>
          </div>
          <div>
            <dt className="text-fg-faint">Compatibility</dt>
            <dd className="text-fg">
              {t(`dossier.dimensions.strategicFit.${s.dimensions.strategicFit}` as MessageKey)} · {t(`dossier.dimensions.evidence.${s.dimensions.evidence}` as MessageKey)} · {t(`dossier.dimensions.timing.${s.dimensions.timing}` as MessageKey)}
            </dd>
          </div>
          <div>
            <dt className="text-fg-faint">Partnership hypothesis</dt>
            <dd className="text-fg">{t(`dossier.mechanisms.${s.mechanism}.joint` as MessageKey, { provider: d.ownName, partner: d.targetName })}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Supporting evidence</dt>
            <dd className="text-fg">{s.whyNow[0]?.statement ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Still uncertain</dt>
            <dd className="text-fg">{d.questions[0] ? questionText(t, d, d.questions[0]) : "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Recommended next step</dt>
            <dd className="text-fg">{investigationText(t, d, d.next)}</dd>
          </div>
        </dl>
      </Card>
      <div data-tour="cta" className="rounded-2xl bg-surface px-6 py-6 text-center shadow-card">
        <p className="text-[19px] font-semibold tracking-tight text-fg">ORQO turns company intelligence into actionable business opportunities.</p>
        <p className="mt-1 text-[14px] text-fg-muted">Discover what ORQO could find for your business.</p>
        {/* The only interactive elements of the stage: optional, never needed to finish the tour. */}
        <div className="pointer-events-auto mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onReplay} className="inline-flex h-10 items-center rounded-lg border border-edge-strong bg-surface px-4 text-[14px] font-medium text-fg shadow-card hover:bg-subtle" data-testid="tour-replay-final">
            Replay the demo
          </button>
          <ButtonLink href="/signup" variant="primary" data-testid="tour-signup">
            Create an account
          </ButtonLink>
          <ButtonLink href="/" data-testid="tour-explore">
            Explore ORQO
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

export function TourView({ f, data, onReplay }: { f: ViewFrame; data: TourData; onReplay: () => void }) {
  switch (f.view) {
    case "home":
      return <Home f={f} />;
    case "profile":
      return <Profile f={f} />;
    case "dna":
      return <Dna data={data} />;
    case "discover":
      return <Discover f={f} data={data} />;
    case "research":
      return <Research f={f} data={data} />;
    case "understanding":
      return <Understanding data={data} />;
    case "compare":
      return <Compare f={f} data={data} />;
    case "assessment":
      return <Assessment f={f} data={data} />;
    case "dossier":
      return <DossierPage data={data} />;
    case "agents":
      return <Agents f={f} data={data} />;
    case "critic":
      return <Critic data={data} />;
    case "map":
      return <MapPage f={f} data={data} />;
    case "proposal":
      return <Proposal f={f} data={data} />;
    case "plan":
      return <Plan f={f} data={data} />;
    case "monitoring":
      return <Monitoring f={f} data={data} />;
    case "summary":
      return <Summary data={data} onReplay={onReplay} />;
  }
}
