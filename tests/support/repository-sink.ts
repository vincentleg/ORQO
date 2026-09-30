import type { Db } from "@/lib/server/supabase/types";
import { createCapability, createCompany, createNeed, createSource } from "@/lib/server/repositories/companies";
import { createContact, createRelationship } from "@/lib/server/repositories/network";
import type { FixtureSink } from "./demo-fixture";

/** Writes a fixture through the production repositories, as the given signed-in user. */
export function repositorySink(db: Db, organizationId: string): FixtureSink {
  return {
    createSource: (i) => createSource(db, organizationId, i),
    createCompany: async (i) => (await createCompany(db, organizationId, i)).id,
    createCapability: (i) => createCapability(db, organizationId, i),
    createNeed: (i) => createNeed(db, organizationId, i),
    createContact: (i) => createContact(db, organizationId, i),
    createRelationship: (i) => createRelationship(db, organizationId, i),
  };
}
