"use client";

import { demoHref } from "@/lib/demo-path";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useOrqo } from "@/lib/store";
import { participants } from "@/lib/engine/orchestration";
import { Avatar, Button, CompanyMark } from "./ui";

export function MatchOverlay() {
  const router = useRouter();
  const world = useOrqo((s) => s.world);
  const id = useOrqo((s) => s.celebrate);
  const dismiss = useOrqo((s) => s.dismissCelebration);
  const opp = id ? world.opportunities[id] : undefined;
  const people = opp ? participants(world, opp).map((p) => world.people[p]) : [];

  return (
    <AnimatePresence>
      {opp && (
        <motion.div
          key={opp.id}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(94,230,192,0.16), transparent 62%)" }}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.2, ease: [0.2, 0.7, 0.2, 1] }}
          />
          <div className="relative flex max-w-xl flex-col items-center px-6 text-center">
            <div className="relative mb-10 flex h-24 items-center justify-center">
              {people.map((p, i) => {
                const c = world.companies[p.companyId];
                const offset = (i - (people.length - 1) / 2) * 64;
                return (
                  <motion.div
                    key={p.id}
                    className="absolute"
                    initial={{ x: offset * 3.2, opacity: 0, scale: 0.8 }}
                    animate={{ x: offset, opacity: 1, scale: 1 }}
                    transition={{ delay: 0.15 + i * 0.08, type: "spring", stiffness: 120, damping: 16 }}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className="rounded-full p-1" style={{ boxShadow: `0 0 0 1px ${c.accent}55, 0 0 40px ${c.accent}33` }}>
                        <Avatar person={p} accent={c.accent} size={56} />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              <motion.span
                className="absolute h-3 w-3 rounded-full bg-match"
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.6, 1] }}
                transition={{ delay: 0.75, duration: 0.5 }}
                style={{ boxShadow: "0 0 24px 4px rgba(94,230,192,0.6)" }}
              />
            </div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.3em] text-match">Mutual interest confirmed</div>
              <h1 className="text-5xl font-semibold tracking-tight text-ink">It&apos;s a Business Match</h1>
              <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
                {people.map((p) => p.name).join(" and ")} each said yes, independently. <span className="text-ink">{opp.title}</span> moves to a first meeting.
              </p>
              <div className="mt-6 flex items-center justify-center gap-2">
                {opp.companyIds.map((cid) => (
                  <span key={cid} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] text-muted">
                    <CompanyMark company={world.companies[cid]} size={18} />
                    {world.companies[cid].name}
                  </span>
                ))}
              </div>
              <div className="mt-9 flex items-center justify-center gap-3">
                <Button
                  variant="match"
                  size="lg"
                  onClick={() => {
                    dismiss();
                    router.push(demoHref(`/opportunities/${opp.id}/match`));
                  }}
                >
                  Open meeting brief
                </Button>
                <Button variant="ghost" size="lg" onClick={dismiss}>
                  Later
                </Button>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
