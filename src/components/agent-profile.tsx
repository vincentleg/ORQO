"use client";

import Link from "next/link";
import type { Visibility, World } from "@/lib/domain/types";
import { tagLabel } from "@/lib/domain/taxonomy";
import { Avatar, Chip, CompanyMark, Dot, EpistemicTag, Eyebrow, Panel, VisibilityTag, cx, formatDate } from "./ui";

const LEVELS: { v: Visibility; copy: string }[] = [
  { v: "public", copy: "Anyone, including public research" },
  { v: "network", copy: "People in your ORQO network" },
  { v: "connection", copy: "Direct connections, once agents are connected" },
  { v: "agent-only", copy: "Your agent reasons over it; others see only an approved summary" },
  { v: "private", copy: "Never leaves your agent" },
];

export function AgentProfile({ world, personId }: { world: World; personId: string }) {
  const person = world.people[personId];
  const company = world.companies[person.companyId];
  const own = world.people[world.viewerId].companyId === company.id;
  const rels = Object.values(world.relationships).filter((r) => r.personIds.includes(personId));
  const watch = rels.flatMap((r) => r.evaluations.at(-1)?.watchConditions ?? []);
  const src = (id: string) => world.sources[id];

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-8">
      <div className="flex flex-wrap gap-2">
        {Object.values(world.people).map((p) => (
          <Link
            key={p.id}
            href={`/agent/${p.id}`}
            className={cx("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors", p.id === personId ? "border-line-strong bg-white/[0.04] text-ink" : "border-line text-muted hover:text-ink")}
          >
            <Avatar person={p} accent={world.companies[p.companyId].accent} size={18} />
            {p.name}
          </Link>
        ))}
      </div>

      <Panel className="relative mt-5 overflow-hidden">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full" style={{ background: `radial-gradient(circle, ${company.accent}22, transparent 65%)` }} />
        <div className="relative flex items-start gap-6 px-7 py-7">
          <div className="relative">
            <Avatar person={person} accent={company.accent} size={64} />
            <span className="absolute -bottom-1 -right-1 rounded-md ring-2 ring-panel">
              <CompanyMark company={company} size={24} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-[24px] font-semibold tracking-tight">{person.name}</h1>
              <Chip tone="match">
                <Dot tone="match" pulse /> Agent active
              </Chip>
            </div>
            <div className="mt-1 text-[13.5px] text-muted">
              {person.role} · {company.name} · {person.location}
            </div>
            <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-ink/85">{company.summary}</p>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
              <Meta k="Headquarters" v={company.headquarters} />
              <Meta k="Company" v={company.size} />
              <Meta k="Markets" v={company.markets.join(", ")} />
              <Meta k="Geographies" v={company.geographies.join(", ")} />
            </div>
          </div>
          <div className="w-56 shrink-0 rounded-xl border border-line bg-panel-2 p-4">
            <Eyebrow>Business Agent</Eyebrow>
            <div className="mt-3 space-y-2 text-[12.5px]">
              <Row k="Relationships" v={rels.length} />
              <Row k="Evaluations run" v={rels.reduce((n, r) => n + r.evaluations.length, 0)} />
              <Row k="Watch conditions" v={watch.length} />
              <Row k="Opportunities" v={Object.values(world.opportunities).filter((o) => o.companyIds.includes(company.id)).length} />
            </div>
          </div>
        </div>
      </Panel>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <Panel>
          <div className="border-b border-line px-5 py-3.5">
            <Eyebrow>Offers · capabilities</Eyebrow>
          </div>
          <ul className="divide-y divide-line">
            {company.offers.map((c) => (
              <li key={c.id} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13.5px] text-ink">{c.label}</span>
                  <VisibilityTag v={c.visibility} />
                </div>
                <p className="mt-1 text-[12.5px] text-muted">{c.detail}</p>
                {c.evidence.map((e) => (
                  <div key={e.excerpt} className="mt-2 flex items-center gap-2 text-[11.5px] text-faint">
                    <EpistemicTag kind={e.epistemic} />
                    <span className="truncate">{src(e.sourceId)?.label}</span>
                    <span>· {formatDate(c.observedAt)}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-3.5">
            <Eyebrow>Needs · strategic intent</Eyebrow>
          </div>
          <ul className="divide-y divide-line">
            {company.needs.map((n) => {
              const hidden = !own && (n.visibility === "agent-only" || n.visibility === "private");
              return (
                <li key={n.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13.5px] text-ink">{hidden ? "Withheld need" : n.label}</span>
                    <div className="flex items-center gap-2">
                      <Chip tone={n.intensity === "critical" ? "signal" : n.intensity === "active" ? "accent" : "quiet"}>{n.intensity}</Chip>
                      <VisibilityTag v={n.visibility} />
                    </div>
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">{hidden ? `Shared as: “${n.disclosure ?? "details withheld"}”` : n.detail}</p>
                  {!hidden && n.tags.length > 0 && <div className="mt-1.5 text-[11.5px] text-faint">{n.tags.map(tagLabel).join(" · ")}</div>}
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-3.5">
            <Eyebrow>Strategic objectives</Eyebrow>
          </div>
          <ul className="divide-y divide-line">
            {company.objectives.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                <div>
                  <div className="text-[13.5px] text-ink">{o.statement}</div>
                  <div className="mt-0.5 text-[12px] text-faint">{o.horizon}</div>
                </div>
                <VisibilityTag v={o.visibility} />
              </li>
            ))}
          </ul>
          {company.constraints.length > 0 && (
            <>
              <div className="border-y border-line px-5 py-3.5">
                <Eyebrow>Requirements of partners</Eyebrow>
              </div>
              <ul className="divide-y divide-line">
                {company.constraints.map((c) => (
                  <li key={c.id} className="px-5 py-3 text-[13px] text-muted">
                    {c.label}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-3.5">
            <Eyebrow>Information visibility</Eyebrow>
          </div>
          <ul className="divide-y divide-line">
            {LEVELS.map((l) => (
              <li key={l.v} className="flex items-center gap-4 px-5 py-3">
                <span className="w-28">
                  <VisibilityTag v={l.v} />
                </span>
                <span className="text-[12.5px] text-muted">{l.copy}</span>
              </li>
            ))}
          </ul>
          {watch.length > 0 && (
            <>
              <div className="border-y border-line px-5 py-3.5">
                <Eyebrow>Agent is watching for</Eyebrow>
              </div>
              <ul className="space-y-1.5 px-5 py-3.5">
                {watch.map((w) => (
                  <li key={w.id} className="flex items-center gap-2.5 text-[12.5px] text-muted">
                    <Dot tone="signal" /> {w.description}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="text-faint">{k} </span>
      <span className="text-ink/85">{v}</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{k}</span>
      <span className="font-mono tabular-nums text-ink">{v}</span>
    </div>
  );
}
