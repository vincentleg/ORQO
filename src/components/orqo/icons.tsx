import type { SVGProps } from "react";

/** Small stroke icon set for the production shell (no icon dependency). */
export type IconName =
  | "search"
  | "discover"
  | "network"
  | "intelligence"
  | "events"
  | "agents"
  | "dashboard"
  | "company"
  | "settings"
  | "plans"
  | "lock"
  | "arrow"
  | "check"
  | "refresh"
  | "globe"
  | "clock"
  | "plus"
  | "opportunities"
  | "work"
  | "more";

const PATHS: Record<IconName, string> = {
  search: "M11 11l3.5 3.5M7 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z",
  discover: "M8 14.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM10.5 5.5l-1.5 3.5-3.5 1.5 1.5-3.5z",
  network: "M4 4.5a2 2 0 1 0 0-.01M12 4.5a2 2 0 1 0 0-.01M8 13.5a2 2 0 1 0 0-.01M5.5 5.8l1.6 5.6M10.5 5.8l-1.6 5.6M6 4.5h4",
  intelligence: "M1.5 8h3l2-5 3 10 2-5h3",
  events: "M3 3.5h10a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM2 7h12M5.5 2v3M10.5 2v3",
  agents: "M4.5 6.5h7a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM8 6.5V3.5M8 3.5a1 1 0 1 0 0-.01M6 10h.01M10 10h.01",
  dashboard: "M2.5 2.5h4.5v5h-4.5zM9 2.5h4.5v3h-4.5zM9 7.5h4.5v6h-4.5zM2.5 9.5h4.5v4h-4.5z",
  company: "M2.5 14V3.5l6-1.5V14M8.5 6.5l5 1.5V14M1.5 14h13M4.5 5.5h2M4.5 8h2M4.5 10.5h2",
  settings: "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4",
  plans: "M2 5.5l6-3 6 3-6 3zM2 8.5l6 3 6-3M2 11.5l6 3 6-3",
  lock: "M4 7h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM5.5 7V5a2.5 2.5 0 0 1 5 0v2",
  arrow: "M3 8h10M9 4l4 4-4 4",
  check: "M3.5 8.5l3 3 6-7",
  refresh: "M13 3v3.5H9.5M3 13V9.5h3.5M12.5 6.5A5 5 0 0 0 3.8 5M3.5 9.5a5 5 0 0 0 8.7 1.5",
  globe: "M8 14.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM1.5 8h13M8 1.5c1.8 1.8 2.6 4 2.6 6.5S9.8 12.7 8 14.5C6.2 12.7 5.4 10.5 5.4 8S6.2 3.3 8 1.5z",
  clock: "M8 14.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM8 4.5V8l2.5 1.5",
  plus: "M8 3v10M3 8h10",
  opportunities: "M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5",
  work: "M2.5 5.5h11v8h-11zM6 5.5V3.5h4v2M2.5 9h11",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
};

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
