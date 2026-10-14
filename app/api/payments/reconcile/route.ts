import { timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/db/prisma";
import { ensureCheckout } from "@/lib/payments/checkout";
import { applyCheckoutSession } from "@/lib/payments/fulfillment";
import { deliverPaymentMail } from "@/lib/payments/mail";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.PAYMENTS_CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new Response("Unauthorized", { status: 401 });
  const db = getPrisma();
  const pending = await db.payment.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 60_000) } }, orderBy: { updatedAt: "asc" }, take: 50 });
  let failures = 0;
  for (const payment of pending) {
    try {
      const session = await ensureCheckout(payment);
      await applyCheckoutSession(session, payment.stripeAccountId);
    } catch { failures++; }
    // Rotate batches; a broken account must not starve later reservations.
    await db.payment.update({ where: { id: payment.id }, data: { updatedAt: new Date() } });
  }
  const mails = await db.paymentMail.findMany({ where: { sentAt: null }, take: 50, orderBy: { createdAt: "asc" } });
  for (const mail of mails) {
    try { await deliverPaymentMail(mail.paymentId); } catch { failures++; }
  }
  return Response.json({ checked: pending.length, mails: mails.length, failures }, { status: failures ? 503 : 200 });
}
