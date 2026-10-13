"use server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/db/prisma";
import { emailSchema } from "@/lib/auth/validation";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import { readBookingToken } from "@/lib/bookings/public-token";
export type PublicBookingState = { success?: boolean; message?: string; number?: number };
const schema = z.object({
 name: z.string().trim().min(1, "Bitte gib deinen Namen ein.").max(160), email: emailSchema,
 quantity: z.string().regex(/^\d+$/, "Bitte gib eine gültige Platzanzahl ein.").transform(Number).pipe(z.number().int().min(1).max(2147483647)),
});
export async function bookPublicEvent(slug: string, eventId: string, _previous: PublicBookingState, form: FormData): Promise<PublicBookingState> {
 const parsed = schema.safeParse({ name: form.get("name"), email: form.get("email"), quantity: form.get("quantity") });
 if (!parsed.success) return { message: parsed.error.issues[0].message };
 const token = readBookingToken(form.get("token"));
 if (!token || token.eventId !== eventId) return { message: "Das Buchungsformular ist abgelaufen. Bitte lade die Seite neu." };
 if (form.get("website")) return { message: "Die Buchung konnte nicht verarbeitet werden." };
 let result: PublicBookingState;
 try {
  if (!await consumeAuthAttempt(parsed.data.email, "public-booking")) return { message: "Zu viele Buchungsversuche. Bitte versuche es in 15 Minuten erneut." };
  result = await getPrisma().$transaction(async (tx): Promise<PublicBookingState> => {
   const event = await tx.event.findFirst({ where: { id: eventId, company: { slug } }, select: { id: true, status: true, beginsAt: true, maxSeats: true, ticketPrice: true, currency: true } });
   if (!event) return { message: "Dieses Event ist nicht buchbar." };
   const existing = await tx.booking.findUnique({ where: { id: token.id }, select: { eventId: true, number: true } });
   if (existing?.eventId === eventId) return { success: true, number: existing.number, message: "Deine Buchung wurde bestätigt." };
   if (event.status !== "PUBLISHED" || event.beginsAt <= new Date()) return { message: "Dieses Event ist nicht mehr buchbar." };
   if (event.ticketPrice.toFixed(2) !== token.price || event.currency !== token.currency) return { message: "Der Preis wurde geändert. Bitte lade die Seite neu und prüfe den aktuellen Preis." };
   const reserved = await tx.booking.aggregate({ where: { eventId, status: "CONFIRMED" }, _sum: { quantity: true } });
   if ((reserved._sum.quantity ?? 0) + parsed.data.quantity > event.maxSeats) return { message: "Es sind nicht mehr genügend Plätze frei. Bitte wähle weniger Plätze oder lade die Seite neu." };
   const booking = await tx.booking.create({ data: { id: token.id, eventId, customerName: parsed.data.name, customerEmail: parsed.data.email, quantity: parsed.data.quantity, status: "CONFIRMED", platform: null, externalBookingId: null }, select: { number: true } });
   return { success: true, number: booking.number, message: "Deine Buchung wurde bestätigt." };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
 } catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) return { message: "Eine Buchung wurde gleichzeitig verarbeitet. Bitte klicke erneut auf Buchen; eine bereits gespeicherte Buchung wird nicht doppelt angelegt." };
  return { message: "Die Buchung konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut." };
 }
 if (result.success) {
  revalidatePath(`/events/${encodeURIComponent(slug)}/${encodeURIComponent(eventId)}`);
  revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/bookings`);
  revalidatePath(`/company/${encodeURIComponent(slug)}/events`);
 }
 return result;
}
