import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { getStripe } from "./stripe";
import { applyRefund } from "./fulfillment";

/** Read-only Stripe synchronization. Never initiates a refund. */
export async function reconcileStripeCharge(chargeId: string, accountId: string, eventId?: string) {
  const stripe = getStripe();
  const options = { stripeAccount: accountId };
  const charge = await stripe.charges.retrieve(chargeId, {}, options);
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return;
  const intent = await stripe.paymentIntents.retrieve(intentId, {}, options);
  if (!intent.metadata.paymentId) return;
  let succeeded = 0;
  const refundIds: string[] = [];
  for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 }, options)) {
    if (refund.status === "succeeded") { succeeded += refund.amount; refundIds.push(refund.id); }
  }
  await applyRefund({ ...charge, amount_refunded: succeeded }, accountId, intent.metadata.paymentId, eventId, refundIds);
  return intent.metadata.paymentId;
}

/** Also recovers missing dashboard-refund webhooks; rotate bounded batches. */
export async function reconcileVoucherRefunds() {
  const db = getPrisma();
  const rows = await db.payment.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
    booking: { OR: [{ voucherRedemption: { is: { status: "COMMITTED" } } }, { voucherBalanceUses: { some: { status: "COMMITTED" } } }] },
  }, orderBy: { updatedAt: "asc" }, take: 50 });
  let failures = 0;
  for (const payment of rows) {
    try {
      if (!payment.paymentIntentId) throw new Error("Missing payment intent");
      const intent = await getStripe().paymentIntents.retrieve(payment.paymentIntentId, {}, { stripeAccount: payment.stripeAccountId });
      const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
      if (!chargeId || intent.metadata.paymentId !== payment.id) throw new Error("Refund reconciliation mismatch");
      await reconcileStripeCharge(chargeId, payment.stripeAccountId);
    } catch { failures++; }
    await db.payment.update({ where: { id: payment.id }, data: { updatedAt: new Date() } });
  }
  return { checked: rows.length, failures };
}
