/**
 * Phase 6 human-review findings: the follow-up due date must never look
 * selected when it is empty, and the follow-up form must stay inside its
 * column. Static render (no browser) plus source checks for the two entry
 * points. No database, no provider.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { followUpBucket, normalizeDueOn, type ContactView } from "@/lib/network/model";
import { formatDay } from "./analysis";
import { DueDateField, dueDateView, FOLLOW_UP_GRID, FollowUpFields } from "./follow-up-fields";

const contact: ContactView = { id: "c1", name: "A Very Long Fictional Contact Name", role: "Chief Executive Officer and President", email: null, phone: null, profileUrl: null, notes: "", isPrimary: true, createdAt: "2026-10-01T00:00:00.000Z" };
const read = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "..", rel), "utf8");
const dateInput = (html: string) => html.match(/<input[^>]*type="date"[^>]*>/)?.[0] ?? "";

const hiddenDue = (html: string) => html.match(/<input[^>]*type="hidden"[^>]*name="dueOn"[^>]*>|<input[^>]*name="dueOn"[^>]*type="hidden"[^>]*>/)?.[0] ?? "";

describe("due date (review findings #1 and Safari re-reviews)", () => {
  test("1 · empty initial state: only 'No due date' — no native date input is rendered; the form submits an empty dueOn", () => {
    expect(dueDateView("", false)).toEqual({ mode: "empty_idle", showClear: false });
    const html = renderToStaticMarkup(<DueDateField locale="en" />);
    expect(dateInput(html)).toBe("");
    expect(hiddenDue(html)).toContain('value=""');
    expect(html).toContain('data-testid="due-date-empty"');
    expect(html).toContain("No due date");
    expect(html).toContain("Optional");
    expect(html).not.toMatch(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
    expect(renderToStaticMarkup(<DueDateField locale="fr" />)).toContain("Sans échéance");
  });

  test("2 · empty + active (focused / picker open): only the native control, no ORQO text over it, still empty", () => {
    expect(dueDateView("", true)).toEqual({ mode: "native", showClear: false });
    const html = renderToStaticMarkup(<DueDateField locale="fr" initiallyActive />);
    expect(dateInput(html)).toContain('value=""');
    expect(html).not.toContain('data-testid="due-date-empty"');
    expect(html).not.toContain("Sans échéance");
  });

  test("3 · interaction ends without a selection (blur, value empty) → back to only 'No due date'", () => {
    // Blur sets active=false; the value is still empty, so the native input is unmounted again.
    expect(dueDateView("", false).mode).toBe("empty_idle");
    const src = read("src/components/orqo/follow-up-fields.tsx");
    expect(src).toMatch(/onBlur=\{\(\) => \{\s*setActive\(false\);/);
  });

  test("4 · a real date selected: the native input shows exactly that value, with Clear, active or not", () => {
    for (const active of [false, true]) expect(dueDateView("2026-10-14", active)).toEqual({ mode: "native", showClear: true });
    const html = renderToStaticMarkup(<DueDateField locale="en" defaultValue="2026-10-14" />);
    expect(dateInput(html)).toContain('value="2026-10-14"');
    expect(html).not.toContain("No due date");
    expect(html).toContain('data-testid="due-date-clear"');
  });

  test("5 · date cleared → back to only 'No due date' (Clear empties the value and ends interaction)", () => {
    expect(dueDateView("", false).mode).toBe("empty_idle");
    const src = read("src/components/orqo/follow-up-fields.tsx");
    expect(src).toMatch(/setValue\(""\);\s*setActive\(false\);/);
  });

  test("submission: empty means no due date (never today); a picked day is kept and displayed as that day", () => {
    expect(normalizeDueOn("")).toBeNull();
    expect(normalizeDueOn("   ")).toBeNull();
    expect(normalizeDueOn(null)).toBeNull();
    expect(normalizeDueOn("2026-10-14")).toBe("2026-10-14");
    // Same formatting as network.tsx formatIsoDay (UTC calendar day, no shift).
    expect(formatDay("2026-10-14T00:00:00Z", "en")).toBe("14 Oct 2026");
    expect(followUpBucket({ status: "open", dueOn: normalizeDueOn("") }, "2026-10-03")).toBe("later");
    expect(read("src/app/actions/network.ts")).toContain('dueOn: normalizeDueOn(form.get("dueOn"))');
  });

  test("no CSS-colour or :focus trick is relied on to hide the native date", () => {
    const src = read("src/components/orqo/follow-up-fields.tsx");
    expect(src).not.toMatch(/peer-focus|focus:text-fg|text-transparent/);
  });
});

describe("layout (review finding #2)", () => {
  const html = renderToStaticMarkup(<FollowUpFields locale="en" contacts={[contact]} preset={{ title: "Send the brief", contactId: "c1" }} />);

  test("container-safe: auto-fit grid that wraps/stacks, min-w-0 children, full-width controls, no fixed widths", () => {
    expect(FOLLOW_UP_GRID).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))]");
    expect(FOLLOW_UP_GRID).toContain("min-w-0");
    expect(html).toContain('data-testid="follow-up-grid"');
    // No fixed column count or fixed/min widths that could force overflow.
    expect(html).not.toMatch(/sm:grid-cols-3|\bw-\[\d|min-w-\[|\bw-(64|72|80|96)\b/);
    for (const el of html.match(/<(select|input|textarea)\b[^>]*>/g) ?? []) {
      if (!/type="(checkbox|hidden)"/.test(el)) expect(el).toContain("w-full");
    }
    // Grid items must be able to shrink below their content's intrinsic width.
    const grid = html.slice(html.indexOf('data-testid="follow-up-grid"'), html.indexOf('name="assignToMe"'));
    for (const el of grid.match(/<(select|input|button)\b[^>]*>/g) ?? []) {
      if (/type="hidden"/.test(el)) continue;
      expect(el).toContain("w-full");
      expect(el).toContain("min-w-0");
    }
    expect(grid.match(/<(label|div) class="[^"]*min-w-0/g)?.length).toBeGreaterThanOrEqual(3);
    // The long contact label truncates instead of widening the grid.
    expect(html).toMatch(/<select[^>]*name="contactId"[^>]*truncate/);
  });

  test("prefill is preserved: action and contact", () => {
    expect(html).toContain('value="Send the brief"');
    expect(html).toMatch(/<option value="c1" selected="">/);
  });

  test("both entry points use the same FollowUpForm → FollowUpFields, placed in full-width containers", () => {
    const forms = read("src/components/orqo/network-forms.tsx");
    const page = read("src/app/workspace/companies/[companyId]/page.tsx");
    expect(forms).toContain("<FollowUpFields");
    expect(forms.match(/type="date"/g)).toBeNull();
    expect(page.match(/<FollowUpForm\b/g)?.length).toBe(2);
    // Not in the CardHeader action slot (shrink-0 → intrinsic width), and not a flex sibling of the NBA text.
    expect(page).not.toMatch(/action=\{canWrite \? <FollowUpForm/);
    expect(page).toContain('data-testid="follow-up-composer"');
    expect(page).toContain('data-testid="next-best-action-extra"');
    expect(page).not.toContain('className="w-full sm:w-auto"');
    expect(forms).toContain("w-full min-w-0 rounded-xl border border-edge bg-subtle/60 p-4");
  });
});
