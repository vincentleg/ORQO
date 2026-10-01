/**
 * Unknowns, de-duplicated (Phase 5 review pass). Several validation keys ask
 * the same thing in different words ("in-house or outsourced?", "who builds
 * it today?", "which operations are outsourced?"). They collapse into one
 * decision-useful question per semantic group, in the original priority order
 * (the question that can confirm or kill the mechanism first). Genuinely
 * different unknowns stay. Generic: groups are defined on validation keys,
 * never on a company or a workspace.
 */
import type { ValidationKey } from "@/lib/intelligence/relevance";
import type { UnderstandingField } from "@/lib/intelligence/types";

export const UNKNOWN_GROUPS = ["operating_model", "deployment_footprint"] as const;
export type UnknownGroup = (typeof UNKNOWN_GROUPS)[number];

/** Validation keys that ask the same underlying question. */
const GROUP_OF: Partial<Record<ValidationKey, UnknownGroup>> = {
  production_model: "operating_model",
  manufacturing_partners: "operating_model",
  outsourced_services: "operating_model",
  deployment_geography: "deployment_footprint",
  regional_plans: "deployment_footprint",
};

/** Target-profile unknown fields already answered or asked by a group. */
const FIELD_COVERED_BY: Partial<Record<UnderstandingField, UnknownGroup>> = { geography: "deployment_footprint" };

export type UnknownItem = { kind: "group"; group: UnknownGroup; keys: ValidationKey[] } | { kind: "validation"; key: ValidationKey } | { kind: "field"; field: UnderstandingField };

/** What the mission-level Next Best Action can name as a shared blocker. */
export type BlockerKey = UnknownGroup | ValidationKey;

export function dedupeUnknowns(validation: readonly ValidationKey[], fields: readonly UnderstandingField[], opts: { offerKnown: boolean; max?: number }): UnknownItem[] {
  const items: UnknownItem[] = [];
  const groups = new Map<UnknownGroup, { kind: "group"; group: UnknownGroup; keys: ValidationKey[] }>();
  for (const key of new Set(validation)) {
    const g = GROUP_OF[key];
    if (!g) {
      items.push({ kind: "validation", key });
      continue;
    }
    const existing = groups.get(g);
    if (existing) existing.keys.push(key);
    else {
      const item = { kind: "group" as const, group: g, keys: [key] };
      groups.set(g, item);
      items.push(item);
    }
  }
  // A group with one member keeps its original, more specific wording.
  const merged: UnknownItem[] = items.map((i) => (i.kind === "group" && i.keys.length === 1 ? { kind: "validation", key: i.keys[0] } : i));
  const asked = new Set<UnknownGroup>([...groups.keys()]);
  for (const field of new Set(fields)) {
    const covered = FIELD_COVERED_BY[field];
    if (covered && asked.has(covered)) continue;
    // The offer is established by evidence: "what they sell" is no longer unknown.
    if (opts.offerKnown && (field === "product" || field === "offering")) continue;
    merged.push({ kind: "field", field });
  }
  return merged.slice(0, opts.max ?? 5);
}

/** The decisive blocker of a candidate: its first validation question (fields describe gaps, not blockers). */
export function blockerOf(items: readonly UnknownItem[]): BlockerKey | null {
  for (const i of items) {
    if (i.kind === "group") return i.group;
    if (i.kind === "validation") return i.key;
  }
  return null;
}
