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
import { TicketCodeError } from "@/lib/tickets/code-encryption";
import { deliverTicketMail } from "@/lib/tickets/outbox";
import { issueBookingTickets } from "@/lib/bookings/fulfillment";
import { quoteVoucher, reserveVoucherInTransaction, voucherTransaction } from "@/lib/vouchers/service";
import { commitVoucherInTransaction } from "@/lib/vouchers/settlement";
import { VoucherError } from "@/lib/vouchers/errors";
import type { VoucherPrice } from "@/lib/vouchers/pricing";

export type PublicBookingState = { success?: boolean; message?: string; number?: number; paymentId?: string };
export type PublicVoucherState = { price?: VoucherPrice; message?: string };
const schema = z.object({
  name: z.string().trim().min(1, "Bitte gib deinen Namen ein.").max(160), email: emailSchema,
  quantity: z.string().regex(/^\d+$/, "Bitte gib eine gültige Platzanzahl ein.").transform(Number).pipe(z.number().int().min(1).max(100)),
  code: z.string().trim().max(128, "Bitte prüfe den Gutscheincode."),
});
class BookingError extends Error {}
class ConnectRefreshRequired extends Error {
  constructor(readonly companyId: string) { super("Connect refresh required"); }
}

export async function previewPublicVoucher(slug: string, eventId: string, form: FormData): Promise<PublicVoucherState> {
  const parsed = schema.pick({ email: true, quantity: true, code: true }).safeParse({ email: form.get("email"), quantity: form.get("quantity"), code: form.get("code") });
  const token = readBookingToken(form.get("token"));
  if (!parsed.success || !token || token.eventId !== eventId || !parsed.data.code || form.getAll("code").length !== 1 || form.get("website")) return { message: "Bitte prüfe E-Mail-Adresse, Anzahl und Gutscheincode oder lade das Formular neu." };
  try {
    if (!await consumeAuthAttempt(parsed.data.email, "voucher-quote")) return { message: "Zu viele Gutscheinprüfungen. Bitte versuche es in 15 Minuten erneut." };
    const event = await getPrisma().event.findFirst({ where: { id: eventId, company: { slug }, status: "PUBLISHED" }, select: { id: true } });
    if (!event) return { message: "Dieses Event ist nicht buchbar." };
    const result = await quoteVoucher({ eventId, ...parsed.data });
    return result.ok ? { price: result.value } : { message: result.error.message };
  } catch { return { message: "Die Gutscheinprüfung ist derzeit nicht verfügbar." }; }
}

export async function bookPublicEvent(slug: string, eventId: string, _previous: PublicBookingState, form: FormData): Promise<PublicBookingState> {
  const parsed = schema.safeParse({ name: form.get("name"), email: form.get("email"), quantity: form.get("quantity"), code: form.get("code") ?? "" });
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  if (form.getAll("code").length > 1) return { message: "Pro Buchung ist nur ein Gutscheincode erlaubt." };
  const token = readBookingToken(form.get("token"));
  if (!token || token.eventId !== eventId) return { message: "Das Buchungsformular ist abgelaufen. Bitte lade die Seite neu." };
  if (form.get("website")) return { message: "Die Buchung konnte nicht verarbeitet werden." };
  let result: PublicBookingState & { initialMailId?: string };
  let checkoutUrl: string | undefined;
  try {
    if (!await consumeAuthAttempt(parsed.data.email, "public-booking")) return { message: "Zu viele Buchungsversuche. Bitte versuche es in 15 Minuten erneut." };
    const userId = (await auth())?.user?.id ?? null;
    let connectChecked = false;
    // Paid results request one live Connect refresh outside DB locks. The tentative
    // transaction rolls back completely and is recalculated after the refresh.
    for (;;) {
      try {
        result = await voucherTransaction(async tx => {
          const event = await tx.event.findFirst({ where: { id: eventId, company: { slug } }, select: {
            id: true, companyId: true, name: true, status: true, beginsAt: true, maxSeats: true, ticketPrice: true, currency: true,
            company: { select: { stripeAccountId: true, stripeChargesEnabled: true, stripePayoutsEnabled: true } },
          } });
          if (!event) throw new BookingError("Dieses Event ist nicht buchbar.");
          const existing = await tx.booking.findUnique({ where: { id: token.id }, include: {
            payment: true, price: true, voucherRedemption: true, voucherBalanceUses: true,
          } });
          if (existing) {
            if (existing.eventId !== eventId || existing.quantity !== parsed.data.quantity || existing.userId !== userId ||
              existing.customerEmail !== parsed.data.email || existing.customerName !== parsed.data.name) throw new VoucherError("BOOKING_CONFLICT");
            if (parsed.data.code) {
              if (!existing.voucherRedemption && !existing.voucherBalanceUses.length) throw new VoucherError("BOOKING_CONFLICT");
              await reserveVoucherInTransaction(tx, { ...parsed.data, eventId, token: String(form.get("token")) }, userId);
            } else if (existing.voucherRedemption || existing.voucherBalanceUses.length) throw new VoucherError("BOOKING_CONFLICT");
            if (existing.price && (existing.price.quantity !== parsed.data.quantity || existing.price.eventId !== eventId ||
              existing.price.currency !== token.currency || existing.price.unitPriceMinor !== Number(token.price.replace(".", "")) ||
              existing.payment && (existing.payment.amount !== existing.price.payableAmountMinor || existing.payment.currency !== existing.price.currency))) throw new VoucherError("BOOKING_CONFLICT");
            if (existing.status === "PENDING_PAYMENT" && existing.payment) return { paymentId: existing.payment.id };
            if (existing.status === "CONFIRMED") return { success: true, number: existing.number, message: "Deine Buchung wurde bestätigt." };
            throw new BookingError("Diese Buchung ist abgelaufen oder storniert. Bitte lade die Seite neu.");
          }
          if (!event.beginsAt || event.ticketPrice === null || event.maxSeats === null || event.status !== "PUBLISHED" || event.beginsAt <= new Date()) throw new BookingError("Dieses Event ist nicht mehr buchbar.");
          if (event.ticketPrice.toFixed(2) !== token.price || event.currency !== token.currency) throw new VoucherError("PRICE_CHANGED");
          const reserved = await tx.booking.aggregate({ where: { eventId, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } }, _sum: { quantity: true } });
          if ((reserved._sum.quantity ?? 0) + parsed.data.quantity > event.maxSeats) throw new BookingError("Es sind nicht mehr genügend Plätze frei. Bitte wähle weniger Plätze oder lade die Seite neu.");
          const expiresAt = Math.floor(Date.now() / 1000) + 35 * 60;
          const booking = await tx.booking.create({ data: { id: token.id, eventId, userId, customerName: parsed.data.name,
            customerEmail: parsed.data.email, quantity: parsed.data.quantity, status: "PENDING_PAYMENT",
            reservedUntil: new Date(expiresAt * 1000), platform: null, externalBookingId: null }, select: { number: true } });
          let amount: number;
          if (parsed.data.code) {
            amount = (await reserveVoucherInTransaction(tx, { ...parsed.data, eventId, token: String(form.get("token")) }, userId)).price.payableAmountMinor;
          } else {
            if (event.currency !== "EUR") throw new BookingError("Diese Währung wird nicht unterstützt.");
            amount = token.price === "0.00" ? 0 : euroAmount(token.price, event.currency, parsed.data.quantity);
            await tx.bookingPrice.create({ data: { bookingId: token.id, eventId, companyId: event.companyId, currency: event.currency,
              unitPriceMinor: Number(token.price.replace(".", "")), quantity: parsed.data.quantity, originalAmountMinor: amount,
              discountAmountMinor: 0, voucherAmountMinor: 0, payableAmountMinor: amount, calculationVersion: 1 } });
          }
          if (amount > 0) {
            if (!connectChecked) throw new ConnectRefreshRequired(event.companyId);
            if (!event.company.stripeAccountId || !event.company.stripeChargesEnabled || !event.company.stripePayoutsEnabled) throw new BookingError("Die Online-Zahlung ist derzeit nicht verfügbar.");
            const paymentId = randomUUID(), publicToken = randomUUID();
            const returnUrl = `${paymentOrigin()}/booking/payment/${publicToken}`;
            await tx.payment.create({ data: { id: paymentId, bookingId: token.id, publicToken, stripeAccountId: event.company.stripeAccountId,
              amount, currency: event.currency, checkoutRequest: {
                mode: "payment", allowed_payment_method_types: ["card"], client_reference_id: token.id, customer_email: parsed.data.email,
                metadata: { paymentId, bookingPriceVersion: "1" }, payment_intent_data: { metadata: { paymentId } },
                expires_at: expiresAt, success_url: returnUrl, cancel_url: returnUrl,
                // Order discount may not divide evenly by ticket count: one booking line.
                line_items: [{ price_data: { currency: "eur", unit_amount: amount,
                  product_data: { name: `${event.name} (${parsed.data.quantity} Tickets)` } }, quantity: 1 }],
              } satisfies Stripe.Checkout.SessionCreateParams } });
            return { paymentId };
          }
          if (parsed.data.code) await commitVoucherInTransaction(tx, token.id);
          await tx.booking.update({ where: { id: token.id }, data: { status: "CONFIRMED", reservedUntil: null } });
          const mail = await issueBookingTickets(tx, { id: token.id, number: booking.number, quantity: parsed.data.quantity,
            customerName: parsed.data.name, customerEmail: parsed.data.email }, event);
          return { success: true, number: booking.number, message: "Deine Buchung wurde bestätigt.", initialMailId: mail.id };
        });
        break;
      } catch (error) {
        if (!(error instanceof ConnectRefreshRequired) || connectChecked) throw error;
        const company = await refreshConnectAccount(error.companyId);
        if (!company.stripeAccountId || !company.stripeChargesEnabled || !company.stripePayoutsEnabled) throw new BookingError("Der Veranstalter hat die Online-Zahlung noch nicht freigeschaltet.");
        connectChecked = true;
      }
    }
    if (result.paymentId) {
      const payment = await getPrisma().payment.findUniqueOrThrow({ where: { id: result.paymentId } });
      const session = await ensureCheckout(payment);
      checkoutUrl = session.status === "open" && session.url ? session.url : `/booking/payment/${payment.publicToken}`;
    }
  } catch (error) {
    if (error instanceof TicketCodeError) console.error("[tickets:create] Code unavailable", error.reason);
    if (error instanceof VoucherError) return { message: error.code === "UNAVAILABLE" ? "Die Gutscheinprüfung ist derzeit nicht verfügbar." : error.message };
    if (error instanceof BookingError) return { message: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) return { message: "Eine Buchung wurde gleichzeitig verarbeitet. Bitte klicke erneut auf Buchen; eine bereits gespeicherte Buchung wird nicht doppelt angelegt." };
    return { message: "Die Buchung konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut." };
  }
  if (checkoutUrl) redirect(checkoutUrl);
  if (result.success) {
    if (result.initialMailId) { try { await deliverTicketMail(result.initialMailId); } catch { /* Durable outbox retries. */ } }
    revalidatePath(`/events/${encodeURIComponent(slug)}/${encodeURIComponent(eventId)}`);
    revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/bookings`);
    revalidatePath(`/company/${encodeURIComponent(slug)}/events`);
  }
  const { initialMailId: _mail, ...publicResult } = result;
  void _mail;
  return publicResult;
}
