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
import { DueDateField, FOLLOW_UP_GRID, FollowUpFields } from "./follow-up-fields";

const contact: ContactView = { id: "c1", name: "A Very Long Fictional Contact Name", role: "Chief Executive Officer and President", email: null, phone: null, profileUrl: null, notes: "", isPrimary: true, createdAt: "2026-10-01T00:00:00.000Z" };
const read = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "..", rel), "utf8");
const dateInput = (html: string) => html.match(/<input[^>]*type="date"[^>]*>/)?.[0] ?? "";

describe("due date (review finding #1)", () => {
  test("empty: no date value is rendered, the native text is hidden, and 'No due date · Optional' is explicit", () => {
    const html = renderToStaticMarkup(<DueDateField locale="en" />);
    const input = dateInput(html);
    expect(input).toContain('name="dueOn"');
    expect(input).toContain('value=""');
    expect(input).not.toMatch(/value="\d{4}-\d{2}-\d{2}"/);
    expect(input).toContain("text-transparent");
    expect(html).toContain('data-empty="true"');
    expect(html).toContain("No due date");
    expect(html).toContain("Optional");
    expect(renderToStaticMarkup(<DueDateField locale="fr" />)).toContain("Sans échéance");
  });

  test("selected: the real date is the submitted value, shown normally, and can be cleared", () => {
    const html = renderToStaticMarkup(<DueDateField locale="en" defaultValue="2026-10-14" />);
    const input = dateInput(html);
    expect(input).toContain('value="2026-10-14"');
    expect(input).not.toContain("text-transparent");
    expect(html).toContain('data-empty="false"');
    expect(html).not.toContain("No due date");
    expect(html).toContain('data-testid="due-date-clear"');
  });

  test("submission: empty means no due date (never today); a picked day is kept and displayed as that day", () => {
    expect(normalizeDueOn("")).toBeNull();
    expect(normalizeDueOn("   ")).toBeNull();
    expect(normalizeDueOn(null)).toBeNull();
    expect(normalizeDueOn("2026-10-14")).toBe("2026-10-14");
    // Same formatting as network.tsx formatIsoDay (UTC calendar day, no shift).
    expect(formatDay("2026-10-14T00:00:00Z", "en")).toBe("14 Oct 2026");
    expect(followUpBucket({ status: "open", dueOn: normalizeDueOn("") }, "2026-10-03")).toBe("later");
  });

  test("the server action reads the due date only through normalizeDueOn", () => {
    const action = read("src/app/actions/network.ts");
    expect(action).toContain('dueOn: normalizeDueOn(form.get("dueOn"))');
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
    for (const el of grid.match(/<(select|input)\b[^>]*>/g) ?? []) expect(el).toContain("min-w-0");
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
    const page = read("src/app/workspace/network/[companyId]/page.tsx");
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
