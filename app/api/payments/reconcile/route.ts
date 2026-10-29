import { reconcileVoucherRefunds } from "@/lib/payments/refund-reconciliation";
import { reconcileCancellationRefunds } from "@/lib/cancellations/refunds";
import { deliverCancellationMails } from "@/lib/cancellations/mail";
import { timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/db/prisma";
import { ensureCheckout } from "@/lib/payments/checkout";
import { applyCheckoutSession } from "@/lib/payments/fulfillment";
import { deliverPendingTicketMails } from "@/lib/tickets/outbox";
import { releaseExpiredVoucherReservation } from "@/lib/vouchers/service";

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
  const voucherRefunds = await reconcileVoucherRefunds();
  failures += voucherRefunds.failures;
  const mails = await deliverPendingTicketMails();
  // Recovery for previously verified expiry with a stranded hold; never expire by clock.
  const expiredHolds = await db.booking.findMany({ where: { status: "EXPIRED",
    OR: [{ voucherRedemption: { is: { status: "RESERVED" } } }, { voucherBalanceUses: { some: { status: "RESERVED" } } }],
  }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: 50 });
  for (const booking of expiredHolds) {
    const result = await releaseExpiredVoucherReservation(booking.id);
    if (!result.ok) failures++;
    await db.booking.update({ where: { id: booking.id }, data: { updatedAt: new Date() } });
  }
  failures += mails.failures;
  let cancellations = 0;
  try { cancellations = await reconcileCancellationRefunds(); failures += await deliverCancellationMails(); } catch { failures++; console.error("Cancellation reconciliation failed"); }
  return Response.json({ voucherRefunds: voucherRefunds.checked, cancellations, checked: pending.length, mails: mails.checked, failures }, { status: failures ? 503 : 200 });
}
