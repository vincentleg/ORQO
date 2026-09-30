"use client";

import { demoHref } from "@/lib/demo-path";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OpportunityCard } from "@/components/network-bits";
import { Arrow, Avatar, Button, ButtonLink, CheckIcon, Chip, CompanyMark, Eyebrow, Panel, VerdictBadge, cx, formatDate, relativeTo } from "@/components/ui";
import type { Company, Person } from "@/lib/domain/types";
import type { RelationshipEvaluation } from "@/lib/engine/pipeline";
import { useOrqo } from "@/lib/store";
import { useServiceStatus } from "@/lib/use-status";
import { useDemoHandler } from "@/lib/autodemo/handlers";
import { useAutoDemo } from "@/lib/autodemo/store";

type Phase = "idle" | "running" | "done";
const STEP_MS = 720;

export default function ConnectPage() {
  const { relationshipId } = useParams<{ relationshipId: string }>();
  const world = useOrqo((s) => s.world);
  const evaluate = useOrqo((s) => s.evaluate);
  const commit = useOrqo((s) => s.commit);
  const stored = useOrqo((s) => s.connections[relationshipId]);
  const rel = world.relationships[relationshipId];
  const status = useServiceStatus();
  const [engine, setEngine] = useState<"deterministic" | "live">("deterministic");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RelationshipEvaluation>();
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [created, setCreated] = useState<string[]>([]);
  const [engineUsed, setEngineUsed] = useState<string>("deterministic");
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const presenting = useAutoDemo((s) => s.status !== "idle");

  useEffect(() => () => clearInterval(timer.current), []);
  // Auto Demo presses the same Connect button, always on the deterministic engine.
  useDemoHandler("connect.run", ({ pace }) => {
    const current = useOrqo.getState().world.relationships[relationshipId];
    if (current && current.evaluations.length === 0 && phase === "idle" && !pending) void run({ stepMs: 1300 * pace, deterministic: true });
  });

  if (!rel) notFound();
  const [pa, pb] = rel.personIds.map((id) => world.people[id]);
  const [ca, cb] = rel.companyIds.map((id) => world.companies[id]);
  const alreadyEvaluated = rel.evaluations.length > 0;
  const shown = result ?? (alreadyEvaluated ? stored ?? evaluate(relationshipId) : undefined);
  const showDone = phase === "done" || (phase === "idle" && alreadyEvaluated);
  const visibleSteps = phase === "running" ? step : shown ? shown.stages.length : 0;

  async function run(opts: { stepMs?: number; deterministic?: boolean } = {}) {
    setNotice(undefined);
    let r: RelationshipEvaluation = evaluate(relationshipId);
    let used = "deterministic";
    if (engine === "live" && !opts.deterministic) {
      setPending(true);
      try {
        const res = await fetch("/api/discover", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ world, relationshipId }),
        });
        const body = (await res.json()) as { result?: RelationshipEvaluation; engine?: string; error?: string };
        if (!res.ok || !body.result) throw new Error(body.error ?? `HTTP ${res.status}`);
        r = body.result;
        used = body.engine ?? "openrouter";
      } catch (e) {
        setNotice(`Live reasoning unavailable (${e instanceof Error ? e.message : "error"}). Fell back to the deterministic engine.`);
      } finally {
        setPending(false);
      }
    }
    setEngineUsed(used);
    setResult(r);
    setStep(1);
    setPhase("running");
    clearInterval(timer.current);
    let i = 1;
    timer.current = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= r.stages.length) {
        clearInterval(timer.current);
        const ids = commit(relationshipId, r, used === "deterministic" ? "deterministic" : (used as `openrouter:${string}`));
        setCreated(ids);
        setTimeout(() => setPhase("done"), 350);
      }
    }, opts.stepMs ?? STEP_MS);
  }

  const lastEval = rel.evaluations.at(-1);
  const discoveredIds = phase === "done" ? (created.length ? created : lastEval?.opportunityIds ?? []) : lastEval?.opportunityIds ?? [];
  const connecting = phase === "running" || pending;
  const connected = phase !== "idle" || alreadyEvaluated;

  return (
    <div className={cx("mx-auto max-w-[1180px] px-8 py-8", presenting && "pb-[45vh]")}>
      <Link href={demoHref("/")} className="inline-flex items-center gap-1.5 text-[12.5px] text-faint hover:text-muted">
        <Arrow className="rotate-180" /> Overview
      </Link>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <Eyebrow>Connect agents</Eyebrow>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">
            {pa.name.split(" ")[0]} and {pb.name.split(" ")[0]} met {relativeTo(rel.encounter.date, world.now)}.
          </h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            {rel.encounter.event}, {rel.encounter.location} · {formatDate(rel.encounter.date)} — “{rel.encounter.note}”
          </p>
        </div>
        {!alreadyEvaluated && phase === "idle" && (
          <EngineToggle engine={engine} onChange={setEngine} liveAvailable={status?.ai.available ?? false} signInRequired={status?.ai.signInRequired ?? false} model={status?.ai.model} />
        )}
      </div>

      <Panel className="bg-grid relative mt-7 overflow-hidden">
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-6 px-10 py-10">
          <AgentCard person={pa} company={ca} side="left" active={connected} />
          <Link2 connecting={connecting} connected={connected} done={showDone} found={(shown?.passing.length ?? 0) > 0} />
          <AgentCard person={pb} company={cb} side="right" active={connected} />
        </div>
        {pending && (
          <div className="flex flex-col items-center gap-2 border-t border-line px-6 py-6">
            <div className="shimmer h-1 w-64 rounded-full" />
            <p className="text-[12.5px] text-muted">Agents are researching both companies and reasoning bilaterally via OpenRouter · {status?.ai.model}</p>
          </div>
        )}
        {phase === "idle" && !alreadyEvaluated && !pending && (
          <div className="flex flex-col items-center gap-3 border-t border-line px-6 py-6">
            <Button variant="primary" size="lg" onClick={() => run()}>
              Connect agents
            </Button>
            <p className="text-[12px] text-faint">Both agents research each side, reason bilaterally, and let a critic try to reject every idea.</p>
          </div>
        )}
      </Panel>

      {notice && <div className="mt-4 rounded-lg border border-signal/30 bg-signal/[0.06] px-4 py-2.5 text-[12.5px] text-signal">{notice}</div>}

      {shown && (phase !== "idle" || alreadyEvaluated) && (
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_380px] gap-6" data-demo="analysis">
          <Panel>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[13.5px] font-medium">{connecting ? "Agents are evaluating mutual value" : "Analysis"}</h2>
                {connecting && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
              </div>
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
                {engineUsed === "deterministic" && !lastEval?.engine.startsWith("openrouter") ? "ORQO reasoning engine" : `Live · ${lastEval?.engine ?? engineUsed}`}
              </span>
            </div>
            <ol className="px-5 py-3">
              {shown.stages.map((s, i) => {
                const done = i < visibleSteps - (connecting ? 1 : 0);
                const current = connecting && i === visibleSteps - 1;
                const hidden = i >= visibleSteps;
                const last = i === shown.stages.length - 1;
                return (
                  <motion.li
                    key={s.id}
                    initial={false}
                    animate={{ opacity: hidden ? 0.25 : 1 }}
                    className="relative flex gap-4 py-2.5"
                  >
                    <div className="relative flex w-4 flex-col items-center pt-0.5">
                      {current ? (
                        <span className="mt-0.5 h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-accent/30 border-t-accent" />
                      ) : done ? (
                        <CheckIcon result={last && shown.passing.length === 0 ? "warn" : "pass"} />
                      ) : (
                        <span className="mt-1 h-2 w-2 rounded-full border border-line-strong" />
                      )}
                      {!last && <span className="mt-1 w-px flex-1 bg-line" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className={cx("text-[13.5px]", last && done ? (shown.passing.length ? "font-medium text-match" : "font-medium text-signal") : "text-ink")}>{s.label}</div>
                      <AnimatePresence>
                        {(done || current) && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
                            <div className="mt-0.5 text-[12.5px] text-muted">{s.detail}</div>
                            {s.items.length > 0 && done && (!connecting || i === visibleSteps - 2) && (
                              <ul className="mt-2 space-y-1">
                                {s.items.map((it) => (
                                  <li key={it} className="flex gap-2 text-[12px] leading-snug text-faint">
                                    <span className="mt-[7px] h-px w-2.5 shrink-0 bg-line-strong" />
                                    <span>{it}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          </Panel>

          <div className="space-y-4">
            <AnimatePresence>
              {showDone && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-4">
                  {discoveredIds.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-match" />
                        <Eyebrow className="!text-match">Opportunity discovered</Eyebrow>
                      </div>
                      {discoveredIds.map((id) => world.opportunities[id] && <OpportunityCard key={id} world={world} o={world.opportunities[id]} className="border-match/25" />)}
                      <ButtonLink href={demoHref(`/opportunities/${discoveredIds[0]}`)} variant="primary" className="w-full">
                        Review opportunity <Arrow />
                      </ButtonLink>
                    </>
                  ) : (
                    <Panel className="p-5" data-demo="verdict">
                      <Eyebrow className="!text-signal">No strong opportunity yet</Eyebrow>
                      <p className="mt-2 text-[13px] leading-relaxed text-muted">
                        ORQO does not manufacture opportunities. The agents will keep watching this relationship and re-evaluate when something changes.
                      </p>
                      {(lastEval?.watchConditions.length ?? 0) > 0 && (
                        <div className="mt-4">
                          <div className="text-[12px] font-medium text-ink">Watching for</div>
                          <ul className="mt-2 space-y-1.5">
                            {lastEval?.watchConditions.map((w) => (
                              <li key={w.id} className="flex items-center gap-2 text-[12.5px] text-muted">
                                <span className="h-1 w-1 rounded-full bg-signal" />
                                {w.description}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </Panel>
                  )}
                  {shown.evaluated.some((e) => e.critique.report.verdict !== "pass") && (
                    <Panel className="p-5">
                      <Eyebrow>Held back by the critic</Eyebrow>
                      <div className="mt-3 space-y-3">
                        {shown.evaluated
                          .filter((e) => e.critique.report.verdict !== "pass")
                          .map((e) => (
                            <div key={e.draft.title}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[13px] text-ink">{e.draft.title}</span>
                                <VerdictBadge verdict={e.critique.report.verdict} />
                              </div>
                              <ul className="mt-1.5 space-y-1">
                                {e.critique.report.checks
                                  .filter((c) => c.result !== "pass")
                                  .map((c) => (
                                    <li key={c.id} className="flex gap-2 text-[12px] leading-snug text-muted">
                                      <span className="mt-0.5 shrink-0">
                                        <CheckIcon result={c.result} />
                                      </span>
                                      {c.note}
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          ))}
                      </div>
                    </Panel>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            {showDone && rel.evaluations.length > 0 && (
              <Panel className="p-5">
                <Eyebrow>Relationship history</Eyebrow>
                <ol className="mt-3 space-y-3">
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />
                    <div className="text-[12.5px]">
                      <div className="text-ink">Met at {rel.encounter.event}</div>
                      <div className="text-faint">{formatDate(rel.encounter.date)}</div>
                    </div>
                  </li>
                  {rel.evaluations.map((ev) => (
                    <li key={ev.id} className="flex gap-3">
                      <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", ev.outcome === "opportunity" ? "bg-match" : "bg-signal")} />
                      <div className="text-[12.5px]">
                        <div className="text-ink">{ev.outcome === "opportunity" ? "Opportunity found" : "No strong opportunity yet"}</div>
                        <div className="text-faint">
                          {formatDate(ev.at)} · {ev.trigger.kind === "signal" ? `after signal: ${world.signals[ev.trigger.signalId]?.headline ?? "new signal"}` : ev.trigger.kind === "connection" ? "agents connected" : "network search"}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
            {!showDone && (
              <Panel className="p-5">
                <Eyebrow>Privacy</Eyebrow>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  Agents reason over agent-only information but never disclose it verbatim. The other side only sees what each owner allows.
                </p>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EngineToggle({
  engine,
  onChange,
  liveAvailable,
  signInRequired,
  model,
}: {
  engine: "deterministic" | "live";
  onChange: (e: "deterministic" | "live") => void;
  liveAvailable: boolean;
  signInRequired: boolean;
  model?: string;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex rounded-lg border border-line p-0.5 text-[12px]">
        {(["deterministic", "live"] as const).map((e) => (
          <button
            key={e}
            disabled={e === "live" && !liveAvailable}
            onClick={() => onChange(e)}
            className={cx("rounded-md px-3 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40", engine === e ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink")}
          >
            {e === "deterministic" ? "ORQO engine" : "Live AI"}
          </button>
        ))}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {liveAvailable ? `OpenRouter · ${model}` : signInRequired ? "Live AI: sign in to use" : "Live AI: no application key configured"}
      </span>
    </div>
  );
}

function AgentCard({ person, company, side, active }: { person: Person; company: Company; side: "left" | "right"; active: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: side === "left" ? -16 : 16 }}
      animate={{ opacity: 1, x: 0 }}
      className={cx("flex items-center gap-4", side === "right" && "flex-row-reverse text-right")}
    >
      <div className="relative">
        <div className="rounded-full p-1" style={{ boxShadow: `0 0 0 1px ${company.accent}40${active ? `, 0 0 32px ${company.accent}30` : ""}` }}>
          <Avatar person={person} accent={company.accent} size={52} />
        </div>
        <span className="absolute -bottom-1 -right-1 rounded-md ring-2 ring-panel">
          <CompanyMark company={company} size={20} />
        </span>
      </div>
      <div>
        <div className="text-[15px] font-medium text-ink">{person.name}</div>
        <div className="text-[12.5px] text-muted">
          {person.role} · {company.name}
        </div>
        <div className={cx("mt-1.5 flex items-center gap-1.5", side === "right" && "justify-end")}>
          <Chip tone={active ? "match" : "neutral"}>
            <span className={cx("h-1 w-1 rounded-full", active ? "bg-match" : "bg-faint")} />
            Business agent {active ? "connected" : "ready"}
          </Chip>
        </div>
      </div>
    </motion.div>
  );
}

function Link2({ connecting, connected, done, found }: { connecting: boolean; connected: boolean; done: boolean; found: boolean }) {
  const color = done ? (found ? "#5ee6c0" : "#f5b85c") : "#8fa8ff";
  return (
    <div className="relative flex h-16 w-[300px] items-center">
      <svg width="300" height="64" viewBox="0 0 300 64" className="absolute inset-0">
        <line x1="0" y1="32" x2="300" y2="32" stroke="white" strokeOpacity="0.08" strokeDasharray="2 6" />
        {connected && (
          <motion.line
            x1="0"
            y1="32"
            x2="300"
            y2="32"
            stroke={color}
            strokeWidth="1.4"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8 }}
            className={connecting ? "edge-flow" : undefined}
          />
        )}
        {connecting &&
          [0, 1, 2].map((i) => (
            <motion.circle
              key={i}
              r="2.5"
              cy="32"
              fill="#8fa8ff"
              initial={{ cx: i % 2 ? 300 : 0, opacity: 0 }}
              animate={{ cx: i % 2 ? 0 : 300, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.5, ease: "easeInOut" }}
            />
          ))}
      </svg>
      <div className="relative mx-auto">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="done" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-full border bg-panel px-3 py-1 font-mono text-[10.5px] uppercase tracking-wider" style={{ borderColor: `${color}55`, color }}>
              {found ? "Opportunity discovered" : "No strong opportunity yet"}
            </motion.div>
          ) : connecting ? (
            <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-full border border-accent/30 bg-panel px-3 py-1 font-mono text-[10.5px] uppercase tracking-wider text-accent">
              Reasoning bilaterally
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
