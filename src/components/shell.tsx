"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useOrqo } from "@/lib/store";
import { nextDemoStep } from "@/lib/demo";
import { Arrow, Avatar, cx, formatDate } from "./ui";
import { MatchOverlay } from "./match-overlay";
import { AutoDemoLayer, PlayDemoButton } from "./autodemo";
import { useAutoDemo } from "@/lib/autodemo/store";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="ORQO">
      <circle cx="9" cy="12" r="6.25" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="12" r="6.25" stroke="#8fa8ff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="1.6" fill="#5ee6c0" />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Overview", icon: "M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" },
  { href: "/network", label: "Network", icon: "M4 4.5a1.5 1.5 0 1 0 0-.01M12 4.5a1.5 1.5 0 1 0 0-.01M8 12a1.5 1.5 0 1 0 0-.01M5.2 5.3l2 5.4M10.8 5.3l-2 5.4M5.5 4.5h5" },
  { href: "/opportunities", label: "Opportunities", icon: "M8 2.5l1.7 3.6 3.8.5-2.8 2.6.7 3.8L8 11.2 4.6 13l.7-3.8-2.8-2.6 3.8-.5z" },
  { href: "/signals", label: "Signals", icon: "M2 8h2.5l1.5-4 2.5 8 1.5-4H14" },
  { href: "/agent", label: "Agent", icon: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c.6-2.4 2.6-4 5-4s4.4 1.6 5 4" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const world = useOrqo((s) => s.world);
  const newOpps = Object.values(world.opportunities).filter((o) => o.stage === "discovered").length;
  const newSignals = Object.values(world.signals).filter((s) => Date.parse(world.now) - Date.parse(s.occurredAt) < 30 * 86_400_000).length;
  const badge: Record<string, number> = { "/opportunities": newOpps, "/signals": newSignals };

  return (
    <aside className="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col border-r border-line bg-bg px-3 py-4">
      <Link href="/" className="mb-7 flex items-center gap-2.5 px-2 text-ink">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[0.18em]">ORQO</span>
      </Link>
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href) || (item.href === "/network" && pathname.startsWith("/connect"));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "group flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-colors",
                active ? "bg-white/[0.06] text-ink" : "text-muted hover:bg-white/[0.03] hover:text-ink",
              )}
            >
              <span className={active ? "text-accent" : "text-faint group-hover:text-muted"}>
                <NavIcon d={item.icon} />
              </span>
              {item.label}
              {badge[item.href] > 0 && <span className="ml-auto rounded bg-white/[0.07] px-1.5 font-mono text-[10.5px] text-muted">{badge[item.href]}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3 px-2">
        <div className="rounded-lg border border-line p-3">
          <div className="text-[12px] leading-snug text-muted">
            You meet the person.
            <br />
            <span className="text-ink">ORQO finds the business.</span>
          </div>
        </div>
        <ResetButton />
      </div>
    </aside>
  );
}

function ResetButton() {
  const reset = useOrqo((s) => s.reset);
  const presenting = useAutoDemo((s) => s.status !== "idle");
  if (presenting) return null;
  return (
    <button onClick={reset} className="flex w-full items-center gap-2 rounded-md px-1 py-1 font-mono text-[10.5px] uppercase tracking-wider text-faint transition-colors hover:text-muted">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M2 6a4 4 0 1 0 1.2-2.85M2 2v2.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      Reset demo
    </button>
  );
}

function ViewerSwitch() {
  const world = useOrqo((s) => s.world);
  const setViewer = useOrqo((s) => s.setViewer);
  const [open, setOpen] = useState(false);
  const viewer = world.people[world.viewerId];
  const company = world.companies[viewer.companyId];
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-white/[0.04]">
        <Avatar person={viewer} accent={company.accent} size={26} />
        <div className="text-left leading-tight">
          <div className="text-[12.5px] text-ink">{viewer.name}</div>
          <div className="text-[11px] text-faint">{company.name}</div>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-faint" aria-hidden>
          <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" fill="none" strokeWidth="1.2" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-line-strong bg-panel-2 p-1.5 shadow-2xl"
          >
            <div className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-wider text-faint">View ORQO as</div>
            {Object.values(world.people).map((p) => {
              const c = world.companies[p.companyId];
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setViewer(p.id);
                    setOpen(false);
                  }}
                  className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]", p.id === viewer.id && "bg-white/[0.04]")}
                >
                  <Avatar person={p} accent={c.accent} size={24} />
                  <div className="leading-tight">
                    <div className="text-[12.5px] text-ink">{p.name}</div>
                    <div className="text-[11px] text-faint">
                      {p.role} · {c.name}
                    </div>
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Clock() {
  const now = useOrqo((s) => s.world.now);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 font-mono text-[11px] text-muted">
      <span className="text-faint">DEMO CLOCK</span>
      <AnimatePresence mode="wait">
        <motion.span key={now} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-ink">
          {formatDate(now)}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function DemoGuide() {
  const world = useOrqo((s) => s.world);
  const briefViewed = useOrqo((s) => s.briefViewed);
  const reevaluated = useOrqo((s) => Boolean(s.reevaluation));
  const step = nextDemoStep(world, briefViewed, reevaluated);
  const pathname = usePathname();
  const here = step.href.split("?")[0] === pathname;
  return (
    <Link
      href={step.href}
      className={cx(
        "group flex items-center gap-3 rounded-lg border px-3 py-1.5 transition-colors",
        here ? "border-accent/25 bg-accent/[0.05]" : "border-line hover:border-line-strong",
      )}
    >
      <span className="font-mono text-[10.5px] text-faint">
        DEMO {step.index}/{step.total}
      </span>
      <span className="text-[12.5px] text-ink">{step.title}</span>
      <Arrow className="text-accent transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const presenting = useAutoDemo((s) => s.status !== "idle");
  const hideSidebar = useAutoDemo((s) => s.hideSidebar && s.status !== "idle");
  useEffect(() => {
    void Promise.resolve(useOrqo.persist.rehydrate()).then(() => setHydrated(true));
  }, []);

  return (
    <div className="flex min-h-screen">
      {!hideSidebar && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-line bg-bg/85 px-6 backdrop-blur-md">
          {hideSidebar ? (
            <Link href="/" className="flex items-center gap-2.5 text-ink">
              <Logo />
              <span className="text-[15px] font-semibold tracking-[0.18em]">ORQO</span>
            </Link>
          ) : presenting ? (
            <span />
          ) : (
            <DemoGuide />
          )}
          <div className="flex items-center gap-3">
            {!presenting && <PlayDemoButton />}
            <Clock />
            <ViewerSwitch />
          </div>
        </header>
        <main className="flex-1">{hydrated ? children : <div className="p-8"><div className="shimmer h-40 rounded-xl" /></div>}</main>
      </div>
      <MatchOverlay />
      <AutoDemoLayer />
    </div>
  );
}
