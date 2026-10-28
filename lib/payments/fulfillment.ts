import "server-only";
import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { createTicketToken } from "@/lib/tickets/public-token";
import { ticketLink } from "@/lib/tickets/public-link";
import { bookingConfirmation } from "@/lib/mail/templates/booking-confirmation";
import { enqueueInitialTicketMail } from "@/lib/tickets/outbox";

export async function applyCheckoutSession(session: Stripe.Checkout.Session, accountId: string, eventId?: string) {
  const paymentId = session.metadata?.paymentId;
  if (!paymentId) return;
  return getPrisma().$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { booking: { include: { event: true } } } });
    if (!payment) throw new Error("Unknown payment");
    if (payment.stripeAccountId !== accountId || (payment.checkoutSessionId && payment.checkoutSessionId !== session.id) ||
      session.client_reference_id !== payment.bookingId || session.amount_total !== payment.amount || session.currency !== payment.currency.toLowerCase() || session.mode !== "payment") throw new Error("Checkout mismatch");
    if (eventId && await tx.stripeWebhookEvent.findUnique({ where: { id: eventId } })) return payment.id;
    const paid = session.status === "complete" && session.payment_status === "paid";
    const expired = session.status === "expired";
    if (payment.status === "PENDING" && (paid || expired)) {
      const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (paid && !intentId) throw new Error("Missing payment intent");
      await tx.payment.update({ where: { id: payment.id }, data: { status: paid ? "PAID" : "EXPIRED", checkoutSessionId: session.id, paymentIntentId: intentId } });
      await tx.booking.update({ where: { id: payment.bookingId }, data: { status: paid ? "CONFIRMED" : "EXPIRED", reservedUntil: null } });
      if (paid) {
        const booking = payment.booking;
        const tokens = Array.from({ length: booking.quantity }, () => createTicketToken());
        await tx.ticket.createMany({ data: tokens.map(({ publicTokenHash, encryptedPublicToken }) => ({ bookingId: booking.id, publicTokenHash, encryptedPublicToken })) });
        const message = { to: booking.customerEmail!, ...bookingConfirmation({
          customerName: booking.customerName!, bookingNumber: booking.number, eventName: booking.event.name,
          beginsAt: booking.event.beginsAt, quantity: booking.quantity, ticketLinks: tokens.map(({ token }) => ticketLink(token)),
        }) };
        await enqueueInitialTicketMail(tx, booking.id, message, payment.id);
      }
    }
    if (eventId) await tx.stripeWebhookEvent.create({ data: { id: eventId } });
    return payment.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function applyRefund(charge: Stripe.Charge, accountId: string, paymentId: string, eventId: string) {
  return getPrisma().$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!payment || payment.stripeAccountId !== accountId || payment.amount !== charge.amount || payment.currency.toLowerCase() !== charge.currency || (payment.paymentIntentId && payment.paymentIntentId !== intentId)) throw new Error("Refund mismatch");
    // Retry after checkout fulfillment if Stripe delivers events out of order.
    if (payment.status === "PENDING") throw new Error("Payment fulfillment pending");
    if (await tx.stripeWebhookEvent.findUnique({ where: { id: eventId } })) return;
    if (charge.amount_refunded > 0 && payment.status !== "REFUNDED") {
      const full = charge.amount_refunded === payment.amount;
      await tx.payment.update({ where: { id: payment.id }, data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
      if (full) {
        await tx.booking.update({ where: { id: payment.bookingId }, data: { status: "CANCELLED" } });
        await tx.ticket.updateMany({ where: { bookingId: payment.bookingId }, data: { status: "CANCELLED" } });
      }
    }
    await tx.stripeWebhookEvent.create({ data: { id: eventId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
