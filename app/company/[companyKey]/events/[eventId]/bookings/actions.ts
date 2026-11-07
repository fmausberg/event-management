"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/db/prisma";
import { MemberAccessError } from "@/lib/companies/members";
import { requireBookingEvent } from "@/lib/bookings/management";
import { bookingSchema, type BookingState } from "@/lib/bookings/validation";
import { issueBookingTickets } from "@/lib/bookings/fulfillment";
import { deliverTicketMail } from "@/lib/tickets/outbox";
function refresh(slug: string, eventId: string) {
 revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}`);
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
 let initialMailId: string | undefined;
 try {
  await requireBookingEvent(slug, eventId);
  if (id !== null && !validId(id)) return { message: "Ungültige Buchung." };
  const parsed = bookingSchema.safeParse(Object.fromEntries(Object.keys(bookingSchema.shape).map((key) => [key, form.get(key)])));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  if (id === null) {
   if (!parsed.data.customerName || !parsed.data.customerEmail) return { message: "Bitte gib Name und E-Mail-Adresse für die Buchungsbestätigung an." };
   if (parsed.data.status !== "CONFIRMED") return { message: "Neue kostenlose Buchungen müssen bestätigt sein." };
   if (parsed.data.quantity > 100) return { message: "Pro Buchung können höchstens 100 Tickets erstellt werden." };
  }
  const result = await getPrisma().$transaction(async (tx) => {
   const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { maxSeats: true, companyId: true, name: true, beginsAt: true, status: true, ticketPrice: true, currency: true } });
   if (id === null && event.status === "CANCELLED") return { message: "Für ein storniertes Veranstaltung können keine Tickets erstellt werden." };
   const existing = id === null ? null : await tx.booking.findFirst({ where: { id, eventId }, select: { id: true, quantity: true, status: true, price: { select: { bookingId: true } }, voucherRedemption: { select: { id: true } }, voucherBalanceUses: { select: { id: true } }, payment: { select: { id: true } }, cancellationRequests: { where: { status: { in: ["PENDING", "APPROVED"] } }, select: { id: true } } } });
   if (id !== null && !existing) return { message: "Diese Buchung gehört nicht zu dieser Veranstaltung oder existiert nicht mehr." };
   if (existing?.cancellationRequests?.length) return { message: "Diese Buchung hat einen Stornierungsvorgang. Bitte verwende die Stornierungsverwaltung." };
   if (existing?.price || existing?.voucherRedemption || existing?.voucherBalanceUses?.length) return { message: "Buchungen mit Preis- oder Gutscheinhistorie können nur über die Stornierungsverwaltung rückabgewickelt werden." };
   if (existing?.payment) return { message: "Stripe-Buchungen können hier nicht geändert werden. Erstattungen bitte in der Stornierungsverwaltung durchführen." };
   const previousSeats = existing?.status === "CONFIRMED" ? existing.quantity : 0;
   const nextSeats = parsed.data.status === "CONFIRMED" ? parsed.data.quantity : 0;
   if (nextSeats > previousSeats) {
    const reserved = await tx.booking.aggregate({ where: { eventId, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] }, ...(id ? { id: { not: id } } : {}) }, _sum: { quantity: true } });
    if ((reserved._sum.quantity ?? 0) + nextSeats > (event.maxSeats ?? 0)) return { message: "Für diese Buchung sind nicht genügend freie Plätze vorhanden." };
   }
   if (id === null) {
    if (event.ticketPrice == null) return { message: "Bitte hinterlege zuerst den Listenpreis der Veranstaltung (bei kostenlosen Veranstaltungen 0 Euro)." };
    const unitPriceMinor = Number(event.ticketPrice.times(100).toFixed(0));
    const originalAmountMinor = unitPriceMinor * parsed.data.quantity;
    if (!Number.isSafeInteger(originalAmountMinor) || originalAmountMinor < 0 || originalAmountMinor > 2147483647) return { message: "Der Gesamtlistenpreis ist zu hoch oder ungültig." };
    const booking = await tx.booking.create({ data: { ...parsed.data, eventId, platform: null, externalBookingId: null } });
    await tx.bookingPrice.create({ data: {
     bookingId: booking.id, eventId, companyId: event.companyId, currency: event.currency,
     unitPriceMinor, quantity: booking.quantity, originalAmountMinor, discountAmountMinor: originalAmountMinor,
     voucherAmountMinor: 0, payableAmountMinor: 0, calculationVersion: 1,
    } });
    const mail = await issueBookingTickets(tx, booking, event);
    return { success: true, initialMailId: mail.id };
   } else await tx.booking.updateMany({ where: { id, eventId }, data: parsed.data });
   return { success: true, message: "Buchung wurde gespeichert." };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.success) return result;
  initialMailId = result.initialMailId;
 } catch (error) { return failure(error); }
 let delivered = false;
 if (initialMailId) {
  try { delivered = await deliverTicketMail(initialMailId); } catch { /* Durable outbox retries without recreating the booking. */ }
 }
 refresh(slug, eventId);
 if (initialMailId) return { success: true, message: delivered
  ? "Kostenlose Buchung und Tickets wurden erstellt. Die Buchungsbestätigung wurde versendet."
  : "Kostenlose Buchung und Tickets wurden erstellt. Die Buchungsbestätigung ist zum Versand vorgemerkt." };
 return { success: true, message: "Buchung wurde gespeichert." };
}
export async function deleteBooking(slug: string, eventId: string, id: string, _previous: BookingState, form: FormData): Promise<BookingState> {
 try {
  await requireBookingEvent(slug, eventId);
  if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen." };
  const result = await getPrisma().booking.deleteMany({ where: { id, eventId, payment: { is: null }, price: { is: null }, voucherRedemption: { is: null }, voucherBalanceUses: { none: {} }, cancellationRequests: { none: {} } } });
  if (!result.count) return { message: "Diese Buchung ist nicht löschbar: nicht gefunden oder durch Zahlungs-, Preis-, Gutschein- oder Stornohistorie geschützt." };
 } catch (error) { return failure(error); }
 refresh(slug, eventId);
 return { success: true, message: "Buchung wurde gelöscht." };
}
