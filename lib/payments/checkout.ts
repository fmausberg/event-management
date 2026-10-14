import "server-only";
import Stripe from "stripe";
import type { Payment, Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { getStripe } from "./stripe";

export async function ensureCheckout(payment: Payment) {
  const stripe = getStripe();
  if (payment.checkoutSessionId) return stripe.checkout.sessions.retrieve(payment.checkoutSessionId, {}, { stripeAccount: payment.stripeAccountId });
  // Do not reuse a pruned Stripe idempotency key after 24 hours.
  if (Date.now() - payment.createdAt.getTime() > 23 * 60 * 60_000) throw new Error("Checkout requires manual reconciliation");
  let session;
  const requestMetadata = (payment.checkoutRequest as { metadata?: { checkoutRequestVersion?: string } }).metadata;
  const keySuffix = requestMetadata?.checkoutRequestVersion === "card-filter-v2" ? "-card-filter-v2" : "";
  try {
    session = await stripe.checkout.sessions.create(payment.checkoutRequest as unknown as Stripe.Checkout.SessionCreateParams,
      { stripeAccount: payment.stripeAccountId, idempotencyKey: `ticket-checkout-${payment.id}${keySuffix}` });
  } catch (error) {
    // Migrate legacy requests only after Stripe definitively rejects the removed
    // parameter without creating a session. Use a versioned retry key because
    // Stripe can retain the rejected request's parameters. Preserve amount/expiry.
    const request = payment.checkoutRequest as Prisma.JsonObject;
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.param === "payment_method_types" &&
      error.message.includes("no longer supported") && Array.isArray(request.payment_method_types) &&
      request.payment_method_types.length === 1 && request.payment_method_types[0] === "card") {
      const updatedRequest: Prisma.JsonObject = { ...request, allowed_payment_method_types: ["card"] };
      delete updatedRequest.payment_method_types;
      updatedRequest.metadata = { ...(request.metadata as Prisma.JsonObject ?? {}), checkoutRequestVersion: "card-filter-v2" };
      const updated = await getPrisma().payment.update({ where: { id: payment.id }, data: { checkoutRequest: updatedRequest } });
      return ensureCheckout(updated);
    }
    // An exact idempotent replay would return an existing session. An expired
    // expires_at validation failure proves this request did not create one.
    // Never release inventory for network failures or ambiguous Stripe errors.
    const expiresAt = (payment.checkoutRequest as { expires_at?: number }).expires_at;
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.param === "expires_at" && expiresAt && expiresAt * 1000 <= Date.now()) {
      await getPrisma().$transaction(async (tx) => {
        const changed = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING", checkoutSessionId: null }, data: { status: "EXPIRED" } });
        if (changed.count) await tx.booking.update({ where: { id: payment.bookingId }, data: { status: "EXPIRED", reservedUntil: null } });
      });
    }
    throw error;
  }
  await getPrisma().payment.update({ where: { id: payment.id }, data: { checkoutSessionId: session.id } });
  return session;
}
