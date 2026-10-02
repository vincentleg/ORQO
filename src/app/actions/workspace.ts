"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translate";
import { getAuthContext, requireAuth } from "@/lib/server/auth/context";
import { ACTIVE_ORG_COOKIE, actionErrorKey } from "@/lib/server/auth/page";
import { getRequestLocale, rememberLocale } from "@/lib/server/i18n";
import { createCompany, splitProfileList, updateOwnCompanyProfile } from "@/lib/server/repositories/companies";
import { createOrganization, requireMembership, updateProfile } from "@/lib/server/repositories/tenancy";
import { addValidation, getOwnUnderstanding } from "@/lib/server/repositories/understanding";
import { AppError } from "@/lib/server/errors";
import { secureCookies } from "@/lib/server/site";

export interface ActionState {
  error?: MessageKey;
  ok?: boolean;
}

/** Phase 13: Secure on HTTPS production deployments (see src/lib/server/site.ts). */
const orgCookieOptions = () => ({ path: "/", sameSite: "lax" as const, httpOnly: true, secure: secureCookies(), maxAge: 60 * 60 * 24 * 365 });

export async function createOrganizationAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    const { db } = await requireAuth();
    id = await createOrganization(db, { name: String(form.get("name") ?? ""), defaultLocale: await getRequestLocale() });
  } catch (e) {
    return { error: actionErrorKey(e, "createOrganization") };
  }
  (await cookies()).set(ACTIVE_ORG_COOKIE, id, orgCookieOptions());
  redirect("/workspace");
}

/** The organization id in the form is only a lookup key; membership is verified before writing. */
export async function addCompanyAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireAuth();
    const membership = await requireMembership(db, user.id, String(form.get("organizationId") ?? ""), "member");
    const website = String(form.get("website") ?? "").trim();
    const summary = String(form.get("summary") ?? "").trim().slice(0, 4000);
    await createCompany(db, membership.organizationId, { name: String(form.get("name") ?? ""), networkOrigin: "manual", ...(website && { website }), ...(summary && { summary }) });
  } catch (e) {
    return { error: actionErrorKey(e, "addCompany") };
  }
  revalidatePath("/workspace", "layout");
  return { ok: true };
}

/** Creates the organization's own company (the Company Profile seed). At most one per organization, enforced by the database. */
export async function createOwnCompanyAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireAuth();
    const membership = await requireMembership(db, user.id, String(form.get("organizationId") ?? ""), "member");
    const website = String(form.get("website") ?? "").trim();
    await createCompany(db, membership.organizationId, {
      name: String(form.get("name") ?? ""),
      summary: String(form.get("summary") ?? ""),
      isOwnCompany: true,
      ...(website && { website }),
    });
  } catch (e) {
    return { error: actionErrorKey(e, "createOwnCompany") };
  }
  revalidatePath("/workspace", "layout");
  return { ok: true };
}

/** Updates the own-company profile. Membership (member+) is verified; the organization id is only a lookup key. */
export async function updateOwnCompanyAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireAuth();
    const membership = await requireMembership(db, user.id, String(form.get("organizationId") ?? ""), "member");
    const website = String(form.get("website") ?? "").trim();
    const list = (key: string) => splitProfileList(String(form.get(key) ?? ""));
    await updateOwnCompanyProfile(db, membership.organizationId, {
      name: String(form.get("name") ?? ""),
      website: website || null,
      summary: String(form.get("summary") ?? ""),
      offerings: list("offerings"),
      customerSegments: list("customerSegments"),
      markets: list("markets"),
      geographies: list("geographies"),
      soughtCapabilities: list("soughtCapabilities"),
      // Validated against the allowed relationship types by OwnProfileUpdate.
      partnershipGoals: form.getAll("partnershipGoals").map(String) as never,
    });
  } catch (e) {
    return { error: actionErrorKey(e, "updateOwnCompany") };
  }
  revalidatePath("/workspace", "layout");
  return { ok: true };
}

export async function selectOrganizationAction(form: FormData): Promise<void> {
  const { db, user } = await requireAuth();
  const membership = await requireMembership(db, user.id, String(form.get("organizationId") ?? ""));
  (await cookies()).set(ACTIVE_ORG_COOKIE, membership.organizationId, orgCookieOptions());
  redirect("/workspace");
}

/** Saves the language on the profile when signed in, and in a cookie for everyone. */
export async function setLocaleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = form.get("locale");
  if (!isLocale(locale)) return { error: "errors.invalidInput" };
  try {
    const ctx = await getAuthContext();
    if (ctx) await updateProfile(ctx.db, ctx.user.id, { locale });
  } catch (e) {
    return { error: actionErrorKey(e, "setLocale") };
  }
  await rememberLocale(locale);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Records one validation of the own company's understanding (Phase 14): confirm / reject an item, or answer the
 * next question. Membership (member+) is verified; the organization id is only a lookup key, the company is the
 * workspace's own company, and only items of its current understanding or ontology values can be written.
 */
export async function validateUnderstandingAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireAuth();
    const membership = await requireMembership(db, user.id, String(form.get("organizationId") ?? ""), "member");
    const current = await getOwnUnderstanding(db, membership.organizationId);
    if (!current) throw new AppError("not_found", "No company profile yet.");
    const kind = String(form.get("kind") ?? "");
    const raw = kind === "answer" ? { kind, dimension: String(form.get("dimension") ?? ""), values: form.getAll("values").map(String).includes("not_sure") ? ["not_sure"] : form.getAll("values").map(String) } : { kind, itemKey: String(form.get("itemKey") ?? "") };
    await addValidation(db, membership.organizationId, current.own.id, raw, current.understanding.dna);
  } catch (e) {
    return { error: actionErrorKey(e, "validateUnderstanding") };
  }
  // Phase 16B: the answer also changes Work (the question asked there) and every dossier.
  revalidatePath("/workspace", "layout");
  return { ok: true };
}
