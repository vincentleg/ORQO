import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-8 py-24 text-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">404</div>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Page not found.</h1>
      <Link href="/" className="mt-6 inline-block text-[13px] text-accent hover:underline">
        ORQO →
      </Link>
    </div>
  );
}
