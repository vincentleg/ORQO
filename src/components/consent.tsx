"use client";

import { motion } from "motion/react";
import type { ConsentResponse, Opportunity, World } from "@/lib/domain/types";
import { consentOf, isMatched, participants } from "@/lib/engine/orchestration";
import { useOrqo } from "@/lib/store";
import { Arrow, Avatar, Button, ButtonLink, Eyebrow, LockIcon, Panel, cx } from "./ui";

const OPTIONS: { id: ConsentResponse; label: string }[] = [
  { id: "interested", label: "Interested" },
  { id: "not-now", label: "Not now" },
  { id: "not-relevant", label: "Not relevant" },
  { id: "never", label: "Never suggest this again" },
];

const RESPONSE_COPY: Record<ConsentResponse, string> = {
  interested: "You're interested.",
  "not-now": "Snoozed. Your agent will resurface this if something changes.",
  "not-relevant": "Marked not relevant. The other side is not told.",
  never: "Your agent will not suggest this structure with these companies again.",
};

export function ConsentPanel({ world, opp }: { world: World; opp: Opportunity }) {
  const respond = useOrqo((s) => s.respond);
  const setViewer = useOrqo((s) => s.setViewer);
  const people = participants(world, opp).map((id) => world.people[id]);
  const viewer = world.people[world.viewerId];
  const isParticipant = people.some((p) => p.id === viewer.id);
  const mine = consentOf(world, opp.id, viewer.id)?.response;
  const matched = isMatched(opp);
  const nextPerson = people.find((p) => p.id !== viewer.id && consentOf(world, opp.id, p.id)?.response !== "interested");

  if (matched) {
    return (
      <Panel className="overflow-hidden border-match/30">
        <div className="bg-match/[0.06] px-5 py-5">
          <Eyebrow className="!text-match">It&apos;s a Business Match</Eyebrow>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">Every participant said yes independently. ORQO prepared the first meeting.</p>
          <div className="mt-4 flex -space-x-2">
            {people.map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-panel">
                <Avatar person={p} accent={world.companies[p.companyId].accent} size={30} />
              </span>
            ))}
          </div>
          <ButtonLink href={`/opportunities/${opp.id}/match`} variant="match" className="mt-5 w-full">
            Open meeting brief <Arrow />
          </ButtonLink>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="border-b border-line px-5 py-3.5">
        <Eyebrow>Bilateral consent</Eyebrow>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">Each side decides privately. Nobody learns the other&apos;s answer unless everyone is interested.</p>
      </div>
      <div className="space-y-2 px-5 py-4">
        {people.map((p) => {
          const me = p.id === viewer.id;
          const c = world.companies[p.companyId];
          return (
            <div key={p.id} className={cx("flex items-center gap-3 rounded-lg border px-3 py-2.5", me ? "border-line-strong bg-white/[0.02]" : "border-line")}>
              <Avatar person={p} accent={c.accent} size={26} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink">
                  {p.name} {me && <span className="text-faint">· you</span>}
                </div>
                <div className="text-[11px] text-faint">{c.name}</div>
              </div>
              {me ? (
                <span className={cx("font-mono text-[10px] uppercase tracking-wider", mine === "interested" ? "text-match" : mine ? "text-muted" : "text-faint")}>
                  {mine ? OPTIONS.find((o) => o.id === mine)?.label : "Awaiting you"}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                  <LockIcon /> Sealed
                </span>
              )}
            </div>
          );
        })}
      </div>

      {isParticipant ? (
        <div className="border-t border-line px-5 py-4">
          {mine ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <p className="text-[13px] text-ink">{RESPONSE_COPY[mine]}</p>
              {mine === "interested" && (
                <p className="mt-1 text-[12.5px] text-muted">
                  Your response is private. If {people.filter((p) => p.id !== viewer.id).map((p) => p.name.split(" ")[0]).join(" and ")} {people.length > 2 ? "are" : "is"} also interested, ORQO introduces you.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => respond(opp.id, viewer.id, mine === "interested" ? "not-now" : "interested")} className="text-[12px] text-faint underline-offset-2 hover:text-muted hover:underline">
                  Change response
                </button>
              </div>
            </motion.div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {OPTIONS.map((o) => (
                <Button
                  key={o.id}
                  size="sm"
                  variant={o.id === "interested" ? "match" : "secondary"}
                  className={cx(o.id === "interested" && "col-span-2 !h-10 !text-[14px]", o.id === "never" && "col-span-2 !text-muted")}
                  onClick={() => respond(opp.id, viewer.id, o.id)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-line px-5 py-4 text-[12.5px] text-muted">You are not a participant in this opportunity.</div>
      )}

      {nextPerson && (mine === "interested" || !isParticipant) && (
        <div className="border-t border-dashed border-line px-5 py-3.5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-faint">Demo · switch perspective</div>
          <Button size="sm" variant="secondary" className="w-full" onClick={() => setViewer(nextPerson.id)}>
            <Avatar person={nextPerson} accent={world.companies[nextPerson.companyId].accent} size={18} />
            View as {nextPerson.name}
          </Button>
        </div>
      )}
    </Panel>
  );
}
