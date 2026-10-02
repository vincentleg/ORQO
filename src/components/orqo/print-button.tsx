"use client";

import { Button } from "./ui";

/** Opens the browser's print dialog ("Save as PDF"). No server-side rendering, no upload. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="primary" onClick={() => window.print()} data-testid="report-print">
      {label}
    </Button>
  );
}
