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
    } else if (event.type === "charge.refunded") {
      const charge = await stripe.charges.retrieve(event.data.object.id, {}, { stripeAccount: event.account });
      const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (intentId) {
        const intent = await stripe.paymentIntents.retrieve(intentId, {}, { stripeAccount: event.account });
        if (intent.metadata.paymentId) await applyRefund(charge, event.account, intent.metadata.paymentId, event.id);
      }
    }
    return Response.json({ received: true });
  } catch {
    console.error("Stripe webhook processing failed", { eventId: event.id, type: event.type });
    return new Response("Processing failed; retry", { status: 500 });
  }
}
