"use client";

import { useEffect, useState } from "react";
import type { PublicStatus } from "@/lib/server/config";

let cached: Promise<PublicStatus | undefined> | undefined;

export function useServiceStatus(): PublicStatus | undefined {
  const [status, setStatus] = useState<PublicStatus>();
  useEffect(() => {
    cached ??= fetch("/api/status")
      .then((r) => (r.ok ? (r.json() as Promise<PublicStatus>) : undefined))
      .catch(() => undefined);
    let live = true;
    void cached.then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return status;
}
