"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/db/prisma";
import { MemberAccessError } from "@/lib/companies/members";
import { requireBookingEvent } from "@/lib/bookings/management";
import { bookingSchema, type BookingState } from "@/lib/bookings/validation";
function refresh(slug: string, eventId: string) {
 revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/bookings`);
 revalidatePath(`/company/${encodeURIComponent(slug)}/events`);
 revalidatePath("/admin/events");
 revalidatePath(`/events/${encodeURIComponent(slug)}/${encodeURIComponent(eventId)}`);
}
function failure(error: unknown): BookingState {
 if (error instanceof MemberAccessError) return { message: error.message };
 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { message: "Eine andere Buchung wurde gleichzeitig geändert. Bitte versuche es erneut." };
 return { message: "Die Buchung konnte nicht gespeichert werden. Bitte versuche es erneut." };
}
function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 191; }
export async function saveBooking(slug: string, eventId: string, id: string | null, _previous: BookingState, form: FormData): Promise<BookingState> {
 try {
  await requireBookingEvent(slug, eventId);
  if (id !== null && !validId(id)) return { message: "Ungültige Buchung." };
  const parsed = bookingSchema.safeParse(Object.fromEntries(Object.keys(bookingSchema.shape).map((key) => [key, form.get(key)])));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const result = await getPrisma().$transaction(async (tx) => {
   const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { maxSeats: true } });
   const existing = id === null ? null : await tx.booking.findFirst({ where: { id, eventId }, select: { id: true, quantity: true, status: true, payment: { select: { id: true } } } });
   if (id !== null && !existing) return { message: "Diese Buchung gehört nicht zu diesem Event oder existiert nicht mehr." };
   if (existing?.payment) return { message: "Stripe-Buchungen können hier nicht geändert werden. Erstattungen bitte im Stripe-Dashboard durchführen." };
   const previousSeats = existing?.status === "CONFIRMED" ? existing.quantity : 0;
   const nextSeats = parsed.data.status === "CONFIRMED" ? parsed.data.quantity : 0;
   if (nextSeats > previousSeats) {
    const reserved = await tx.booking.aggregate({ where: { eventId, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] }, ...(id ? { id: { not: id } } : {}) }, _sum: { quantity: true } });
    if ((reserved._sum.quantity ?? 0) + nextSeats > (event.maxSeats ?? 0)) return { message: "Für diese Buchung sind nicht genügend freie Plätze vorhanden." };
   }
   if (id === null) await tx.booking.create({ data: { ...parsed.data, eventId, platform: null, externalBookingId: null } });
   else await tx.booking.updateMany({ where: { id, eventId }, data: parsed.data });
   return { success: true, message: id === null ? "Buchung wurde erstellt." : "Buchung wurde gespeichert." };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.success) return result;
 } catch (error) { return failure(error); }
 refresh(slug, eventId);
 return { success: true, message: "Buchung wurde gespeichert." };
}
export async function deleteBooking(slug: string, eventId: string, id: string, _previous: BookingState, form: FormData): Promise<BookingState> {
 try {
  await requireBookingEvent(slug, eventId);
  if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen." };
  const result = await getPrisma().booking.deleteMany({ where: { id, eventId, payment: { is: null } } });
  if (!result.count) return { message: "Diese Buchung gehört nicht zu diesem Event oder wurde bereits entfernt." };
 } catch (error) { return failure(error); }
 refresh(slug, eventId);
 return { success: true, message: "Buchung wurde gelöscht." };
}
