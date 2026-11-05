"use client";

import { Button, ButtonLink } from "@/components/orqo/ui";

/**
 * Recovery (Nov 2026): the app-wide error boundary. A failure (most often: the database is temporarily
 * unreachable) is stated plainly with a retry, never shown as an empty or "signed out" page. Server details are
 * never displayed; the reference (digest) matches the server log entry.
 */
const COPY = {
  en: { title: "ORQO is temporarily unavailable", body: "This page could not be loaded. Your data is safe. Please try again in a moment.", retry: "Try again", home: "Home", ref: "Reference" },
  fr: { title: "ORQO est momentanément indisponible", body: "Cette page n'a pas pu être chargée. Vos données sont en sécurité. Réessayez dans un instant.", retry: "Réessayer", home: "Accueil", ref: "Référence" },
} as const;

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const lang = typeof document !== "undefined" && document.documentElement.lang === "fr" ? "fr" : "en";
  const t = COPY[lang];
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <div role="alert" data-testid="app-error" className="orqo-light flex min-h-screen flex-col items-center justify-center bg-canvas px-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{t.title}</h1>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-fg-muted">{t.body}</p>
      <div className="mt-6 flex gap-3">
        <Button variant="primary" onClick={() => retry()}>
          {t.retry}
        </Button>
        <ButtonLink href="/">{t.home}</ButtonLink>
      </div>
      {digest && (
        <p className="mt-6 text-[12px] text-fg-faint">
          {t.ref}: <span className="tabular-nums">{digest}</span>
        </p>
      )}
    </div>
  );
}
