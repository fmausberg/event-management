"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { seriesSchema, type SeriesState } from "@/lib/event-series/validation";

import { uploadEventImage, deleteEventImage, EventImageError, type UploadedEventImage } from "@/lib/events/images";

function refresh(slug: string) {
 revalidatePath("/company/[companyKey]/event-series/[seriesId]", "page");
  revalidatePath(`/company/${encodeURIComponent(slug)}/trainers`);
  revalidatePath(`/company/${encodeURIComponent(slug)}/events`);
  revalidatePath(`/company/${encodeURIComponent(slug)}/event-series`);
  revalidatePath("/admin/companies");
}
function failure(error: unknown): SeriesState {
  if (error instanceof EventImageError) return { message: error.message };
  if (error instanceof MemberAccessError) return { message: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { message: "Verknüpfte Datensätze haben sich geändert. Bitte lade die Seite neu." };
  return { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };
}
function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 191; }

export async function saveSeries(slug: string, id: string | null, _previous: SeriesState, form: FormData): Promise<SeriesState> {
  let uploaded: UploadedEventImage | undefined;
  let saved = false;
  try {
    const { company } = await requireCompanyAccess(slug);
    if (id !== null && !validId(id)) return { message: "Ungültige Eventserie." };
    const parsed = seriesSchema.safeParse(Object.fromEntries(Object.keys(seriesSchema.shape).map((key) => [key, key === "suggestedCurrency" ? "EUR" : key === "imageUrl" ? "" : form.get(key)])));
    if (!parsed.success) return { message: "Bitte korrigiere die markierten Felder.", errors: parsed.error.flatten().fieldErrors };
    const db = getPrisma();
    if (parsed.data.suggestedVenueId && !await db.venue.findFirst({ where: { id: parsed.data.suggestedVenueId, companyId: company.id }, select: { id: true } })) return { message: "Bitte wähle eine Venue dieser Company.", errors: { suggestedVenueId: ["Die Venue gehört nicht zu dieser Company."] } };
    if (parsed.data.suggestedTrainerId && !await db.trainer.findFirst({ where: { id: parsed.data.suggestedTrainerId, companyId: company.id }, select: { id: true } })) return { message: "Bitte wähle einen Trainer dieser Company.", errors: { suggestedTrainerId: ["Der Trainer ist nicht verfügbar."] } };
    const file = form.get("coverImage");
    const removeImage = form.get("removeImage") === "yes";
    if (file !== null && !(file instanceof File)) return { message: "Ungültige Bilddatei." };
    const hasUpload = file instanceof File && file.size > 0;
    if (hasUpload && removeImage) return { message: "Bitte ein Bild auswählen oder das vorhandene entfernen." };
    if (hasUpload && id !== null && !await db.eventSeries.findFirst({ where: { id, companyId: company.id }, select: { id: true } })) return { message: "Diese Eventserie ist nicht verfügbar." };
    if (hasUpload) uploaded = await uploadEventImage(company.id, file);
    const { imageUrl: ignoredImageUrl, ...fields } = parsed.data;
    void ignoredImageUrl;
    const data = { ...fields, ...(uploaded ? { imageUrl: uploaded.imageUrl } : removeImage ? { imageUrl: null } : {}), suggestedTrainerName: null };
    if (id === null) {
      const session = await auth();
      if (!session?.user?.id) return { message: "Bitte melde dich erneut an." };
      await db.eventSeries.create({ data: { ...data, companyId: company.id, createdById: session.user.id } });
    } else {
      const result = await db.eventSeries.updateMany({ where: { id, companyId: company.id }, data: { ...data } });
      if (!result.count) return { message: "Diese Eventserie existiert nicht in dieser Company." };
    }
    saved = true;
  } catch (error) { return failure(error); }
  finally { if (uploaded && !saved) await deleteEventImage(uploaded.imagePublicId); }
  refresh(slug);
  return { success: true, message: id === null ? "Eventserie wurde erstellt." : "Eventserie wurde gespeichert." };
}

export async function deleteSeries(slug: string, id: string, _previous: SeriesState, form: FormData): Promise<SeriesState> {
  try {
    const { company } = await requireCompanyAccess(slug);
    if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen einer gültigen Eventserie." };
    const result = await getPrisma().eventSeries.deleteMany({ where: { id, companyId: company.id, events: { none: {} } } });
    if (!result.count) return { message: "Die Eventserie hat noch Events oder existiert nicht in dieser Company." };
  } catch (error) { return failure(error); }
  refresh(slug);
  return { success: true, message: "Eventserie wurde gelöscht." };
}
