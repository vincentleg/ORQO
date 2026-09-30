import { AppFrame } from "@/components/orqo/shell";
import { loadWorkspace } from "@/lib/server/workspace";

/** Authenticated ORQO shell. Not an auth boundary by itself: every page re-verifies via `loadWorkspace`. */
export default async function WorkspaceLayout({ children }: LayoutProps<"/workspace">) {
  const { locale, active, organizations, plan, user } = await loadWorkspace();
  return (
    <AppFrame locale={locale} active={active} organizations={organizations} plan={plan} email={user.email}>
      {children}
    </AppFrame>
  );
}
