import { AppShell } from "@/components/shell";

/**
 * The hackathon demo: browser-local, deterministic, no account required. Its
 * state lives in localStorage ("orqo-demo") and never touches production data.
 * Its copy is English-only until the demo is localized.
 */
export default function DemoLayout({ children }: LayoutProps<"/demo">) {
  return (
    <div lang="en">
      <AppShell>{children}</AppShell>
    </div>
  );
}
