"use client";

import { useActionState } from "react";
import { rebuildGraphAction } from "@/app/actions/graph";
import type { ActionState } from "@/app/actions/workspace";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { ErrorLine } from "./network-forms";
import { Button } from "./ui";

/** Admin-only: rebuild this workspace's derived graph from its PostgreSQL records. */
export function RebuildGraphButton({ locale, organizationId }: { locale: Locale; organizationId: string }) {
  const t = createTranslator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(rebuildGraphAction, {});
  return (
    <form action={action} className="flex max-w-xs flex-col items-end gap-1.5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending} data-testid="graph-rebuild">
        {pending ? t("graph.status.rebuilding") : t("graph.status.rebuild")}
      </Button>
      <p className="text-right text-[11.5px] text-fg-faint">{t("graph.status.rebuildHint")}</p>
      <ErrorLine locale={locale} error={state.error} />
    </form>
  );
}
