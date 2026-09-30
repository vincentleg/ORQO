"use client";

import { demoHref } from "@/lib/demo-path";
import { tagLabel } from "@/lib/domain/taxonomy";
import type { World } from "@/lib/domain/types";
import { Arrow, ButtonLink, CheckIcon, CompanyMark, Eyebrow, Panel, cx } from "./ui";

export function ProposalTeaser({ world, proposalId }: { world: World; proposalId: string }) {
  const p = world.proposals[proposalId];
  const base = world.opportunities[p.baseOpportunityIds[0]];
  const candidate = world.companies[p.candidateCompanyId];
  return (
    <Panel className="overflow-hidden border-accent/25">
      <div className="px-7 py-6">
        <Eyebrow className="!text-accent">Multi-company discovery</Eyebrow>
        <h2 className="mt-2 text-[21px] font-semibold tracking-tight">Another company in your network could strengthen this opportunity.</h2>
        <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-muted">
          {base?.title} is missing <span className="text-ink">{p.missing.map(tagLabel).join(", ")}</span>. ORQO searched your network:
        </p>
        <ul className="mt-4 space-y-2">
          {p.scanned.map((s) => (
            <li key={s.companyId} className={cx("flex items-center gap-3 rounded-lg border px-4 py-2.5", s.provides ? "border-match/30 bg-match/[0.04]" : "border-line opacity-60")}>
              <CompanyMark company={world.companies[s.companyId]} size={22} />
              <span className="w-32 text-[13px] text-ink">{world.companies[s.companyId].name}</span>
              <span className="flex-1 text-[12.5px] text-muted">{s.note}</span>
              <CheckIcon result={s.provides ? "pass" : "fail"} />
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center gap-3">
          <ButtonLink href={demoHref(`/network?proposal=${p.id}`)} variant="primary">
            {p.status === "created" ? "View in Opportunity Graph" : `Bring ${candidate.name} into the graph`} <Arrow />
          </ButtonLink>
          <span className="text-[12px] text-faint">{p.opportunity.companyIds.map((c) => world.companies[c].name).join(" + ")}</span>
        </div>
      </div>
    </Panel>
  );
}
