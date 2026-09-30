"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import type { ReactNode } from "react";
import { ConsentPanel } from "@/components/consent";
import { Lifecycle, OutcomeControls } from "@/components/lifecycle";
import {
  Arrow,
  CheckIcon,
  Chip,
  CompanyMark,
  ConfidenceMeter,
  EpistemicTag,
  Eyebrow,
  LockIcon,
  Panel,
  VerdictBadge,
  VisibilityTag,
  cx,
  formatDate,
} from "@/components/ui";
import type { Opportunity, OpportunityEvidence, World } from "@/lib/domain/types";
import { stageFor } from "@/lib/engine/orchestration";
import { useOrqo } from "@/lib/store";

const ROLE_LABEL: Record<string, string> = {
  "software-vendor": "Software",
  "hardware-partner": "Hardware & deployment",
  vendor: "Vendor",
  distributor: "Distribution",
  seller: "Seller",
  buyer: "Buyer",
  partner: "Partner",
};

export default function OpportunityPage() {
  const { id } = useParams<{ id: string }>();
  const world = useOrqo((s) => s.world);
  const opp = world.opportunities[id];
  if (!opp) notFound();
  const stage = stageFor(world, opp, world.viewerId);
  const triggerLabel =
    opp.trigger.kind === "connection" ? "Agents connected" : opp.trigger.kind === "signal" ? "Re-evaluated after a signal" : "Multi-company discovery";

  return (
    <div className="mx-auto max-w-[1280px] px-8 py-8">
      <Link href="/opportunities" className="inline-flex items-center gap-1.5 text-[12.5px] text-faint hover:text-muted">
        <Arrow className="rotate-180" /> Opportunities
      </Link>

      <header className="mt-5">
        <div className="flex items-center gap-2">
          {opp.companyIds.map((cid, i) => (
            <span key={cid} className="flex items-center gap-2">
              {i > 0 && <span className="text-faint">+</span>}
              <CompanyMark company={world.companies[cid]} size={24} />
              <span className="text-[13px] text-muted">{world.companies[cid].name}</span>
            </span>
          ))}
        </div>
        <h1 className="mt-4 max-w-3xl text-[32px] font-semibold leading-tight tracking-tight text-balance">{opp.title}</h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted">{opp.summary}</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {opp.types.map((t) => (
            <Chip key={t}>{t.replace("-", " ")}</Chip>
          ))}
          <span className="mx-2 h-4 w-px bg-line" />
          <ConfidenceMeter level={opp.confidence.level} />
          <span className="mx-2 h-4 w-px bg-line" />
          <VerdictBadge verdict={opp.critic.verdict} />
          <span className="ml-auto font-mono text-[10.5px] uppercase tracking-wider text-faint">
            {triggerLabel} · {formatDate(opp.discoveredAt)} · {opp.engine === "deterministic" ? "ORQO engine" : opp.engine}
          </span>
        </div>
      </header>

      <div className="mt-7">
        <Lifecycle stage={stage} />
      </div>

      {opp.delta && <DeltaPanel opp={opp} />}

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)_340px] gap-6">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Block title="Why this opportunity exists">{opp.whyExists}</Block>
            <Block title="Why now" accent>
              {opp.whyNow}
            </Block>
          </div>

          <Panel data-demo="contributions">
            <SectionTitle>What each company brings</SectionTitle>
            <div className={cx("grid gap-px bg-line", opp.contributions.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
              {opp.contributions.map((c) => {
                const company = world.companies[c.companyId];
                return (
                  <div key={c.companyId} className="bg-panel p-5">
                    <div className="flex items-center gap-2.5">
                      <CompanyMark company={company} size={24} />
                      <div>
                        <div className="text-[13.5px] font-medium">{company.name}</div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{ROLE_LABEL[c.role]}</div>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-2">
                      {c.items.map((it) => (
                        <li key={it} className="flex items-center gap-2.5 text-[13px] text-muted">
                          <span className="h-1 w-1 rounded-full" style={{ background: company.accent }} />
                          {it}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel className="p-5">
            <Eyebrow>Proposed business structure</Eyebrow>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink">{opp.structure}</p>
          </Panel>

          <EvidencePanel world={world} opp={opp} />

          <div className="grid grid-cols-2 gap-4">
            <ListPanel title="Assumptions" items={opp.assumptions} tag={<EpistemicTag kind="assumption" />} />
            <ListPanel title="Unknown information" items={opp.unknowns} marker="?" />
            <ListPanel title="Questions to answer" items={opp.questions} numbered />
            <ListPanel title="Risks & blockers" items={opp.risks} tone="reject" demo="risks" />
          </div>

          <CriticPanel opp={opp} />
        </div>

        <aside className="space-y-4">
          <div className="sticky top-20 space-y-4">
            <ConsentPanel world={world} opp={opp} />
            <Panel className="p-5">
              <Eyebrow>Recommended next step</Eyebrow>
              <p className="mt-2 text-[14px] text-ink">{opp.nextStep}</p>
            </Panel>
            <OutcomeControls world={world} opp={opp} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function DeltaPanel({ opp }: { opp: Opportunity }) {
  const d = opp.delta!;
  const title =
    opp.kind === "multi"
      ? "Another company in your network could strengthen this opportunity."
      : opp.trigger.kind === "signal"
        ? "A new signal changed this relationship."
        : "Updated after a new signal.";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 overflow-hidden rounded-xl border border-signal/25 bg-signal/[0.04]">
      <div className="flex items-center gap-2.5 border-b border-signal/15 px-5 py-3">
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
        <span className="text-[13.5px] font-medium text-signal">{title}</span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-signal/10">
        {[
          ["What changed", d.whatChanged],
          ["Why it matters now", d.whyNowRelevant],
          ["Why not before", d.whyNotBefore],
        ].map(([k, v]) => (
          <div key={k} className="px-5 py-4">
            <Eyebrow>{k}</Eyebrow>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{v}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function Block({ title, children, accent }: { title: string; children: ReactNode; accent?: boolean }) {
  return (
    <Panel className={cx("p-5", accent && "border-accent/20")}>
      <Eyebrow className={accent ? "!text-accent" : undefined}>{title}</Eyebrow>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink/90">{children}</p>
    </Panel>
  );
}

function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
      <Eyebrow>{children}</Eyebrow>
      {right}
    </div>
  );
}

function ListPanel({
  title,
  items,
  tag,
  marker,
  numbered,
  tone,
  demo,
}: {
  title: string;
  items: string[];
  tag?: ReactNode;
  marker?: string;
  numbered?: boolean;
  tone?: "reject";
  demo?: string;
}) {
  return (
    <Panel data-demo={demo}>
      <SectionTitle right={tag}>{title}</SectionTitle>
      <ul className="space-y-2.5 px-5 py-4">
        {items.map((it, i) => (
          <li key={it} className="flex gap-3 text-[13px] leading-snug text-muted">
            <span className={cx("mt-px w-4 shrink-0 font-mono text-[11px]", tone === "reject" ? "text-reject" : "text-faint")}>{numbered ? i + 1 : marker ?? "—"}</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EvidenceRow({ world, e }: { world: World; e: OpportunityEvidence }) {
  const src = world.sources[e.sourceId];
  const owner = world.companies[e.companyId];
  const viewerCompany = world.people[world.viewerId].companyId;
  const restricted = e.visibility === "agent-only" || e.visibility === "private";
  const canSeePrivate = viewerCompany === e.companyId;
  return (
    <li className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 px-5 py-3">
      <div className="pt-0.5">
        <EpistemicTag kind={e.epistemic} />
      </div>
      <div>
        <p className="text-[13px] leading-snug text-ink/90">{e.claim}</p>
        {restricted && (
          <div className="mt-1.5 flex items-start gap-2 rounded-md border border-signal/15 bg-signal/[0.03] px-2.5 py-1.5 text-[12px]">
            <span className="mt-0.5 text-signal">
              <LockIcon />
            </span>
            {canSeePrivate ? (
              <span className="text-muted">
                <span className="text-signal">Only {owner.name} sees this: </span>
                {e.privateDetail}
              </span>
            ) : (
              <span className="text-muted">Detail withheld by {owner.name}&apos;s agent. Shared only as the sentence above.</span>
            )}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
          <CompanyMark company={owner} size={14} />
          <span>{src?.label ?? e.sourceId}</span>
          {src?.simulated && <Chip tone="quiet">Simulated source</Chip>}
          <VisibilityTag v={e.visibility} />
        </div>
      </div>
    </li>
  );
}

function EvidencePanel({ world, opp }: { world: World; opp: Opportunity }) {
  const facts = opp.evidence.filter((e) => e.epistemic === "fact");
  const inferences = opp.evidence.filter((e) => e.epistemic === "inference");
  return (
    <Panel data-demo="evidence">
      <SectionTitle
        right={
          <span className="font-mono text-[10.5px] text-faint">
            {facts.length} facts · {inferences.length} inferences · {opp.assumptions.length} assumptions
          </span>
        }
      >
        Supporting evidence
      </SectionTitle>
      <ul className="divide-y divide-line">
        {[...facts, ...inferences].map((e) => (
          <EvidenceRow key={e.id} world={world} e={e} />
        ))}
      </ul>
      <div className="border-t border-line px-5 py-3 text-[12px] text-faint">{opp.confidence.rationale}</div>
    </Panel>
  );
}

function CriticPanel({ opp }: { opp: Opportunity }) {
  return (
    <Panel>
      <SectionTitle right={<VerdictBadge verdict={opp.critic.verdict} />}>Critic review</SectionTitle>
      <div className="px-5 pt-4 text-[13px] text-muted">
        The critic tries to reject every opportunity. <span className="text-ink">{opp.critic.summary}</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4">
        {opp.critic.checks.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <span className="mt-0.5">
              <CheckIcon result={c.result} />
            </span>
            <div>
              <div className="text-[12.5px] text-ink">{c.question}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-faint">{c.note}</div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
