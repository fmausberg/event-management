"use server";
import { withSessionAudit } from "@/lib/audit/session";
import { sanitizeDescription } from "@/lib/descriptions/html";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { eventSchema, publishEventSchema, emptyEvent, type EventState } from "@/lib/company-events/model";
import { uploadEventImage, deleteEventImage, EventImageError, type UploadedEventImage } from "@/lib/events/images";
import { requestTrainerReminderNow } from "@/lib/trainers/reminders";
import { calendarRange, parseBatchSchedule, type BatchOccurrence } from "@/lib/company-events/batch-schedule";
import { occupiedSeriesDates } from "@/lib/company-events/batch-conflicts";
export type TrainerReminderActionState = { success?: boolean; sent?: boolean; sentAt?: string | null; message?: string };
function refresh(slug: string) {
 revalidatePath("/company/[companyKey]/events/[eventId]", "page");
 revalidatePath("/company/[companyKey]/event-series/[seriesId]", "page");
 revalidatePath("/account/eventmanagement");
 revalidatePath("/account/bookings");
 revalidatePath("/account");
 revalidatePath(`/company/${encodeURIComponent(slug)}/trainers`);
 revalidatePath("/events/[companySlug]/[eventId]", "page");
 for (const path of [`/company/${encodeURIComponent(slug)}/events`, `/company/${encodeURIComponent(slug)}/event-series`, `/company/${encodeURIComponent(slug)}/venues`, "/admin/companies", "/admin/events", "/events", `/events/${encodeURIComponent(slug)}`]) revalidatePath(path);
}
function failure(error: unknown): EventState {
 if (error instanceof MemberAccessError) return { message: error.message };
 if (error instanceof EventImageError) return { message: error.message };
 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { message: "Die Daten wurden gleichzeitig geändert. Es wurde nichts gespeichert. Bitte prüfe die Termine und versuche es erneut." };
 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { message: "Die Veranstaltung ist noch verknüpft oder eine Zuordnung wurde geändert. Bitte lade die Seite neu." };
 return { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };
}
function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 191; }
export async function getSeriesDateConflicts(slug: string, seriesId: string, from: string, to: string): Promise<{ dates: string[]; message?: string }> {
 try {
  const { company } = await requireCompanyAccess(slug);
  if (!validId(seriesId) || !calendarRange(from, to).length) return { dates: [], message: "Bitte einen gültigen Zeitraum von höchstens 366 Tagen auswählen." };
  const db = getPrisma();
  if (!await db.eventSeries.findFirst({ where: { id: seriesId, companyId: company.id }, select: { id: true } })) return { dates: [], message: "Bitte wähle eine Veranstaltungsreihe dieser Company." };
  return { dates: await occupiedSeriesDates(db, company.id, seriesId, from, to) };
 } catch (error) { return { dates: [], message: failure(error).message }; }
}
export async function saveEvent(slug: string, id: string | null, _previous: EventState, form: FormData): Promise<EventState> {
  return withSessionAudit("company/[companyKey]/events.saveEvent", async () => {
 const intent = form.get("intent") ?? (id === null ? "draft" : "save");
 const multiple = form.get("creationMode") === "multiple";
 if (multiple && (id !== null || !["draft", "publish"].includes(String(intent)))) return { message: "Mehrfacherstellung ist nur für neue Veranstaltungen möglich." };
 if (intent === "cancel") return cancelEvent(slug, id);
 if (!["draft", "publish", "save"].includes(String(intent))) return { message: "Ungültige Aktion." };
 let uploaded: UploadedEventImage | undefined;
 let saved = false;
 let createdCount = 0;
 let createdId: string | undefined;
 try {
  const { company } = await requireCompanyAccess(slug);
  if (id !== null && !validId(id)) return { message: "Ungültige Veranstaltung." };
  const db = getPrisma();
  const existing = id === null ? null : await db.event.findFirst({ where: { id, companyId: company.id }, select: { status: true, imageUrl: true } });
  if (id !== null && (!existing || (intent !== "save" && existing.status !== "DRAFT"))) return { message: "Die Veranstaltung ist nicht verfügbar. Bitte lade die Seite neu." };
  const schema = intent === "publish" || existing?.status === "PUBLISHED" ? publishEventSchema : eventSchema;
  let occurrences: BatchOccurrence[] = [];
  if (multiple) {
   if (!validId(form.get("eventSeriesId"))) return { message: "Bitte zuerst eine Veranstaltungsreihe auswählen." };
   const schedule = parseBatchSchedule(form);
   if (schedule.message) return { message: schedule.message, dateErrors: schedule.dateErrors };
   occurrences = schedule.occurrences;
  }
  const raw = Object.fromEntries(Object.keys(emptyEvent).map((key) => [key, key === "currency" ? "EUR" : key === "status" ? "DRAFT" : key === "trainerIds" ? form.getAll(key) : form.get(key) ?? ""]));
  const parsed = schema.safeParse({ ...raw, ...(multiple ? { beginsAt: occurrences[0].beginsAt, endsAt: occurrences[0].endsAt } : {}) });
  if (!parsed.success) return { message: "Bitte korrigiere die markierten Felder.", errors: parsed.error.flatten().fieldErrors };
  parsed.data.description = sanitizeDescription(parsed.data.description);
  if (multiple) {
   const dateErrors: Record<string, string> = {};
   const now = new Date();
   for (const occurrence of occurrences) {
    const validation = schema.safeParse({ ...raw, beginsAt: occurrence.beginsAt, endsAt: occurrence.endsAt });
    if (!validation.success) dateErrors[occurrence.date] = validation.error.issues.map(issue => issue.message).join(" ");
    else if (intent === "publish" && new Date(occurrence.endsAt) <= now) dateErrors[occurrence.date] = "Ein bereits beendetes Veranstaltung kann nicht veröffentlicht werden.";
   }
   if (Object.keys(dateErrors).length) return { message: "Nicht alle Termine können gespeichert werden. Bitte die markierten Termine prüfen.", dateErrors };
  }
  if (intent === "publish" && new Date(parsed.data.endsAt) <= new Date()) return { message: "Ein bereits beendetes Veranstaltung kann nicht veröffentlicht werden.", errors: { endsAt: ["Das Ende muss für die Veröffentlichung in der Zukunft liegen."] } };
  const { eventSeriesId, venueId } = parsed.data;
  const series = eventSeriesId ? await db.eventSeries.findFirst({ where: { id: eventSeriesId, companyId: company.id }, select: { id: true, imageUrl: true } }) : null;
  if (eventSeriesId && !series) return { message: "Bitte wähle eine Veranstaltungsreihe dieser Company." };
  if (venueId && !await db.venue.findFirst({ where: { id: venueId, companyId: company.id }, select: { id: true } })) return { message: "Bitte wähle einen Ort dieser Company." };
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
   const creationData = { ...data, status: intent === "publish" ? "PUBLISHED" as const : "DRAFT" as const, companyId: company.id, createdById: session.user.id, trainers: { create: trainerIds.map((trainerId) => ({ trainerId })) } };
   if (multiple) {
    const actorId = session.user.id;
    const result = await db.$transaction(async (tx): Promise<EventState> => {
     const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
     if (!actor) throw new MemberAccessError("UNAUTHENTICATED");
     if (actor.role !== "ADMIN") {
      const member = await tx.companyMembership.findUnique({ where: { companyId_userId: { companyId: company.id, userId: actorId } }, select: { role: true, status: true } });
      if (member?.status !== "ACTIVE" || !["COMPANY_ADMIN", "COMPANY_USER"].includes(member.role)) throw new MemberAccessError("FORBIDDEN");
     }
     const currentSeries = await tx.eventSeries.findFirst({ where: { id: eventSeriesId!, companyId: company.id }, select: { id: true, imageUrl: true } });
     if (!currentSeries) return { message: "Die ausgewählte Veranstaltungsreihe ist nicht mehr verfügbar." };
     if (venueId && !await tx.venue.findFirst({ where: { id: venueId, companyId: company.id }, select: { id: true } })) return { message: "Bitte wähle einen Ort dieser Company." };
     const currentTrainers = await tx.trainer.findMany({ where: { id: { in: trainerIds }, companyId: company.id }, select: { id: true } });
     if (currentTrainers.length !== trainerIds.length) return { message: "Mindestens ein Trainer ist nicht mehr verfügbar.", errors: { trainerIds: ["Bitte die Trainerzuordnung prüfen."] } };
     if (!hasUpload && !removeImage && currentSeries.imageUrl !== series?.imageUrl) return { message: "Das Bild der Reihe wurde geändert. Bitte die Auswahl prüfen und erneut speichern." };
     if (intent === "publish" && occurrences.some(item => new Date(item.endsAt) <= new Date())) return { message: "Mindestens ein Termin ist inzwischen beendet. Bitte die Auswahl prüfen. Es wurde nichts angelegt." };
     for (const occurrence of occurrences) await tx.event.create({ data: { ...creationData, beginsAt: new Date(occurrence.beginsAt), endsAt: occurrence.endsAt ? new Date(occurrence.endsAt) : null } });
     return { success: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    if (!result.success) return result;
    createdCount = occurrences.length;
   } else {
    const created = await db.event.create({ data: creationData, select: { id: true } });
    createdId = created.id;
   }
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
   if (!result.count) return { message: "Die Veranstaltung existiert nicht in dieser Company oder sein Status hat sich geändert. Bitte lade die Seite neu." };
  }
  saved = true;
 } catch (error) { return failure(error); }
 finally { if (uploaded && !saved) await deleteEventImage(uploaded.imagePublicId); }
 refresh(slug);
 if (multiple) return { success: true, message: `${createdCount} Veranstaltungen wurden ${intent === "publish" ? "veröffentlicht" : "als Entwurf erstellt"}.` };
 return { success: true, id: createdId, message: intent === "publish" ? "Veranstaltung wurde veröffentlicht." : id === null ? "Entwurf wurde erstellt." : "Veranstaltung wurde gespeichert." };

  });
}
async function cancelEvent(slug: string, id: string | null): Promise<EventState> {
 try {
  const { company } = await requireCompanyAccess(slug);
  if (!validId(id)) return { message: "Ungültige Veranstaltung." };
  const result = await getPrisma().event.updateMany({ where: { id, companyId: company.id, status: "PUBLISHED", endsAt: { gt: new Date() } }, data: { status: "CANCELLED" } });
  if (!result.count) return { message: "Nur veröffentlichte, noch nicht beendete Veranstaltungen können abgesagt werden. Bitte lade die Seite neu." };
 } catch (error) { return failure(error); }
 refresh(slug);
 return { success: true, message: "Veranstaltung wurde abgesagt." };
}
export async function deleteEvent(slug: string, id: string, _previous: EventState, form: FormData): Promise<EventState> {
  return withSessionAudit("company/[companyKey]/events.deleteEvent", async () => {
 try {
  const { company } = await requireCompanyAccess(slug);
  if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen." };
  const result = await getPrisma().$transaction(async (tx) => {
   const deleted = await tx.event.deleteMany({ where: { id, companyId: company.id, bookings: { none: {} }, platformEvents: { none: {} } } });
   return deleted;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.count) return { message: "Die Veranstaltung hat noch Buchungen oder Plattformzuordnungen oder existiert nicht in dieser Company." };
 } catch (error) { return failure(error); }
 refresh(slug);
 return { success: true, message: "Veranstaltung wurde gelöscht." };

  });
}

export async function sendTrainerInfo(slug: string, id: string, requestId: string, _previous: TrainerReminderActionState): Promise<TrainerReminderActionState> {
  void _previous;
  return withSessionAudit("company/[companyKey]/events.sendTrainerInfo", async () => {
 try {
  const { company } = await requireCompanyAccess(slug);
  if (!validId(id)) return { message: "Ungültige Veranstaltung." };
  const result = await requestTrainerReminderNow(id, company.id, requestId);
  if (!result.available) return { message: "Die veröffentlichte Veranstaltung ist nicht versandbereit. Prüfe Beginn und Trainerzuordnung." };
  refresh(slug);
  if (result.sent) return { success: true, sent: true, sentAt: result.sentAt, message: "Trainer-Info wurde versendet." };
  return { sent: false, message: "Der Versand wurde beauftragt, konnte aber noch nicht für alle Trainer abgeschlossen werden. Der Cron versucht es erneut." };
 } catch (error) { return { message: failure(error).message }; }

  });
}
