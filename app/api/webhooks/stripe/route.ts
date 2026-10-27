import { applyCancellationRefund, processCancellationRefund } from "@/lib/cancellations/refunds";
import { deliverCancellationMails } from "@/lib/cancellations/mail";
import { getPrisma } from "@/lib/db/prisma";
import { getStripe } from "@/lib/payments/stripe";
import { applyCheckoutSession, applyRefund } from "@/lib/payments/fulfillment";
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
      if (chargeId) await reconcileCharge(chargeId, event.account, event.id);
      await deliverCancellationMails();
    } else if (event.type === "charge.refunded") {
      await reconcileCharge(event.data.object.id, event.account, event.id);
      await deliverCancellationMails();
    }
    return Response.json({ received: true });
  } catch {
    console.error("Stripe webhook processing failed", { eventId: event.id, type: event.type });
    return new Response("Processing failed; retry", { status: 500 });
  }
}


async function reconcileCharge(chargeId: string, accountId: string, eventId: string) {
  const stripe = getStripe();
  const charge = await stripe.charges.retrieve(chargeId, {}, { stripeAccount: accountId });
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return;
  const intent = await stripe.paymentIntents.retrieve(intentId, {}, { stripeAccount: accountId });
  if (!intent.metadata.paymentId) return;
  let succeeded = 0;
  for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 }, { stripeAccount: accountId })) {
    if (refund.status === "succeeded") succeeded += refund.amount;
  }
  // charge.amount_refunded can include pending refunds; only confirmed success
  // is allowed to change the persisted PaymentStatus.
  await applyRefund({ ...charge, amount_refunded: succeeded }, accountId, intent.metadata.paymentId, eventId);
  const request = await getPrisma().cancellationRequest.findFirst({ where: { booking: { payment: { id: intent.metadata.paymentId } }, status: "APPROVED" } });
  if (request) await processCancellationRefund(request.id);
}
