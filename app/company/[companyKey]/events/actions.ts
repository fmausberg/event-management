"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { eventSchema, emptyEvent, type EventState } from "@/lib/company-events/model";
function refresh(slug: string) {
 revalidatePath(`/company/${encodeURIComponent(slug)}/trainers`);
 revalidatePath("/events/[companySlug]/[eventId]", "page");
 for (const path of [`/company/${encodeURIComponent(slug)}/events`, `/company/${encodeURIComponent(slug)}/event-series`, `/company/${encodeURIComponent(slug)}/venues`, "/admin/companies", "/admin/events", "/events", `/events/${encodeURIComponent(slug)}`]) revalidatePath(path);
}
function failure(error: unknown): EventState {
 if (error instanceof MemberAccessError) return { message: error.message };
 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { message: "Das Event ist noch verknüpft oder eine Zuordnung wurde geändert. Bitte lade die Seite neu." };
 return { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };
}
function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 191; }
export async function saveEvent(slug: string, id: string | null, _previous: EventState, form: FormData): Promise<EventState> {
 try {
  const { company } = await requireCompanyAccess(slug);
  if (id !== null && !validId(id)) return { message: "Ungültiges Event." };
  const parsed = eventSchema.safeParse(Object.fromEntries(Object.keys(emptyEvent).map((key) => [key, key === "trainerIds" ? form.getAll(key) : form.get(key)])));
  if (!parsed.success) return { message: "Bitte korrigiere die markierten Felder.", errors: parsed.error.flatten().fieldErrors };
  const db = getPrisma();
  const { eventSeriesId, venueId } = parsed.data;
  if (eventSeriesId && !await db.eventSeries.findFirst({ where: { id: eventSeriesId, companyId: company.id }, select: { id: true } })) return { message: "Bitte wähle eine Eventreihe dieser Company." };
  if (venueId && !await db.venue.findFirst({ where: { id: venueId, companyId: company.id }, select: { id: true } })) return { message: "Bitte wähle eine Venue dieser Company." };
  const { trainerIds, ...fields } = parsed.data;
  const trainers = await db.trainer.findMany({ where: { id: { in: trainerIds }, companyId: company.id }, select: { id: true } });
  if (trainers.length !== trainerIds.length) return { message: "Bitte wähle Trainer dieser Company.", errors: { trainerIds: ["Mindestens ein Trainer ist nicht verfügbar."] } };
  const data = { ...fields, trainerName: null, beginsAt: new Date(parsed.data.beginsAt), endsAt: new Date(parsed.data.endsAt) };
  if (id === null) {
   const session = await auth();
   if (!session?.user?.id) return { message: "Bitte melde dich erneut an." };
   await db.event.create({ data: { ...data, companyId: company.id, createdById: session.user.id, trainers: { create: trainerIds.map((trainerId) => ({ trainerId })) } } });
  } else {
   const result = await db.$transaction(async (tx) => {
    const updated = await tx.event.updateMany({ where: { id, companyId: company.id }, data });
    if (!updated.count) return updated;
    await tx.eventTrainer.deleteMany({ where: { eventId: id, trainerId: { notIn: trainerIds } } });
    if (trainerIds.length) await tx.eventTrainer.createMany({ data: trainerIds.map((trainerId) => ({ eventId: id, trainerId })), skipDuplicates: true });
    return updated;
   }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
   if (!result.count) return { message: "Dieses Event existiert nicht in dieser Company." };
  }
 } catch (error) { return failure(error); }
 refresh(slug);
 return { success: true, message: id === null ? "Event wurde erstellt." : "Event wurde gespeichert." };
}
export async function deleteEvent(slug: string, id: string, _previous: EventState, form: FormData): Promise<EventState> {
 try {
  const { company } = await requireCompanyAccess(slug);
  if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen." };
  const result = await getPrisma().event.deleteMany({ where: { id, companyId: company.id, bookings: { none: {} }, platformEvents: { none: {} } } });
  if (!result.count) return { message: "Das Event hat noch Buchungen oder Plattformzuordnungen oder existiert nicht in dieser Company." };
 } catch (error) { return failure(error); }
 refresh(slug);
 return { success: true, message: "Event wurde gelöscht." };
}
