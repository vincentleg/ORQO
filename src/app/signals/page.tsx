"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ProposalTeaser } from "@/components/proposal";
import { Arrow, Avatar, Button, ButtonLink, CheckIcon, Chip, CompanyMark, ConfidenceMeter, Eyebrow, Panel, cx, formatDate, relativeTo } from "@/components/ui";
import { futureSignal } from "@/lib/data/seed";
import { tagLabel } from "@/lib/domain/taxonomy";
import type { Signal, World } from "@/lib/domain/types";
import { scanRelationships } from "@/lib/engine/reevaluation";
import { useOrqo } from "@/lib/store";

const MONTHS = ["Oct 2026", "Nov 2026", "Dec 2026", "Jan 2027", "Feb 2027", "Mar 2027"];

export default function SignalsPage() {
  const world = useOrqo((s) => s.world);
  const report = useOrqo((s) => s.reevaluation);
  const fastForward = useOrqo((s) => s.fastForward);
  const reevaluate = useOrqo((s) => s.reevaluate);
  const [ticking, setTicking] = useState<number>();
  const [reveal, setReveal] = useState(report ? 99 : 0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const signal = world.signals[futureSignal.id];
  const watched = Object.values(world.relationships).flatMap((r) => r.evaluations.at(-1)?.watchConditions ?? []);
  const past = Object.values(world.signals)
    .filter((s) => s.id !== futureSignal.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  function runFastForward() {
    setTicking(0);
    MONTHS.forEach((_, i) => timers.current.push(setTimeout(() => setTicking(i), i * 260)));
    timers.current.push(
      setTimeout(() => {
        fastForward();
        setTicking(undefined);
      }, MONTHS.length * 260 + 200),
    );
  }

  function runReevaluation() {
    reevaluate();
    setReveal(0);
    [1, 2, 3, 4, 5].forEach((n) => timers.current.push(setTimeout(() => setReveal(n), n * 850)));
  }

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-8">
      <Eyebrow>Signal monitoring · re-evaluation</Eyebrow>
      <h1 className="mt-2 text-[26px] font-semibold tracking-tight">
        Meet once. <span className="text-muted">ORQO keeps looking.</span>
      </h1>
      <p className="mt-2 max-w-2xl text-[13.5px] text-muted">
        A relationship with no opportunity today may matter in six months. Your agent watches every company in your network and re-evaluates relationships when something changes.
      </p>

      {!signal && (
        <Panel className="bg-grid relative mt-7 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] items-center gap-8 px-8 py-8">
            <div>
              <Eyebrow>Currently watching</Eyebrow>
              <div className="mt-2 text-[15px] text-ink">
                {watched.length} conditions across {Object.values(world.relationships).filter((r) => (r.evaluations.at(-1)?.watchConditions.length ?? 0) > 0).length} dormant relationships
              </div>
              <ul className="mt-4 space-y-1.5">
                {watched.map((w) => (
                  <li key={w.id} className="flex items-center gap-2.5 text-[13px] text-muted">
                    <CompanyMark company={world.companies[w.companyId]} size={16} />
                    {w.description}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col items-center gap-4">
              <div className="text-center">
                <div className="font-mono text-[10.5px] uppercase tracking-wider text-faint">Today</div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={ticking ?? "now"}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="mt-1 font-mono text-3xl tabular-nums tracking-tight text-ink"
                  >
                    {ticking === undefined ? formatDate(world.now, { month: "short", year: "numeric" }) : MONTHS[ticking]}
                  </motion.div>
                </AnimatePresence>
              </div>
              <Button variant="signal" size="lg" onClick={runFastForward} disabled={ticking !== undefined} className="min-w-[240px] font-mono tracking-wider">
                {ticking !== undefined ? "Time passing…" : "FAST FORWARD +6 MONTHS"}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {signal && <SignalCard world={world} signal={signal} />}

      {signal && <ScanPanel world={world} signal={signal} done={Boolean(report)} onRun={runReevaluation} />}

      {report && (
        <div className="mt-6 space-y-6">
          <RevealList reveal={reveal} world={world} />
        </div>
      )}

      <div className="mt-10">
        <Eyebrow className="mb-3">Signal history</Eyebrow>
        <Panel className="divide-y divide-line">
          {[...(signal ? [signal] : []), ...past].map((s) => (
            <div key={s.id} className="flex items-center gap-4 px-5 py-3.5">
              <CompanyMark company={world.companies[s.companyId]} size={24} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">{s.headline}</div>
                <div className="text-[12px] text-faint">
                  {formatDate(s.occurredAt)} · {world.sources[s.sourceId]?.label} · {s.affectedRelationshipIds.length} relationships affected
                </div>
              </div>
              {s.simulated && <Chip tone="quiet">Simulated</Chip>}
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function SignalCard({ world, signal }: { world: World; signal: Signal }) {
  const company = world.companies[signal.companyId];
  const caps = signal.effect.addCapabilities ?? [];
  const needs = (signal.effect.escalateNeeds ?? []).map((e) => ({ e, need: company.needs.find((n) => n.id === e.needId) }));
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
      <Panel className="relative mt-7 overflow-hidden border-signal/30">
        <div className="pointer-events-none absolute -left-20 -top-20 h-60 w-60 rounded-full" style={{ background: "radial-gradient(circle, rgba(245,184,92,0.14), transparent 65%)" }} />
        <div className="relative px-7 py-6">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-signal opacity-60" />
              <span className="relative h-2 w-2 rounded-full bg-signal" />
            </span>
            <Eyebrow className="!text-signal">New signal detected · {formatDate(signal.occurredAt)}</Eyebrow>
            <Chip tone="quiet" className="ml-auto">
              Simulated signal · demo data
            </Chip>
          </div>
          <div className="mt-4 flex items-start gap-4">
            <CompanyMark company={company} size={40} />
            <div>
              <h2 className="text-[21px] font-semibold tracking-tight text-ink">{signal.headline}</h2>
              <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-muted">{signal.description}</p>
              <div className="mt-1.5 text-[11.5px] text-faint">Source: {world.sources[signal.sourceId]?.label}</div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {caps.map((c) => (
              <div key={c.id} className="rounded-lg border border-line bg-panel-2 px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-match">New capability</div>
                <div className="mt-1 text-[13px] text-ink">{c.label}</div>
                <div className="mt-0.5 text-[12px] text-faint">{c.tags.map(tagLabel).join(" · ")}</div>
              </div>
            ))}
            {needs.map(({ e, need }) =>
              need ? (
                <div key={e.needId} className="rounded-lg border border-line bg-panel-2 px-4 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-signal">Need escalated</div>
                  <div className="mt-1 text-[13px] text-ink">{need.label}</div>
                  <div className="mt-0.5 text-[12px] text-faint">
                    now <span className="text-signal">{e.intensity}</span>
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </div>
      </Panel>
    </motion.div>
  );
}

function ScanPanel({ world, signal, done, onRun }: { world: World; signal: Signal; done: boolean; onRun: () => void }) {
  const report = useOrqo((s) => s.reevaluation);
  const shown = done && report ? report.scans : scanRelationships(world, signal);
  const affected = shown.filter((s) => s.affected).length;
  return (
    <Panel className="mt-6">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <Eyebrow>Re-evaluation agent</Eyebrow>
          <div className="mt-1 text-[13.5px] text-ink">
            {affected} of {shown.length} existing relationships may be affected
          </div>
        </div>
        {!done && (
          <Button variant="signal" onClick={onRun}>
            Re-evaluate affected relationships <Arrow />
          </Button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {shown.map((s, i) => {
          const r = world.relationships[s.relationshipId];
          const otherId = r.personIds.find((p) => p !== world.viewerId) ?? r.personIds[1];
          const other = world.people[otherId];
          const c = world.companies[other.companyId];
          return (
            <motion.li
              key={s.relationshipId}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.12 }}
              className={cx("flex items-center gap-4 px-5 py-3", !s.affected && "opacity-50")}
            >
              <Avatar person={other} accent={c.accent} size={28} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">
                  {other.name} <span className="text-faint">· {c.name} · met {relativeTo(r.encounter.date, world.now)}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-muted">{s.reasons.join(" · ")}</div>
              </div>
              {s.affected ? <Chip tone="signal">Affected</Chip> : <Chip tone="quiet">Unaffected</Chip>}
            </motion.li>
          );
        })}
      </ul>
    </Panel>
  );
}

function RevealList({ reveal, world }: { reveal: number; world: World }) {
  const report = useOrqo((s) => s.reevaluation)!;
  const created = report.created.map((id) => world.opportunities[id]).filter(Boolean);
  const strengthened = report.strengthened.map((id) => world.opportunities[id]).filter(Boolean);
  const proposal = Object.values(world.proposals)[0];
  const steps = [
    `Re-running bilateral reasoning on ${report.scans.filter((s) => s.affected).length} relationships`,
    "Critic re-testing every hypothesis against the new facts",
    `${created.length} new opportunity · ${strengthened.length} strengthened`,
  ];
  return (
    <>
      <Panel className="px-5 py-4">
        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={s} className={cx("flex items-center gap-3 text-[13px] transition-opacity", reveal > i ? "text-ink" : "text-faint opacity-40")}>
              {reveal === i ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-signal/30 border-t-signal" /> : <CheckIcon result={reveal > i ? "pass" : "warn"} />}
              {s}
            </li>
          ))}
        </ol>
      </Panel>

      <AnimatePresence>
        {reveal >= 3 &&
          created.map((o) => {
            const rel = world.relationships[o.relationshipIds[0]];
            const personId = rel.personIds.find((p) => p !== world.viewerId) ?? rel.personIds[1];
            const person = world.people[personId];
            const company = world.companies[person.companyId];
            return (
              <motion.div
                key={o.id}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5 }}
                ref={(el) => {
                  if (el && reveal === 3) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="scroll-mt-20"
              >
                <div className="relative overflow-hidden rounded-2xl border border-signal/35 bg-panel">
                  <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2" style={{ background: "radial-gradient(ellipse at top right, rgba(245,184,92,0.12), transparent 60%)" }} />
                  <div className="relative px-7 py-6">
                    <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-signal">New opportunity found</div>
                    <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-ink">Someone you met {relativeTo(rel.encounter.date, world.now)} is now strategically relevant.</h2>
                    <div className="mt-5 flex items-center gap-4">
                      <div className="rounded-full p-1" style={{ boxShadow: `0 0 0 1px ${company.accent}55, 0 0 28px ${company.accent}30` }}>
                        <Avatar person={person} accent={company.accent} size={46} />
                      </div>
                      <div>
                        <div className="text-[15px] text-ink">
                          {person.name} <span className="text-muted">· {person.role}, {company.name}</span>
                        </div>
                        <div className="text-[12.5px] text-faint">
                          Met at {rel.encounter.event} · then: <span className="text-muted">no strong opportunity</span> · now: <span className="text-signal">{o.title}</span>
                        </div>
                      </div>
                      <ButtonLink href={`/opportunities/${o.id}`} variant="signal" className="ml-auto">
                        Review opportunity <Arrow />
                      </ButtonLink>
                    </div>
                    {o.delta && (
                      <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
                        {[
                          ["What changed", o.delta.whatChanged],
                          ["Why this relationship matters now", o.delta.whyNowRelevant],
                          ["Why it was not strong enough before", o.delta.whyNotBefore],
                        ].map(([k, v]) => (
                          <div key={k} className="bg-panel-2 px-5 py-4">
                            <Eyebrow>{k}</Eyebrow>
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{v}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 rounded-lg border border-line bg-panel-2 px-5 py-3.5">
                      <Eyebrow>New opportunity</Eyebrow>
                      <p className="mt-1 text-[13px] text-ink/90">{o.summary}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
      </AnimatePresence>

      <AnimatePresence>
        {reveal >= 4 && strengthened.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Panel className="px-5 py-4">
              <Eyebrow>Existing opportunity strengthened</Eyebrow>
              {strengthened.map((o) => (
                <div key={o.id} className="mt-2 flex items-center gap-4">
                  <span className="text-[13.5px] text-ink">{o.title}</span>
                  <ConfidenceMeter level={o.confidence.level} />
                  <span className="text-[12px] text-faint">{o.delta?.whyNotBefore}</span>
                </div>
              ))}
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reveal >= 5 && proposal && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            ref={(el) => {
              if (el && reveal === 5) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 1600);
            }}
          >
            <ProposalTeaser world={world} proposalId={proposal.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
