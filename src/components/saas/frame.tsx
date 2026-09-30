import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

/** Centered card layout for the production entry screens (auth, onboarding). */
export function CenteredFrame({ title, body, children, footer }: { title: string; body?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <Link href="/" className="mb-8 flex items-center gap-2.5 text-ink">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[0.18em]">ORQO</span>
      </Link>
      <section className="w-full max-w-sm rounded-xl border border-line bg-panel p-6">
        <h1 className="text-[18px] font-semibold tracking-tight text-ink">{title}</h1>
        {body && <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>}
        <div className="mt-5">{children}</div>
      </section>
      {footer && <div className="mt-6 text-[12.5px] text-faint">{footer}</div>}
    </div>
  );
}
