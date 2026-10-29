import { reconcileStripeCharge } from "@/lib/payments/refund-reconciliation";
import { applyCancellationRefund } from "@/lib/cancellations/refunds";
import { deliverCancellationMails } from "@/lib/cancellations/mail";
import { getStripe } from "@/lib/payments/stripe";
import { applyCheckoutSession } from "@/lib/payments/fulfillment";
import { deliverPaymentMail } from "@/lib/payments/mail";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), request.headers.get("stripe-signature") ?? "", secret);
  } catch { return new Response("Invalid signature", { status: 400 }); }
  if (!event.account) return Response.json({ received: true });
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded" || event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      // Retrieve current state, not an out-of-order snapshot, in the connected account.
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {}, { stripeAccount: event.account });
      const paymentId = await applyCheckoutSession(session, event.account, event.id);
      if (paymentId) await deliverPaymentMail(paymentId);
    } else if (event.type === "refund.created" || event.type === "refund.updated" || event.type === "refund.failed") {
      const refund = await stripe.refunds.retrieve(event.data.object.id, {}, { stripeAccount: event.account });
      await applyCancellationRefund(refund, event.account);
      // External dashboard refunds have no cancellation metadata. Reconcile their
      // charge through the same success-only aggregate as charge.refunded below.
      const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
      if (chargeId) await reconcileStripeCharge(chargeId, event.account, event.id);
      await deliverCancellationMails();
    } else if (event.type === "charge.refunded") {
      await reconcileStripeCharge(event.data.object.id, event.account, event.id);
      await deliverCancellationMails();
    }
    return Response.json({ received: true });
  } catch {
    console.error("Stripe webhook processing failed", { eventId: event.id, type: event.type });
    return new Response("Processing failed; retry", { status: 500 });
  }
}
