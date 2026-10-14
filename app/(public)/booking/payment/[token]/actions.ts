"use server";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/db/prisma";
import { ensureCheckout } from "@/lib/payments/checkout";
import { getStripe } from "@/lib/payments/stripe";
import { applyCheckoutSession } from "@/lib/payments/fulfillment";
import { deliverPaymentMail } from "@/lib/payments/mail";

export async function updateCheckout(token: string, cancel: boolean) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Ungültige Buchung");
  const payment = await getPrisma().payment.findUnique({ where: { publicToken: token } });
  if (!payment) throw new Error("Ungültige Buchung");
  let url = `/booking/payment/${token}`;
  try {
    if (payment.status === "PENDING") {
      let session = await ensureCheckout(payment);
      if (cancel && session.status === "open") {
        try { await getStripe().checkout.sessions.expire(session.id, {}, { stripeAccount: payment.stripeAccountId }); }
        catch { /* A concurrent payment may have completed. Re-read before freeing seats. */ }
        session = await getStripe().checkout.sessions.retrieve(session.id, {}, { stripeAccount: payment.stripeAccountId });
      }
      await applyCheckoutSession(session, payment.stripeAccountId);
      if (!cancel && session.status === "open" && session.url) url = session.url;
    }
    await deliverPaymentMail(payment.id);
  } catch { url = `/booking/payment/${token}?error=1`; }
  redirect(url);
}
