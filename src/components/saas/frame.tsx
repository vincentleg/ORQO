import type { ReactNode } from "react";
import { Wordmark } from "@/components/orqo/shell";

/** Centered card layout for the production entry screens (auth, onboarding). */
export function CenteredFrame({ title, body, children, footer }: { title: string; body?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="orqo-light flex min-h-screen flex-col items-center justify-center bg-canvas px-6 py-16">
      <div className="mb-8">
        <Wordmark />
      </div>
      <section className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-7 shadow-raised">
        <h1 className="text-[20px] font-semibold tracking-tight text-fg">{title}</h1>
        {body && <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{body}</p>}
        <div className="mt-6">{children}</div>
      </section>
      {footer && <div className="mt-6 text-[13px] text-fg-faint">{footer}</div>}
    </div>
  );
}
