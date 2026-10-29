import "server-only";
import type { Prisma } from "@prisma/client";
import { VoucherError } from "./errors";

/** Caller verifies Stripe, then commits payment, vouchers, booking, tickets and outbox atomically. */
export async function commitVoucherInTransaction(tx: Prisma.TransactionClient, bookingId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: {
    price: true, payment: true, voucherRedemption: true, voucherBalanceUses: true,
  } });
  const { price, payment, voucherRedemption: discount, voucherBalanceUses: uses } = booking;
  if (discount && uses.length || uses.length > 1) throw new VoucherError("BOOKING_CONFLICT");
  // Legacy bookings have neither snapshot nor voucher; preserve their fulfillment.
  if (!price) {
    if (discount || uses.length) throw new VoucherError("BOOKING_CONFLICT");
    return;
  }
  if (booking.status !== "PENDING_PAYMENT" && booking.status !== "CONFIRMED" ||
    price.eventId !== booking.eventId || price.quantity !== booking.quantity ||
    price.originalAmountMinor !== price.discountAmountMinor + price.voucherAmountMinor + price.payableAmountMinor ||
    (payment ? payment.status !== "PAID" || payment.amount !== price.payableAmountMinor || payment.currency !== price.currency : price.payableAmountMinor !== 0) ||
    price.discountAmountMinor !== (discount?.discountAmountMinor ?? 0) || price.voucherAmountMinor !== (uses[0]?.amountMinor ?? 0)) throw new VoucherError("BOOKING_CONFLICT");
  const item = discount ?? uses[0];
  if (!item) return;
  if (item.currency !== price.currency) throw new VoucherError("BOOKING_CONFLICT");
  if (item.status === "COMMITTED") return;
  if (item.status !== "RESERVED") throw new VoucherError("BOOKING_CONFLICT");
  await tx.$queryRaw`SELECT "id" FROM "VoucherCampaign" WHERE "id" = ${item.campaignId} FOR UPDATE`;
  const committedAt = new Date();
  if (discount) {
    await tx.voucherRedemption.update({ where: { id: discount.id }, data: { status: "COMMITTED", committedAt, reservedUntil: null } });
    return;
  }
  const use = uses[0];
  await tx.$queryRaw`SELECT "id" FROM "VoucherBalance" WHERE "id" = ${use.balanceId} FOR UPDATE`;
  // Do not recheck expiry/status: these funds were validly reserved for this payment.
  const changed = await tx.voucherBalance.updateMany({ where: { id: use.balanceId, currency: use.currency,
    balanceMinor: { gte: use.amountMinor }, reservedMinor: { gte: use.amountMinor } },
    data: { balanceMinor: { decrement: use.amountMinor }, reservedMinor: { decrement: use.amountMinor } } });
  if (changed.count !== 1) throw new VoucherError("UNAVAILABLE");
  await tx.voucherBalanceUse.update({ where: { id: use.id }, data: { status: "COMMITTED", committedAt, reservedUntil: null } });
  await tx.voucherBalanceEntry.create({ data: { balanceId: use.balanceId, useId: use.id, type: "SPEND",
    operationKey: `voucher:spend:${use.id}`, amountMinor: use.amountMinor, balanceDeltaMinor: -use.amountMinor,
    reservedDeltaMinor: -use.amountMinor, currency: use.currency, reason: "Confirmed booking" } });
}
