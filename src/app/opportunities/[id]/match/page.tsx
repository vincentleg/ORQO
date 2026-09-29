"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Arrow, Avatar, Button, ButtonLink, CompanyMark, EmptyState, Eyebrow, Panel, cx } from "@/components/ui";
import { isMatched } from "@/lib/engine/orchestration";
import { useOrqo } from "@/lib/store";

function proposedSlots(nowIso: string): { label: string; tz: string }[] {
  const base = new Date(nowIso);
  const slots: { label: string; tz: string }[] = [];
  for (let d = 1; slots.length < 2 && d < 10; d++) {
    const day = new Date(base.getTime() + d * 86_400_000);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6 || dow === 1) continue;
    day.setUTCHours(16, 0, 0, 0);
    const fmt = (tz: string) => day.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });
    slots.push({ label: fmt("America/Los_Angeles"), tz: `${fmt("Europe/Berlin").split(", ").pop()} CET` });
  }
  return slots;
}

export default function MatchBriefPage() {
  const { id } = useParams<{ id: string }>();
  const world = useOrqo((s) => s.world);
  const markBriefViewed = useOrqo((s) => s.markBriefViewed);
  const advance = useOrqo((s) => s.advance);
  const opp = world.opportunities[id];
  const brief = world.briefs[id];
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [slot, setSlot] = useState<number>();

  useEffect(() => {
    if (brief) markBriefViewed();
  }, [brief, markBriefViewed]);

  if (!opp) notFound();
  if (!brief || !isMatched(opp)) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16">
        <Panel>
          <EmptyState
            title="No match yet"
            body="The meeting brief unlocks only when every participant independently responds Interested."
            action={
              <ButtonLink href={`/opportunities/${id}`} size="sm" variant="primary">
                Back to opportunity
              </ButtonLink>
            }
          />
        </Panel>
      </div>
    );
  }

  const slots = proposedSlots(world.now);
  const scheduled = opp.stage !== "mutual-interest";
  const total = brief.agenda.reduce((s, a) => s + a.minutes, 0);

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-8">
      <Link href={`/opportunities/${id}`} className="inline-flex items-center gap-1.5 text-[12.5px] text-faint hover:text-muted">
        <Arrow className="rotate-180" /> {opp.title}
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mt-5 overflow-hidden rounded-2xl border border-match/25 bg-panel px-8 py-8"
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full" style={{ background: "radial-gradient(circle, rgba(94,230,192,0.14), transparent 65%)" }} />
        <Eyebrow className="!text-match">It&apos;s a Business Match</Eyebrow>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">{brief.title}</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">{brief.brief}</p>
        <div className="mt-5 flex items-center gap-4">
          <div className="flex -space-x-2">
            {brief.stakeholders
              .filter((s) => s.personId)
              .map((s) => (
                <span key={s.name} className="rounded-full ring-2 ring-panel">
                  <Avatar person={s} accent={world.companies[s.companyId].accent} size={32} />
                </span>
              ))}
          </div>
          <span className="text-[13px] text-muted">
            {brief.duration} · video call · prepared by ORQO {scheduled && <span className="text-match">· scheduled</span>}
          </span>
        </div>
      </motion.div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="space-y-6">
          <Panel className="p-6">
            <Eyebrow>Meeting objective</Eyebrow>
            <p className="mt-2.5 text-[15px] leading-relaxed text-ink">{brief.objective}</p>
          </Panel>

          <Panel>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <Eyebrow>Proposed agenda</Eyebrow>
              <span className="font-mono text-[10.5px] text-faint">{total} min</span>
            </div>
            <ol className="divide-y divide-line">
              {brief.agenda.map((a, i) => (
                <li key={a.item} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-start gap-4 px-5 py-3.5">
                  <span className="font-mono text-[12px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <div className="text-[13.5px] text-ink">{a.item}</div>
                    <div className="mt-0.5 text-[12px] text-faint">{a.owner}</div>
                  </div>
                  <span className="font-mono text-[12px] text-muted">{a.minutes}′</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel>
            <div className="border-b border-line px-5 py-3.5">
              <Eyebrow>Key questions</Eyebrow>
            </div>
            <ul className="grid grid-cols-2 gap-px bg-line">
              {brief.keyQuestions.map((q, i) => (
                <li key={q} className="flex gap-3 bg-panel px-5 py-4 text-[13px] leading-snug text-muted">
                  <span className="font-mono text-[11px] text-accent">Q{i + 1}</span>
                  {q}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <div className="border-b border-line px-5 py-3.5">
              <Eyebrow>Next actions</Eyebrow>
            </div>
            <ul className="divide-y divide-line">
              {brief.nextActions.map((a, i) => (
                <li key={a.action}>
                  <button onClick={() => setDone({ ...done, [i]: !done[i] })} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.015]">
                    <span className={cx("flex h-4 w-4 items-center justify-center rounded border transition-colors", done[i] ? "border-match bg-match" : "border-line-strong")}>
                      {done[i] && (
                        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                          <path d="M2 5.2l2 2 4-4.4" stroke="#07080a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                        </svg>
                      )}
                    </span>
                    <span className={cx("flex-1 text-[13px]", done[i] ? "text-faint line-through" : "text-muted")}>{a.action}</span>
                    <CompanyMark company={world.companies[a.ownerCompanyId]} size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel className="p-5">
            <Eyebrow>Suggested meeting</Eyebrow>
            <div className="mt-3 space-y-2">
              {slots.map((s, i) => (
                <button
                  key={s.label}
                  disabled={scheduled}
                  onClick={() => setSlot(i)}
                  className={cx(
                    "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                    slot === i ? "border-match/50 bg-match/[0.06]" : "border-line hover:border-line-strong",
                  )}
                >
                  <span className="text-[13px] text-ink">{s.label} PT</span>
                  <span className="font-mono text-[11px] text-faint">{s.tz}</span>
                </button>
              ))}
            </div>
            <Button
              variant="match"
              className="mt-4 w-full"
              disabled={slot === undefined || scheduled}
              onClick={() => slot !== undefined && advance(opp.id, "meeting", `Meeting scheduled: ${slots[slot].label} PT.`)}
            >
              {scheduled ? "Meeting scheduled" : "Schedule meeting"}
            </Button>
            <p className="mt-2 text-[11.5px] text-faint">Calendar integration is not connected in this demo; scheduling records the lifecycle change.</p>
          </Panel>

          <Panel>
            <div className="border-b border-line px-5 py-3.5">
              <Eyebrow>Relevant stakeholders</Eyebrow>
            </div>
            <ul className="divide-y divide-line">
              {brief.stakeholders.map((s) => (
                <li key={s.name + s.companyId} className="flex items-start gap-3 px-5 py-3">
                  {s.personId ? <Avatar person={s} accent={world.companies[s.companyId].accent} size={26} /> : <span className="h-[26px] w-[26px] shrink-0 rounded-full border border-dashed border-line-strong" />}
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">{s.name}</div>
                    <div className="text-[11.5px] text-faint">
                      {s.personId ? `${s.role} · ` : ""}
                      {world.companies[s.companyId].name}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted">{s.why}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <ButtonLink href="/signals" variant="secondary" className="w-full">
            Meet once. ORQO keeps looking <Arrow />
          </ButtonLink>
        </aside>
      </div>
    </div>
  );
}
