import { z } from "zod";
import { fromDbError, parseInput } from "@/lib/server/errors";
import { VisibilitySchema } from "@/lib/server/orqo/schemas";
import type { Db } from "@/lib/server/supabase/types";

const Text = (max: number) => z.string().trim().max(max);
const ExternalRef = z.string().trim().min(1).max(200).optional();
const IdRow = z.object({ id: z.uuid() });

export const NewContactInput = z.object({
  companyId: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  role: Text(200).default(""),
  location: Text(200).default(""),
  bio: Text(2000).default(""),
  externalRef: ExternalRef,
});

export async function createContact(db: Db, organizationId: string, input: z.input<typeof NewContactInput>): Promise<string> {
  const c = parseInput(NewContactInput, input);
  const { data, error } = await db
    .from("contacts")
    .insert({ organization_id: organizationId, company_id: c.companyId ?? null, name: c.name, role: c.role, location: c.location, bio: c.bio, external_ref: c.externalRef ?? null })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return IdRow.parse(data).id;
}

export const NewRelationshipInput = z
  .object({
    contactAId: z.uuid(),
    contactBId: z.uuid(),
    encounter: z
      .object({
        event: Text(200).default(""),
        location: Text(200).default(""),
        at: z.iso.datetime({ offset: true }).optional(),
        note: Text(2000).default(""),
      })
      .default({ event: "", location: "", note: "" }),
    visibility: VisibilitySchema.default("connection"),
    externalRef: ExternalRef,
  })
  .refine((r) => r.contactAId !== r.contactBId, "A relationship needs two different contacts.");

export async function createRelationship(db: Db, organizationId: string, input: z.input<typeof NewRelationshipInput>): Promise<string> {
  const r = parseInput(NewRelationshipInput, input);
  const { data, error } = await db
    .from("relationships")
    .insert({
      organization_id: organizationId,
      contact_a_id: r.contactAId,
      contact_b_id: r.contactBId,
      encounter_event: r.encounter.event,
      encounter_location: r.encounter.location,
      encountered_at: r.encounter.at ?? null,
      encounter_note: r.encounter.note,
      visibility: r.visibility,
      external_ref: r.externalRef ?? null,
    })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return IdRow.parse(data).id;
}
