"use client";

import { useEffect, useRef } from "react";
import type { DemoHandler } from "./types";

type Fn = (opts: { pace: number }) => void;

const registry = new Map<DemoHandler, Fn>();

/** Lets a screen expose one of its own UI handlers to the Auto Demo runner. */
export function useDemoHandler(name: DemoHandler, fn: Fn): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    const call: Fn = (opts) => ref.current(opts);
    registry.set(name, call);
    return () => {
      if (registry.get(name) === call) registry.delete(name);
    };
  }, [name]);
}

export function getDemoHandler(name: DemoHandler): Fn | undefined {
  return registry.get(name);
}
