"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { GraphLegend, OpportunityGraph, type Selection } from "@/components/graph";
import { relationshipState } from "@/components/network-bits";
import { Arrow, Avatar, Button, ButtonLink, Chip, CompanyMark, ConfidenceMeter, Eyebrow, Panel, StageBadge, VisibilityTag } from "@/components/ui";
import { tagLabel } from "@/lib/domain/taxonomy";
import type { NetworkProposal, World } from "@/lib/domain/types";
import { stageFor } from "@/lib/engine/orchestration";
import { useOrqo } from "@/lib/store";
import { useServiceStatus } from "@/lib/use-status";

export default function NetworkPage() {
  return (
    <Suspense>
      <Network />
    </Suspense>
  );
}

function Network() {
  const world = useOrqo((s) => s.world);
  const params = useSearchParams();
  const proposalParam = params.get("proposal");
  const proposal = Object.values(world.proposals).find((p) => (proposalParam ? p.id === proposalParam : p.status === "proposed"));
  const [selected, setSelected] = useState<Selection | undefined>(proposal ? { kind: "proposal", id: proposal.id } : undefined);
  const multi = Object.values(world.opportunities).find((o) => o.kind === "multi");
  // A created proposal is drawn as its opportunity node, so select that node in the graph.
  const graphSelected: Selection | undefined =
    selected?.kind === "proposal" && proposal?.status === "created" ? { kind: "opportunity", id: proposal.opportunity.id } : selected;

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col px-8 py-6">
      <div className="flex items-end justify-between">
        <div>
          <Eyebrow>Opportunity graph · LinkedIn maps who you know</Eyebrow>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight">ORQO discovers what you can build together.</h1>
        </div>
        <GraphSync world={world} />
      </div>
      <div className="mt-5 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] gap-5">
        <Panel className="bg-grid relative flex min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 p-2">
            <OpportunityGraph
              world={world}
              selected={graphSelected}
              onSelect={setSelected}
              proposal={proposal?.status === "proposed" ? proposal : undefined}
              highlight={proposal?.status === "proposed" ? [proposal.candidateCompanyId] : multi ? multi.companyIds : []}
            />
          </div>
          <div className="border-t border-line px-5 py-3">
            <GraphLegend />
          </div>
        </Panel>
        <div className="min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={selected ? `${selected.kind}:${selected.id}` : "none"} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <SidePanel world={world} selected={selected} onSelect={setSelected} proposal={proposal} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function GraphSync({ world }: { world: World }) {
  const status = useServiceStatus();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function sync() {
    setBusy(true);
    try {
      const res = await fetch("/api/graph", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ world }) });
      const body = (await res.json()) as { backend?: string; nodes?: number; edges?: number; error?: string };
      setMsg(res.ok ? `Synced ${body.nodes} nodes · ${body.edges} edges to ${body.backend === "neo4j" ? "Neo4j" : "in-memory graph"}` : `Sync failed: ${body.error}`);
    } catch {
      setMsg("Sync failed: server unreachable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      <span className="whitespace-nowrap font-mono text-[10.5px] uppercase tracking-wider text-faint">
        {msg ?? (status ? (status.graph.backend === "neo4j" ? "Graph store · Neo4j" : "Graph store · in-memory · Neo4j not configured") : "")}
      </span>
      <Button size="sm" variant="ghost" onClick={sync} disabled={busy}>
        {busy ? "Syncing…" : "Sync graph"}
      </Button>
    </div>
  );
}

function SidePanel({ world, selected, onSelect, proposal }: { world: World; selected?: Selection; onSelect: (s: Selection | undefined) => void; proposal?: NetworkProposal }) {
  if (selected?.kind === "proposal" && proposal) return <ProposalPanel world={world} proposal={proposal} onSelect={onSelect} />;
  if (selected?.kind === "company") return <CompanyPanel world={world} id={selected.id} />;
  if (selected?.kind === "opportunity") return <OpportunityPanel world={world} id={selected.id} />;

  const opps = Object.values(world.opportunities);
  return (
    <div className="space-y-4">
      {proposal?.status === "proposed" && (
        <button onClick={() => onSelect({ kind: "proposal", id: proposal.id })} className="w-full text-left">
          <Panel className="border-signal/30 p-5 transition-colors hover:bg-panel-2">
            <Eyebrow className="!text-signal">Proposal waiting</Eyebrow>
            <p className="mt-2 text-[13.5px] text-ink">Another company in your network could strengthen this opportunity.</p>
          </Panel>
        </button>
      )}
      <Panel className="p-5">
        <Eyebrow>How to read this graph</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Circles are companies in {world.people[world.viewerId].name.split(" ")[0]}&apos;s network. Lines are relationships between people. Diamonds are opportunities the agents found and the critic let through. Click any node.
        </p>
      </Panel>
      <Panel className="divide-y divide-line">
        {opps.length === 0 && <div className="px-5 py-4 text-[13px] text-muted">No opportunities yet.</div>}
        {opps.map((o) => (
          <button key={o.id} onClick={() => onSelect({ kind: "opportunity", id: o.id })} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.02]">
            <span className="h-2 w-2 rotate-45 bg-accent" />
            <span className="flex-1 text-[13px] text-ink">{o.title}</span>
            <StageBadge stage={stageFor(world, o, world.viewerId)} />
          </button>
        ))}
      </Panel>
    </div>
  );
}

function ProposalPanel({ world, proposal, onSelect }: { world: World; proposal: NetworkProposal; onSelect: (s: Selection | undefined) => void }) {
  const createProposal = useOrqo((s) => s.createProposal);
  const router = useRouter();
  const o = proposal.opportunity;
  const candidate = world.companies[proposal.candidateCompanyId];
  const created = proposal.status === "created";

  return (
    <Panel className={created ? "border-match/30" : "border-signal/30"}>
      <div className="border-b border-line px-5 py-4">
        <Eyebrow className={created ? "!text-match" : "!text-signal"}>{created ? "3-way opportunity created" : "Multi-company discovery"}</Eyebrow>
        <h2 className="mt-2 text-[16px] font-medium leading-snug">{created ? o.title : "Another company in your network could strengthen this opportunity."}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{o.whyExists}</p>
      </div>
      <div className="space-y-3 px-5 py-4">
        {o.contributions.map((c) => {
          const company = world.companies[c.companyId];
          const isNew = c.companyId === candidate.id;
          return (
            <div key={c.companyId} className="rounded-lg border border-line px-3.5 py-3" style={isNew ? { borderColor: `${company.accent}55` } : undefined}>
              <div className="flex items-center gap-2">
                <CompanyMark company={company} size={20} />
                <span className="text-[13px] font-medium">{company.name}</span>
                {isNew && <Chip tone="signal">Joins</Chip>}
              </div>
              <div className="mt-2 text-[12px] leading-relaxed text-muted">{c.items.slice(0, 4).join(" · ")}</div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line px-5 py-4">
        <Eyebrow>Proposed structure</Eyebrow>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{o.structure}</p>
        <div className="mt-3 flex items-center justify-between">
          <ConfidenceMeter level={o.confidence.level} />
          <span className="font-mono text-[10.5px] uppercase text-faint">Critic · {o.critic.verdict}</span>
        </div>
      </div>
      <div className="border-t border-line px-5 py-4">
        {created ? (
          <ButtonLink href={`/opportunities/${o.id}`} variant="match" className="w-full">
            Open 3-way opportunity <Arrow />
          </ButtonLink>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="w-full font-mono tracking-wider"
            onClick={() => {
              const id = createProposal(proposal.id);
              if (id) onSelect({ kind: "proposal", id: proposal.id });
              router.replace(`/network?proposal=${proposal.id}`);
            }}
          >
            CREATE 3-WAY OPPORTUNITY
          </Button>
        )}
        <p className="mt-2 text-[11.5px] text-faint">
          Missing: {proposal.missing.map(tagLabel).join(", ")} · scanned {proposal.scanned.length} companies · {candidate.name} provides it
        </p>
      </div>
    </Panel>
  );
}

function CompanyPanel({ world, id }: { world: World; id: string }) {
  const c = world.companies[id];
  const person = Object.values(world.people).find((p) => p.companyId === id);
  const rel = Object.values(world.relationships).find((r) => r.companyIds.includes(id) && r.personIds.includes(world.viewerId));
  const viewerCompany = world.people[world.viewerId].companyId;
  const own = viewerCompany === id;
  return (
    <Panel>
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <CompanyMark company={c} size={34} />
          <div>
            <div className="text-[15px] font-medium">{c.name}</div>
            <div className="text-[12px] text-faint">
              {c.headquarters} · {c.size}
            </div>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{c.summary}</p>
        {person && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
            <Avatar person={person} accent={c.accent} size={20} />
            {person.name} · {person.role}
          </div>
        )}
        {rel && !own && (
          <div className="mt-3 flex items-center justify-between">
            <Chip tone={relationshipState(world, rel).tone}>{relationshipState(world, rel).label}</Chip>
            <Link href={`/connect/${rel.id}`} className="text-[12px] text-accent hover:underline">
              {rel.status === "unevaluated" ? "Connect agents" : "Reasoning"} →
            </Link>
          </div>
        )}
      </div>
      <div className="px-5 py-4">
        <Eyebrow>Offers</Eyebrow>
        <ul className="mt-2 space-y-1.5">
          {c.offers.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 text-[12.5px] text-ink/90">
              {o.label}
              <VisibilityTag v={o.visibility} />
            </li>
          ))}
        </ul>
        <Eyebrow className="mt-5">Needs</Eyebrow>
        <ul className="mt-2 space-y-1.5">
          {c.needs.map((n) => {
            const hidden = !own && (n.visibility === "agent-only" || n.visibility === "private");
            return (
              <li key={n.id} className="flex items-center justify-between gap-2 text-[12.5px] text-ink/90">
                <span className={hidden ? "italic text-muted" : undefined}>{hidden ? n.disclosure ?? "Withheld by agent" : n.label}</span>
                <VisibilityTag v={n.visibility} />
              </li>
            );
          })}
        </ul>
        <Link href={`/agent/${person?.id ?? ""}`} className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline">
          Business Agent profile <Arrow />
        </Link>
      </div>
    </Panel>
  );
}

function OpportunityPanel({ world, id }: { world: World; id: string }) {
  const o = world.opportunities[id];
  if (!o) return null;
  return (
    <Panel>
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {o.companyIds.map((cid) => (
              <span key={cid} className="rounded-md ring-2 ring-panel">
                <CompanyMark company={world.companies[cid]} size={22} />
              </span>
            ))}
          </div>
          <StageBadge stage={stageFor(world, o, world.viewerId)} />
        </div>
        <h2 className="mt-3 text-[16px] font-medium leading-snug">{o.title}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{o.summary}</p>
        <div className="mt-3">
          <ConfidenceMeter level={o.confidence.level} />
        </div>
      </div>
      <div className="border-t border-line px-5 py-4">
        <Eyebrow>Why now</Eyebrow>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{o.whyNow}</p>
      </div>
      <div className="border-t border-line px-5 py-4">
        <ButtonLink href={`/opportunities/${o.id}`} variant="primary" className="w-full">
          Open opportunity <Arrow />
        </ButtonLink>
      </div>
    </Panel>
  );
}
