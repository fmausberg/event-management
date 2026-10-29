import { hasVoucher, reverseBookingVoucher, voucherHistory } from "@/lib/vouchers/reversal";
import { queueCancellationMail } from "@/lib/cancellations/mail";
import "server-only";
import type Stripe from "stripe";
import { issueBookingTickets } from "@/lib/bookings/fulfillment";
import { commitVoucherInTransaction } from "@/lib/vouchers/settlement";
import { releaseVoucherInTransaction, voucherTransaction } from "@/lib/vouchers/service";

export async function applyCheckoutSession(session: Stripe.Checkout.Session, accountId: string, eventId?: string) {
  const paymentId = session.metadata?.paymentId;
  if (!paymentId) return;
  return voucherTransaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { booking: { include: { event: true, price: true } } } });
    if (!payment) throw new Error("Unknown payment");
    if (payment.booking.price && (payment.booking.price.payableAmountMinor !== payment.amount || payment.booking.price.currency !== payment.currency)) throw new Error("Checkout price mismatch");
    if (payment.stripeAccountId !== accountId || (payment.checkoutSessionId && payment.checkoutSessionId !== session.id) ||
      session.client_reference_id !== payment.bookingId || session.amount_total !== payment.amount || session.currency !== payment.currency.toLowerCase() || session.mode !== "payment") throw new Error("Checkout mismatch");
    if (eventId && await tx.stripeWebhookEvent.findUnique({ where: { id: eventId } })) return payment.id;
    const paid = session.status === "complete" && session.payment_status === "paid";
    const expired = session.status === "expired";
    if (payment.status === "PENDING" && (paid || expired)) {
      const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (paid && !intentId) throw new Error("Missing payment intent");
      await tx.payment.update({ where: { id: payment.id }, data: { status: paid ? "PAID" : "EXPIRED", checkoutSessionId: session.id, paymentIntentId: intentId } });
      if (paid && payment.booking.price) await commitVoucherInTransaction(tx, payment.bookingId);
      await tx.booking.update({ where: { id: payment.bookingId }, data: { status: paid ? "CONFIRMED" : "EXPIRED", reservedUntil: null } });
      if (expired && payment.booking.price) await releaseVoucherInTransaction(tx, payment.bookingId);
      if (paid) {
        await issueBookingTickets(tx, payment.booking, payment.booking.event, payment.id);
      }
    }
    if (eventId) await tx.stripeWebhookEvent.create({ data: { id: eventId } });
    return payment.id;
  });
}

export async function applyRefund(charge: Stripe.Charge, accountId: string, paymentId: string, eventId?: string, refundIds: string[] = []) {
  return voucherTransaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { booking: { include: { ...voucherHistory, cancellationRequests: { where: { status: { in: ["PENDING", "APPROVED"] } } } } } } });
    const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!payment || payment.stripeAccountId !== accountId || payment.amount !== charge.amount || payment.currency.toLowerCase() !== charge.currency || (payment.paymentIntentId && payment.paymentIntentId !== intentId)) throw new Error("Refund mismatch");
    // Retry after checkout fulfillment if Stripe delivers events out of order.
    if (payment.status === "PENDING") throw new Error("Payment fulfillment pending");
    if (eventId && await tx.stripeWebhookEvent.findUnique({ where: { id: eventId } })) return;
    if (!Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > payment.amount) throw new Error("Refund amount mismatch");
    if (charge.amount_refunded > 0 && (payment.status !== "REFUNDED" || charge.amount_refunded === payment.amount && hasVoucher(payment.booking))) {
      const full = charge.amount_refunded === payment.amount;
      await tx.payment.update({ where: { id: payment.id }, data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
      if (full) {
        if (hasVoucher(payment.booking)) {
          if (!refundIds.length) throw new Error("Missing refund references");
          await reverseBookingVoucher(tx, payment.bookingId, { externalRefundId: refundIds[0] });
        }
        await tx.booking.update({ where: { id: payment.bookingId }, data: { status: "CANCELLED" } });
        await tx.ticket.updateMany({ where: { bookingId: payment.bookingId }, data: { status: "CANCELLED" } });
      }
      for (const request of payment.booking.cancellationRequests ?? []) {
        if (request.refundStatus === "SUCCEEDED" || !full && request.status !== "APPROVED") continue;
        await tx.cancellationRequest.update({ where: { id: request.id }, data: {
          ...(full && request.status === "PENDING" ? { status: "APPROVED", decidedAt: new Date(), decidedById: null,
            internalNote: [request.internalNote, "Durch vollständige externe Stripe-Erstattung abgeschlossen."].filter(Boolean).join("\n") } : {}),
          refundStatus: full ? "SUCCEEDED" : "REVIEW", refundCheckedAt: new Date(),
          refundError: full ? null : "Externe Teilerstattung: manuelle Prüfung erforderlich; keine anteilige Gutscheinrückgabe.",
        } });
        await queueCancellationMail(tx, request.id, full ? "refunded" : "failed");
      }
    }
    if (eventId) await tx.stripeWebhookEvent.create({ data: { id: eventId } });
  });
}
