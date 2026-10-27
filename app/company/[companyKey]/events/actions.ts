"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { eventSchema, publishEventSchema, emptyEvent, type EventState } from "@/lib/company-events/model";
import { uploadEventImage, deleteEventImage, EventImageError, type UploadedEventImage } from "@/lib/events/images";
function refresh(slug: string) {
 revalidatePath("/company/[companyKey]/event-series/[seriesId]", "page");
 revalidatePath("/account/events");
 revalidatePath(`/company/${encodeURIComponent(slug)}/trainers`);
 revalidatePath("/events/[companySlug]/[eventId]", "page");
 for (const path of [`/company/${encodeURIComponent(slug)}/events`, `/company/${encodeURIComponent(slug)}/event-series`, `/company/${encodeURIComponent(slug)}/venues`, "/admin/companies", "/admin/events", "/events", `/events/${encodeURIComponent(slug)}`]) revalidatePath(path);
}
function failure(error: unknown): EventState {
 if (error instanceof MemberAccessError) return { message: error.message };
 if (error instanceof EventImageError) return { message: error.message };
 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { message: "Das Event ist noch verknüpft oder eine Zuordnung wurde geändert. Bitte lade die Seite neu." };
 return { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };
}
function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 191; }
export async function saveEvent(slug: string, id: string | null, _previous: EventState, form: FormData): Promise<EventState> {
 const intent = form.get("intent") ?? (id === null ? "draft" : "save");
 if (intent === "cancel") return cancelEvent(slug, id);
 if (!["draft", "publish", "save"].includes(String(intent))) return { message: "Ungültige Aktion." };
 let uploaded: UploadedEventImage | undefined;
 let saved = false;
 try {
  const { company } = await requireCompanyAccess(slug);
  if (id !== null && !validId(id)) return { message: "Ungültiges Event." };
  const db = getPrisma();
  const existing = id === null ? null : await db.event.findFirst({ where: { id, companyId: company.id }, select: { status: true, imageUrl: true } });
  if (id !== null && (!existing || (intent !== "save" && existing.status !== "DRAFT"))) return { message: "Das Event ist nicht verfügbar. Bitte lade die Seite neu." };
  const schema = intent === "publish" || existing?.status === "PUBLISHED" ? publishEventSchema : eventSchema;
  const parsed = schema.safeParse(Object.fromEntries(Object.keys(emptyEvent).map((key) => [key, key === "currency" ? "EUR" : key === "status" ? "DRAFT" : key === "trainerIds" ? form.getAll(key) : form.get(key) ?? ""])));
  if (!parsed.success) return { message: "Bitte korrigiere die markierten Felder.", errors: parsed.error.flatten().fieldErrors };
  if (intent === "publish" && new Date(parsed.data.endsAt) <= new Date()) return { message: "Ein bereits beendetes Event kann nicht veröffentlicht werden.", errors: { endsAt: ["Das Ende muss für die Veröffentlichung in der Zukunft liegen."] } };
  const { eventSeriesId, venueId } = parsed.data;
  const series = eventSeriesId ? await db.eventSeries.findFirst({ where: { id: eventSeriesId, companyId: company.id }, select: { id: true, imageUrl: true } }) : null;
  if (eventSeriesId && !series) return { message: "Bitte wähle eine Eventreihe dieser Company." };
  if (venueId && !await db.venue.findFirst({ where: { id: venueId, companyId: company.id }, select: { id: true } })) return { message: "Bitte wähle eine Venue dieser Company." };
  const { trainerIds, status: ignoredStatus, ...fields } = parsed.data;
  void ignoredStatus;
  const trainers = await db.trainer.findMany({ where: { id: { in: trainerIds }, companyId: company.id }, select: { id: true } });
  if (trainers.length !== trainerIds.length) return { message: "Bitte wähle Trainer dieser Company.", errors: { trainerIds: ["Mindestens ein Trainer ist nicht verfügbar."] } };
  const file = form.get("coverImage");
  const hasUpload = file instanceof File && file.size > 0;
  const removeImage = form.get("removeImage") === "yes";
  if (file !== null && !(file instanceof File)) return { message: "Ungültige Bilddatei." };
  if (hasUpload && removeImage) return { message: "Bitte entweder ein Bild auswählen oder das vorhandene entfernen." };
  if (intent === "publish" && form.get("confirmMissingOptional") !== "yes") {
   const warnings: string[] = [];
   if (!hasUpload && (removeImage || !(id === null ? series?.imageUrl : existing?.imageUrl))) warnings.push("Titelbild");
   if (!trainerIds.length) warnings.push("Trainer");
   if (!parsed.data.description) warnings.push("Beschreibung");
   if (warnings.length) return { warnings, message: "Möchtest du die fehlenden Angaben noch ergänzen?" };
  }
  if (hasUpload) uploaded = await uploadEventImage(company.id, file);
  const data = { ...fields, ...(uploaded ?? (removeImage ? { imageUrl: null, imagePublicId: null } : id === null && series ? { imageUrl: series.imageUrl, imagePublicId: null } : {})), trainerName: null, beginsAt: parsed.data.beginsAt ? new Date(parsed.data.beginsAt) : null, endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null };
  if (id === null) {
   const session = await auth();
   if (!session?.user?.id) return { message: "Bitte melde dich erneut an." };
   await db.event.create({ data: { ...data, status: intent === "publish" ? "PUBLISHED" : "DRAFT", companyId: company.id, createdById: session.user.id, trainers: { create: trainerIds.map((trainerId) => ({ trainerId })) } } });
  } else {
   const result = await db.$transaction(async (tx) => {
    const current = await tx.event.findFirst({ where: { id, companyId: company.id }, select: { status: true, imagePublicId: true } });
    if (!current || current.status !== existing?.status || (intent !== "save" && current.status !== "DRAFT")) return { count: 0 };
    const updated = await tx.event.updateMany({ where: { id, companyId: company.id, status: current.status }, data: { ...data, status: intent === "publish" ? "PUBLISHED" : current.status } });
    if (!updated.count) return updated;
    await tx.eventTrainer.deleteMany({ where: { eventId: id, trainerId: { notIn: trainerIds } } });
    if (trainerIds.length) await tx.eventTrainer.createMany({ data: trainerIds.map((trainerId) => ({ eventId: id, trainerId })), skipDuplicates: true });
    return updated;
   }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
   if (!result.count) return { message: "Das Event existiert nicht in dieser Company oder sein Status hat sich geändert. Bitte lade die Seite neu." };
  }
  saved = true;
 } catch (error) { return failure(error); }
 finally { if (uploaded && !saved) await deleteEventImage(uploaded.imagePublicId); }
 refresh(slug);
 return { success: true, message: intent === "publish" ? "Event wurde veröffentlicht." : id === null ? "Entwurf wurde erstellt." : "Event wurde gespeichert." };
}
async function cancelEvent(slug: string, id: string | null): Promise<EventState> {
 try {
  const { company } = await requireCompanyAccess(slug);
  if (!validId(id)) return { message: "Ungültiges Event." };
  const result = await getPrisma().event.updateMany({ where: { id, companyId: company.id, status: "PUBLISHED", endsAt: { gt: new Date() } }, data: { status: "CANCELLED" } });
  if (!result.count) return { message: "Nur veröffentlichte, noch nicht beendete Events können abgesagt werden. Bitte lade die Seite neu." };
 } catch (error) { return failure(error); }
 refresh(slug);
 return { success: true, message: "Event wurde abgesagt." };
}
export async function deleteEvent(slug: string, id: string, _previous: EventState, form: FormData): Promise<EventState> {
 try {
  const { company } = await requireCompanyAccess(slug);
  if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen." };
  const result = await getPrisma().$transaction(async (tx) => {
   const deleted = await tx.event.deleteMany({ where: { id, companyId: company.id, bookings: { none: {} }, platformEvents: { none: {} } } });
   return deleted;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.count) return { message: "Das Event hat noch Buchungen oder Plattformzuordnungen oder existiert nicht in dieser Company." };
 } catch (error) { return failure(error); }
 refresh(slug);
 return { success: true, message: "Event wurde gelöscht." };
}
