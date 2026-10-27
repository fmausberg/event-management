import "server-only";
import type Stripe from "stripe";
import { getPrisma } from "@/lib/db/prisma";
import { getStripe } from "@/lib/payments/stripe";
import { cancellationTransaction } from "./transaction";
import { queueCancellationMail } from "./mail";
import { authorizeCancellation, cancellationActor, CancellationError } from "./service";

const include = { booking: { include: { payment: true, event: true } } } as const;
const stripeId = (value: string | { id: string } | null) => typeof value === "string" ? value : value?.id;

export async function applyCancellationRefund(refund: Stripe.Refund, accountId: string) {
  const requestId = refund.metadata?.cancellationRequestId;
  if (!requestId) return;
  await cancellationTransaction(async (tx) => {
    const request = await tx.cancellationRequest.findUnique({ where: { id: requestId }, include });
    const payment = request?.booking.payment;
    if (!request || !payment || request.status !== "APPROVED" || payment.stripeAccountId !== accountId ||
      payment.paymentIntentId !== stripeId(refund.payment_intent) || payment.amount !== refund.amount ||
      payment.currency.toLowerCase() !== refund.currency) throw new Error("Cancellation refund mismatch");
    // An old failed attempt may arrive after an explicit retry. Never regress state.
    if (refund.metadata?.attempt !== String(request.refundAttempt) || request.refundStatus === "SUCCEEDED") return;
    if (request.stripeRefundId && request.stripeRefundId !== refund.id) throw new Error("Refund identity mismatch");
    const status = refund.status === "succeeded" ? "SUCCEEDED" : refund.status === "failed" || refund.status === "canceled" ? "FAILED" : "PENDING";
    if (request.refundStatus === "FAILED" && status === "PENDING") return;
    await tx.cancellationRequest.update({ where: { id: request.id }, data: { stripeRefundId: refund.id, refundStatus: status, refundCheckedAt: new Date(), refundError: status === "FAILED" ? "Stripe hat die Erstattung nicht ausgeführt." : null } });
    if (status === "SUCCEEDED") {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
      await tx.booking.update({ where: { id: request.bookingId }, data: { status: "CANCELLED" } });
      await tx.ticket.updateMany({ where: { bookingId: request.bookingId }, data: { status: "CANCELLED" } });
      await queueCancellationMail(tx, request.id, "refunded");
    } else if (status === "FAILED" && request.refundStatus !== "FAILED") await queueCancellationMail(tx, request.id, "failed");
  });
}

export async function processCancellationRefund(requestId: string) {
  const db = getPrisma();
  const lockedUntil = new Date(Date.now() + 300_000);
  const lock = await db.cancellationRequest.updateMany({ where: { id: requestId, status: "APPROVED", refundStatus: { in: ["PENDING", "REVIEW", "FAILED"] }, OR: [{ refundLockedUntil: null }, { refundLockedUntil: { lt: new Date() } }] }, data: { refundLockedUntil: lockedUntil, refundCheckedAt: new Date() } });
  if (!lock.count) return;
  try {
    let request = await db.cancellationRequest.findUniqueOrThrow({ where: { id: requestId }, include });
    const payment = request.booking.payment;
    if (!payment?.paymentIntentId) throw new Error("Missing payment intent");
    if (payment.status === "REFUNDED") {
      await cancellationTransaction(async (tx) => {
        const changed = await tx.cancellationRequest.updateMany({ where: { id: requestId, refundStatus: { not: "SUCCEEDED" } }, data: { refundStatus: "SUCCEEDED", refundError: null } });
        if (changed.count) await queueCancellationMail(tx, requestId, "refunded");
      });
      return;
    }
    const stripe = getStripe();
    const options = { stripeAccount: payment.stripeAccountId };
    if (request.stripeRefundId) {
      await applyCancellationRefund(await stripe.refunds.retrieve(request.stripeRefundId, {}, options), payment.stripeAccountId);
      return;
    }
    // Recover a lost response before attempting another write, including beyond the
    // Stripe idempotency retention window. Inspect every page, never just the first.
    let recovered: Stripe.Refund | undefined;
    let otherActiveRefund = false;
    for await (const refund of stripe.refunds.list({ payment_intent: payment.paymentIntentId, limit: 100 }, options)) {
      if (refund.metadata?.cancellationRequestId === requestId && refund.metadata?.attempt === String(request.refundAttempt)) recovered = refund;
      else if (refund.status !== "failed" && refund.status !== "canceled") otherActiveRefund = true;
    }
    if (recovered) {
      await applyCancellationRefund(recovered, payment.stripeAccountId);
      return;
    }
    if (otherActiveRefund || payment.status !== "PAID" || request.refundStatus === "REVIEW" || request.refundStatus === "FAILED" || request.refundStartedAt && Date.now() - request.refundStartedAt.getTime() > 23 * 60 * 60_000) {
      await cancellationTransaction(async (tx) => {
        const changed = await tx.cancellationRequest.updateMany({ where: { id: requestId, refundStatus: "PENDING" }, data: { refundStatus: "REVIEW", refundError: "Erstattungsstand in Stripe prüfen; es wird keine weitere Zahlung ausgelöst." } });
        if (changed.count) await queueCancellationMail(tx, requestId, "failed");
      });
      return;
    }
    if (!request.refundStartedAt) request = await db.cancellationRequest.update({ where: { id: requestId }, data: { refundStartedAt: new Date() }, include });
    const refund = await stripe.refunds.create({ payment_intent: payment.paymentIntentId, amount: payment.amount,
      metadata: { cancellationRequestId: requestId, attempt: String(request.refundAttempt) },
    }, { ...options, idempotencyKey: `cancellation-${requestId}-${request.refundAttempt}` });
    await applyCancellationRefund(refund, payment.stripeAccountId);
  } catch {
    // Network/Stripe errors are ambiguous: keep the same attempt/key and never
    // describe money as refunded until Stripe confirms it.
    console.error("Cancellation refund processing failed", { requestId });
    await db.cancellationRequest.updateMany({ where: { id: requestId, refundStatus: "PENDING" }, data: { refundError: "Stripe-Abgleich ausstehend. Der Vorgang wird sicher erneut geprüft." } });
  } finally {
    await db.cancellationRequest.updateMany({ where: { id: requestId, refundLockedUntil: lockedUntil }, data: { refundLockedUntil: null } });
  }
}

export async function retryCancellationRefund(requestId: string) {
  const actor = await cancellationActor();
  await cancellationTransaction(async (tx) => {
    const request = await tx.cancellationRequest.findUnique({ where: { id: requestId }, include });
    if (!request) throw new CancellationError("Anfrage nicht gefunden.");
    await authorizeCancellation(tx, actor, request.booking, true);
    if (request.status !== "APPROVED") throw new CancellationError("Diese Anfrage wurde nicht genehmigt.");
    if (request.refundLockedUntil && request.refundLockedUntil > new Date()) throw new CancellationError("Die Erstattung wird gerade verarbeitet.");
    // Only a definitive Stripe failure permits a new idempotency key. Ambiguous
    // errors and REVIEW only re-read Stripe; they cannot issue a second refund.
    if (request.refundStatus === "FAILED" && request.stripeRefundId) {
      await tx.cancellationRequest.update({ where: { id: requestId }, data: { refundStatus: "PENDING", refundAttempt: { increment: 1 }, stripeRefundId: null, refundStartedAt: null, refundError: null } });
    }
  });
  await processCancellationRefund(requestId);
}

export async function reconcileCancellationRefunds() {
  const rows = await getPrisma().cancellationRequest.findMany({ where: { status: "APPROVED", refundStatus: { in: ["PENDING", "REVIEW"] } }, orderBy: [{ refundCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }], take: 50 });
  for (const row of rows) await processCancellationRefund(row.id);
  return rows.length;
}
