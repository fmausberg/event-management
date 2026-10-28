"use server";
import { z } from "zod";
import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { euroAmount, paymentOrigin } from "@/lib/payments/stripe";
import { refreshConnectAccount } from "@/lib/payments/connect";
import { ensureCheckout } from "@/lib/payments/checkout";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { emailSchema } from "@/lib/auth/validation";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import { readBookingToken } from "@/lib/bookings/public-token";
import { createTicketToken } from "@/lib/tickets/public-token";
import { TicketCodeError } from "@/lib/tickets/code-encryption";
import { ticketLink } from "@/lib/tickets/public-link";
import { deliverTicketMail, enqueueInitialTicketMail } from "@/lib/tickets/outbox";
import { bookingConfirmation } from "@/lib/mail/templates/booking-confirmation";
export type PublicBookingState = { success?: boolean; message?: string; number?: number; paymentId?: string };
const schema = z.object({
 name: z.string().trim().min(1, "Bitte gib deinen Namen ein.").max(160), email: emailSchema,
 quantity: z.string().regex(/^\d+$/, "Bitte gib eine gültige Platzanzahl ein.").transform(Number).pipe(z.number().int().min(1).max(100)),
});
export async function bookPublicEvent(slug: string, eventId: string, _previous: PublicBookingState, form: FormData): Promise<PublicBookingState> {
 const parsed = schema.safeParse({ name: form.get("name"), email: form.get("email"), quantity: form.get("quantity") });
 if (!parsed.success) return { message: parsed.error.issues[0].message };
 const token = readBookingToken(form.get("token"));
 if (!token || token.eventId !== eventId) return { message: "Das Buchungsformular ist abgelaufen. Bitte lade die Seite neu." };
 if (form.get("website")) return { message: "Die Buchung konnte nicht verarbeitet werden." };
 let result: PublicBookingState;
 let checkoutUrl: string | undefined;
 let initialMailId: string | undefined;
 try {
  if (!await consumeAuthAttempt(parsed.data.email, "public-booking")) return { message: "Zu viele Buchungsversuche. Bitte versuche es in 15 Minuten erneut." };
  const userId = (await auth())?.user?.id ?? null;
  // Check live capability outside the database transaction. No network calls under locks.
  if (token.price !== "0.00") {
   const companyEvent = await getPrisma().event.findFirst({ where: { id: eventId, company: { slug } }, select: { companyId: true, ticketPrice: true, currency: true } });
   if (!companyEvent || companyEvent.ticketPrice === null) return { message: "Dieses Event ist nicht buchbar." };
   if (companyEvent.ticketPrice.toFixed(2) !== token.price || companyEvent.currency !== token.currency) return { message: "Der Preis wurde geändert. Bitte lade die Seite neu und prüfe den aktuellen Preis." };
   const company = await refreshConnectAccount(companyEvent.companyId);
   if (!company.stripeAccountId || !company.stripeChargesEnabled || !company.stripePayoutsEnabled) return { message: "Der Veranstalter hat die Online-Zahlung noch nicht freigeschaltet." };
  }
  result = await getPrisma().$transaction(async (tx): Promise<PublicBookingState> => {
   const event = await tx.event.findFirst({ where: { id: eventId, company: { slug } }, select: { id: true, name: true, status: true, beginsAt: true, maxSeats: true, ticketPrice: true, currency: true, company: { select: { stripeAccountId: true, stripeChargesEnabled: true, stripePayoutsEnabled: true } } } });
   if (!event || !event.beginsAt || event.ticketPrice === null || event.maxSeats === null) return { message: "Dieses Event ist nicht buchbar." };
   const existing = await tx.booking.findUnique({ where: { id: token.id }, select: { eventId: true, number: true, status: true, payment: { select: { id: true } } } });
   if (existing?.eventId === eventId) {
    if (existing.status === "PENDING_PAYMENT" && existing.payment) return { paymentId: existing.payment.id };
    if (existing.status === "CONFIRMED") return { success: true, number: existing.number, message: "Deine Buchung wurde bestätigt." };
    return { message: "Diese Buchung ist abgelaufen oder storniert. Bitte lade die Seite neu." };
   }
   if (event.status !== "PUBLISHED" || event.beginsAt <= new Date()) return { message: "Dieses Event ist nicht mehr buchbar." };
   if (event.ticketPrice.toFixed(2) !== token.price || event.currency !== token.currency) return { message: "Der Preis wurde geändert. Bitte lade die Seite neu und prüfe den aktuellen Preis." };
   const reserved = await tx.booking.aggregate({ where: { eventId, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } }, _sum: { quantity: true } });
   if ((reserved._sum.quantity ?? 0) + parsed.data.quantity > event.maxSeats) return { message: "Es sind nicht mehr genügend Plätze frei. Bitte wähle weniger Plätze oder lade die Seite neu." };
   if (event.ticketPrice.toFixed(2) !== "0.00") {
    if (!event.company.stripeAccountId || !event.company.stripeChargesEnabled || !event.company.stripePayoutsEnabled) return { message: "Die Online-Zahlung ist derzeit nicht verfügbar." };
    const amount = euroAmount(event.ticketPrice.toFixed(2), event.currency, parsed.data.quantity);
    const paymentId = randomUUID();
    const publicToken = randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 35 * 60;
    const returnUrl = `${paymentOrigin()}/booking/payment/${publicToken}`;
    await tx.booking.create({ data: {
     id: token.id, eventId, userId, customerName: parsed.data.name, customerEmail: parsed.data.email,
     quantity: parsed.data.quantity, status: "PENDING_PAYMENT", reservedUntil: new Date(expiresAt * 1000),
     payment: { create: { id: paymentId, publicToken, stripeAccountId: event.company.stripeAccountId, amount, currency: event.currency,
      checkoutRequest: {
       mode: "payment", allowed_payment_method_types: ["card"], client_reference_id: token.id,
       customer_email: parsed.data.email, metadata: { paymentId }, payment_intent_data: { metadata: { paymentId } },
       expires_at: expiresAt, success_url: returnUrl, cancel_url: returnUrl,
       line_items: [{ price_data: { currency: event.currency.toLowerCase(), unit_amount: amount / parsed.data.quantity, product_data: { name: event.name } }, quantity: parsed.data.quantity }],
      } satisfies Stripe.Checkout.SessionCreateParams,
     } },
    } });
    return { paymentId };
   }
   const booking = await tx.booking.create({ data: { id: token.id, eventId, userId, customerName: parsed.data.name, customerEmail: parsed.data.email, quantity: parsed.data.quantity, status: "CONFIRMED", platform: null, externalBookingId: null }, select: { number: true } });
   const ticketTokens = Array.from({ length: parsed.data.quantity }, () => createTicketToken());
   await tx.ticket.createMany({
    data: ticketTokens.map(({ publicTokenHash, encryptedPublicToken }) => ({
     bookingId: token.id,
     status: "VALID" as const,
     publicTokenHash,
     encryptedPublicToken,
    })),
   });
   const confirmation = { to: parsed.data.email, ...bookingConfirmation({
    customerName: parsed.data.name, bookingNumber: booking.number,
    eventName: event.name, beginsAt: event.beginsAt, quantity: parsed.data.quantity,
    ticketLinks: ticketTokens.map(({ token }) => ticketLink(token)),
   }) };
   const mail = await enqueueInitialTicketMail(tx, token.id, confirmation);
   initialMailId = mail.id;
   return { success: true, number: booking.number, message: "Deine Buchung wurde bestätigt." };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.paymentId) {
   const payment = await getPrisma().payment.findUniqueOrThrow({ where: { id: result.paymentId } });
   const session = await ensureCheckout(payment);
   checkoutUrl = session.status === "open" && session.url ? session.url : `/booking/payment/${payment.publicToken}`;
  }
 } catch (error) {
  if (error instanceof TicketCodeError) console.error("[tickets:create] Code unavailable", error.reason);
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) return { message: "Eine Buchung wurde gleichzeitig verarbeitet. Bitte klicke erneut auf Buchen; eine bereits gespeicherte Buchung wird nicht doppelt angelegt." };
  return { message: "Die Buchung konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut." };
 }
 if (checkoutUrl) redirect(checkoutUrl);
 if (result.success) {
  // Send only after commit; the durable outbox retries failures via cron.
  if (initialMailId) {
   try { await deliverTicketMail(initialMailId); }
   catch { /* Delivery failure must not turn a committed booking into an error. */ }
  }
  revalidatePath(`/events/${encodeURIComponent(slug)}/${encodeURIComponent(eventId)}`);
  revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/bookings`);
  revalidatePath(`/company/${encodeURIComponent(slug)}/events`);
 }
 return result;
}
