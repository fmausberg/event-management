import "server-only";
import type { Prisma } from "@prisma/client";
import { VoucherError } from "./errors";

export const voucherHistory = { price: true, voucherRedemption: true, voucherBalanceUses: true } as const;
export function hasVoucher(booking: { voucherRedemption?: unknown; voucherBalanceUses?: unknown[] }) {
  return !!booking.voucherRedemption || !!booking.voucherBalanceUses?.length;
}

/** Internal only. Caller owns the Serializable cancellation/refund transaction.
 * validateOnly checks recoverability before initiating a remote refund.
 */
export async function reverseBookingVoucher(tx: Prisma.TransactionClient, bookingId: string,
  context: { cancellationRequestId?: string; externalRefundId?: string }, validateOnly = false) {
  await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: {
    ...voucherHistory, payment: true, voucherBalanceUses: { include: { balance: true, entries: true } },
  } });
  const { price, payment, voucherRedemption: discount, voucherBalanceUses: uses } = booking;
  if (!hasVoucher(booking)) return;
  if (!price || !["CONFIRMED", "CANCELLED"].includes(booking.status) || discount && uses.length || uses.length > 1 || price.eventId !== booking.eventId ||
    price.quantity !== booking.quantity || price.originalAmountMinor !== price.discountAmountMinor + price.voucherAmountMinor + price.payableAmountMinor ||
    price.discountAmountMinor !== (discount?.discountAmountMinor ?? 0) || price.voucherAmountMinor !== (uses[0]?.amountMinor ?? 0) ||
    (payment ? payment.amount !== price.payableAmountMinor || payment.currency !== price.currency ||
      !(validateOnly || context.cancellationRequestId ? ["PAID", "REFUNDED"] : ["REFUNDED"]).includes(payment.status) : price.payableAmountMinor !== 0)) throw new VoucherError("BOOKING_CONFLICT");
  if (!validateOnly) {
    if (context.cancellationRequestId) {
      const request = await tx.cancellationRequest.findUnique({ where: { id: context.cancellationRequestId } });
      if (!request || request.bookingId !== bookingId || request.status !== "APPROVED") throw new VoucherError("BOOKING_CONFLICT");
    } else if (!payment || !context.externalRefundId) throw new VoucherError("BOOKING_CONFLICT");
  }
  const item = discount ?? uses[0];
  if (item.currency !== price.currency || !["COMMITTED", "REVERSED"].includes(item.status)) throw new VoucherError("BOOKING_CONFLICT");
  await tx.$queryRaw`SELECT "id" FROM "VoucherCampaign" WHERE "id" = ${item.campaignId} FOR UPDATE`;
  if (discount) {
    if (!validateOnly && (!discount.limitReturnedAt || discount.status !== "REVERSED")) {
      const now = new Date();
      await tx.voucherRedemption.update({ where: { id: discount.id }, data: { status: "REVERSED", reversedAt: discount.reversedAt ?? now, limitReturnedAt: now } });
    }
    return;
  }
  const use = uses[0];
  await tx.$queryRaw`SELECT "id" FROM "VoucherBalance" WHERE "id" = ${use.balanceId} FOR UPDATE`;
  const spend = use.entries.filter(entry => entry.type === "SPEND");
  const restores = use.entries.filter(entry => entry.type === "RESTORE");
  if (spend.length !== 1 || spend[0].amountMinor !== use.amountMinor || spend[0].currency !== use.currency ||
    spend[0].balanceDeltaMinor !== -use.amountMinor || spend[0].reservedDeltaMinor !== -use.amountMinor ||
    use.balance.currency !== use.currency || use.balance.issuerCompanyId !== price.companyId) throw new VoucherError("BOOKING_CONFLICT");
  const operationKey = `voucher:restore:full:${use.id}`;
  if (use.status === "REVERSED") {
    if (use.restoredMinor !== use.amountMinor || restores.length !== 1 || restores[0].operationKey !== operationKey ||
      restores[0].amountMinor !== use.amountMinor || restores[0].reversalOfId !== spend[0].id ||
      restores[0].currency !== use.currency || restores[0].balanceDeltaMinor !== use.amountMinor || restores[0].reservedDeltaMinor !== 0) throw new VoucherError("BOOKING_CONFLICT");
    return;
  }
  if (use.restoredMinor !== 0 || restores.length) throw new VoucherError("BOOKING_CONFLICT");
  // expiresAt is the canonical validity on this original balance. Never replace it,
  // reactivate an expired/blocked balance, or derive a new date from campaign rules.
  if (validateOnly) return;
  const changed = await tx.voucherBalance.updateMany({ where: { id: use.balanceId, currency: use.currency,
    balanceMinor: { lte: 2_147_483_647 - use.amountMinor } }, data: { balanceMinor: { increment: use.amountMinor } } });
  if (changed.count !== 1) throw new VoucherError("UNAVAILABLE");
  await tx.voucherBalanceEntry.create({ data: { balanceId: use.balanceId, useId: use.id, type: "RESTORE", operationKey,
    amountMinor: use.amountMinor, balanceDeltaMinor: use.amountMinor, reservedDeltaMinor: 0, currency: use.currency,
    reversalOfId: spend[0].id, cancellationRequestId: context.cancellationRequestId,
    externalRefundId: context.externalRefundId, reason: "Full booking cancellation" } });
  await tx.voucherBalanceUse.update({ where: { id: use.id }, data: { status: "REVERSED", restoredMinor: use.amountMinor, reversedAt: new Date() } });
}
