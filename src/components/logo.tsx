/** ORQO mark. Plain SVG, safe to render from Server and Client Components. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="ORQO">
      <circle cx="9" cy="12" r="6.25" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="12" r="6.25" stroke="#8fa8ff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="1.6" fill="#5ee6c0" />
    </svg>
  );
}
