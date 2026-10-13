"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { venueSchema, type VenueState } from "@/lib/venues/validation";

function refresh(slug: string) {
  revalidatePath(`/company/${encodeURIComponent(slug)}/venues`);
  revalidatePath(`/company/${encodeURIComponent(slug)}/event-series`);
  revalidatePath("/admin/companies");
}
function failure(error: unknown): VenueState {
  if (error instanceof MemberAccessError) return { message: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { message: "Verknüpfte Datensätze haben sich geändert. Bitte lade die Seite neu." };
  return { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };
}
function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 191; }

export async function saveVenue(slug: string, id: string | null, _previous: VenueState, form: FormData): Promise<VenueState> {
  try {
    const { company } = await requireCompanyAccess(slug);
    if (id !== null && !validId(id)) return { message: "Ungültige Venue." };
    const parsed = venueSchema.safeParse(Object.fromEntries(Object.keys(venueSchema.shape).map((key) => [key, form.get(key)])));
    if (!parsed.success) return { message: "Bitte korrigiere die markierten Felder.", errors: parsed.error.flatten().fieldErrors };
    const db = getPrisma();
    if (id === null) {
      await db.venue.create({ data: { ...parsed.data, companyId: company.id } });
    } else {
      const result = await db.venue.updateMany({ where: { id, companyId: company.id }, data: parsed.data });
      if (!result.count) return { message: "Diese Venue existiert nicht in dieser Company." };
    }
  } catch (error) { return failure(error); }
  refresh(slug);
  return { success: true, message: id === null ? "Venue wurde erstellt." : "Venue wurde gespeichert." };
}

export async function deleteVenue(slug: string, id: string, _previous: VenueState, form: FormData): Promise<VenueState> {
  try {
    const { company } = await requireCompanyAccess(slug);
    if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen einer gültigen Venue." };
    const result = await getPrisma().venue.deleteMany({ where: { id, companyId: company.id, events: { none: {} }, suggestedForSeries: { none: {} } } });
    if (!result.count) return { message: "Die Venue hat noch Events oder Eventserien oder existiert nicht in dieser Company." };
  } catch (error) { return failure(error); }
  refresh(slug);
  return { success: true, message: "Venue wurde gelöscht." };
}
