import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { commitVoucherInTransaction } from "@/lib/vouchers/settlement";
import { applyCheckoutSession } from "@/lib/payments/fulfillment";
import { issueBookingTickets } from "@/lib/bookings/fulfillment";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/bookings/fulfillment", () => ({ issueBookingTickets: vi.fn() }));
const { db } = vi.hoisted(() => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));

function fixture(payable = 1000, discount = false) {
  const item = { id: "use", campaignId: "campaign", balanceId: "balance", status: "RESERVED", currency: "EUR", amountMinor: 2000, discountAmountMinor: 2000 };
  const booking = { id: "booking", eventId: "event", quantity: 2, status: "PENDING_PAYMENT", event: {},
    price: { eventId: "event", quantity: 2, currency: "EUR", originalAmountMinor: 2000 + payable,
      discountAmountMinor: discount ? 2000 : 0, voucherAmountMinor: discount ? 0 : 2000, payableAmountMinor: payable },
    payment: payable ? { status: "PAID", amount: payable, currency: "EUR" } : null,
    voucherRedemption: discount ? item : null, voucherBalanceUses: discount ? [] : [item] };
  const payment = { id: "payment", bookingId: "booking", status: "PENDING", amount: payable, currency: "EUR", stripeAccountId: "account", checkoutSessionId: null, booking };
  const tx = {
    $queryRaw: vi.fn(),
    booking: { findUniqueOrThrow: vi.fn(async () => booking), findUnique: vi.fn(async () => booking), update: vi.fn(async ({ data }) => Object.assign(booking, data)) },
    payment: { findUnique: vi.fn(async () => payment), update: vi.fn(async ({ data }) => { Object.assign(payment, data); Object.assign(booking.payment!, data); }) },
    voucherRedemption: { update: vi.fn(async ({ data }) => Object.assign(item, data)) },
    voucherBalanceUse: { update: vi.fn(async ({ data }) => Object.assign(item, data)) },
    voucherBalance: { updateMany: vi.fn(async () => ({ count: 1 })) },
    voucherBalanceEntry: { create: vi.fn() },
    stripeWebhookEvent: { findUnique: vi.fn(), create: vi.fn() },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient, booking, payment, item };
}
beforeEach(() => vi.resetAllMocks());
it.each([0, 1000])("spends reserved balance once for a %i-cent remainder", async payable => {
  const { tx, client } = fixture(payable);
  await commitVoucherInTransaction(client, "booking");
  await commitVoucherInTransaction(client, "booking");
  expect(tx.voucherBalance.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: "balance", currency: "EUR", balanceMinor: { gte: 2000 }, reservedMinor: { gte: 2000 } }, data: { balanceMinor: { decrement: 2000 }, reservedMinor: { decrement: 2000 } } });
  expect(tx.voucherBalanceEntry.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ type: "SPEND", operationKey: "voucher:spend:use", balanceDeltaMinor: -2000, reservedDeltaMinor: -2000 }) });
});
it("commits a discount once without a balance journal", async () => {
  const { tx, client, item } = fixture(0, true);
  await commitVoucherInTransaction(client, "booking"); await commitVoucherInTransaction(client, "booking");
  expect(item.status).toBe("COMMITTED"); expect(tx.voucherRedemption.update).toHaveBeenCalledOnce(); expect(tx.voucherBalanceEntry.create).not.toHaveBeenCalled();
});
it.each(["PENDING", "EXPIRED"])("never spends against a %s payment", async status => {
  const { tx, client, booking } = fixture(); booking.payment!.status = status;
  await expect(commitVoucherInTransaction(client, "booking")).rejects.toThrow();
  expect(tx.voucherBalance.updateMany).not.toHaveBeenCalled();
});
it("rejects mismatched snapshots and released reservations", async () => {
  const { client, booking, item } = fixture(); booking.price.payableAmountMinor++;
  await expect(commitVoucherInTransaction(client, "booking")).rejects.toThrow();
  booking.price.payableAmountMinor--; item.status = "RELEASED";
  await expect(commitVoucherInTransaction(client, "booking")).rejects.toThrow();
});
const session = (status = "complete") => ({ id: "session", metadata: { paymentId: "payment" }, client_reference_id: "booking", amount_total: 1000, currency: "eur", mode: "payment", status, payment_status: "paid", payment_intent: "intent" }) as unknown as Stripe.Checkout.Session;
it("atomically finalizes Stripe payment and voucher; duplicate and late events do not issue again", async () => {
  const { tx, payment, item } = fixture();
  db.$transaction.mockImplementation(async work => work(tx));
  await applyCheckoutSession(session(), "account", "event-1");
  await applyCheckoutSession(session(), "account", "event-2");
  await applyCheckoutSession(session("expired"), "account", "event-3");
  expect(payment.status).toBe("PAID"); expect(item.status).toBe("COMMITTED");
  expect(issueBookingTickets).toHaveBeenCalledOnce(); expect(tx.voucherBalanceEntry.create).toHaveBeenCalledOnce();
});
it("releases on verified Stripe expiry once without spending or issuing tickets", async () => {
  const { tx, payment, item } = fixture();
  db.$transaction.mockImplementation(async work => work(tx));
  await applyCheckoutSession(session("expired"), "account"); await applyCheckoutSession(session("expired"), "account");
  expect(payment.status).toBe("EXPIRED"); expect(item.status).toBe("RELEASED");
  expect(tx.voucherBalanceEntry.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ type: "RELEASE", balanceDeltaMinor: 0 }) });
  expect(issueBookingTickets).not.toHaveBeenCalled();
});
it("propagates settlement failure for rollback of payment, booking and journal", async () => {
  let persisted = fixture();
  db.$transaction.mockImplementation(async work => {
    const staged = fixture(); staged.tx.voucherBalanceEntry.create.mockRejectedValue(new Error("journal unavailable"));
    const result = await work(staged.tx); persisted = staged; return result;
  });
  await expect(applyCheckoutSession(session(), "account")).rejects.toThrow("journal unavailable");
  expect(persisted.payment.status).toBe("PENDING"); expect(persisted.item.status).toBe("RESERVED");
  expect(issueBookingTickets).not.toHaveBeenCalled();
});
