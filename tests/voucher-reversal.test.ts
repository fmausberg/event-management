import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { requestCancellation, decideCancellation } from "@/lib/cancellations/service";
import { applyCancellationRefund, processCancellationRefund } from "@/lib/cancellations/refunds";
import { applyRefund } from "@/lib/payments/fulfillment";
import { reverseBookingVoucher } from "@/lib/vouchers/reversal";
import { cancellationTransaction } from "@/lib/cancellations/transaction";

vi.mock("server-only", () => ({}));
const { db, stripe, queue } = vi.hoisted(() => ({
  db: { $transaction: vi.fn(), cancellationRequest: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() } },
  stripe: { refunds: { create: vi.fn(), retrieve: vi.fn(), list: vi.fn() } }, queue: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "owner" } }) }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/payments/stripe", () => ({ getStripe: () => stripe }));
vi.mock("@/lib/cancellations/mail", () => ({ queueCancellationMail: queue }));

function fixture() {
  return {
    booking: { id: "booking", userId: "owner", eventId: "event", quantity: 2, status: "CONFIRMED",
      event: { companyId: "company", beginsAt: new Date("2099-01-01"), freeCancellationUntilMinutesBeforeStart: 0 } },
    payment: { id: "payment", bookingId: "booking", amount: 1000, currency: "EUR", status: "PAID", stripeAccountId: "account", paymentIntentId: "intent" } as { id: string; bookingId: string; amount: number; currency: string; status: string; stripeAccountId: string; paymentIntentId: string } | null,
    price: { eventId: "event", companyId: "company", quantity: 2, originalAmountMinor: 3000, discountAmountMinor: 0, voucherAmountMinor: 2000, payableAmountMinor: 1000, currency: "EUR" },
    use: { id: "use", bookingId: "booking", campaignId: "campaign", balanceId: "balance", amountMinor: 2000, restoredMinor: 0, status: "COMMITTED", currency: "EUR" },
    discount: null as { id: string; status: string; campaignId: string; discountAmountMinor: number; currency: string; reversedAt: Date | null; limitReturnedAt: Date | null } | null,
    balance: { balanceMinor: 500, reservedMinor: 100, issuerCompanyId: "company", currency: "EUR", status: "ACTIVE", expiresAt: new Date("2020-01-01") },
    entries: [{ id: "spend", type: "SPEND", operationKey: "voucher:spend:use", amountMinor: 2000, currency: "EUR", balanceDeltaMinor: -2000, reservedDeltaMinor: -2000, reversalOfId: null as string | null }],
    request: null as { id: string; bookingId: string; status: string; refundStatus: string; refundAttempt: number; stripeRefundId: string | null; refundStartedAt: Date | null; refundLockedUntil: Date | null; refundError: string | null } | null,
    webhookIds: [] as string[], ticketStatus: "VALID",
  };
}
type State = ReturnType<typeof fixture>;
let state: State;
function loadedBooking(s: State) {
  return { ...s.booking, price: s.price, payment: s.payment, voucherRedemption: s.discount,
    voucherBalanceUses: s.discount ? [] : [{ ...s.use, balance: s.balance, entries: s.entries }],
    cancellationRequests: s.request ? [s.request] : [] };
}
function transaction(s: State) {
  return {
    $queryRaw: vi.fn(), user: { findUnique: vi.fn(async () => ({ role: "ADMIN" })) },
    booking: { findUnique: vi.fn(async () => loadedBooking(s)), findUniqueOrThrow: vi.fn(async () => loadedBooking(s)), update: vi.fn(async ({ data }) => Object.assign(s.booking, data)) },
    payment: { findUnique: vi.fn(async () => ({ ...s.payment, booking: loadedBooking(s) })), update: vi.fn(async ({ data }) => Object.assign(s.payment!, data)) },
    ticket: { updateMany: vi.fn(async () => { s.ticketStatus = "CANCELLED"; }) },
    voucherBalance: { updateMany: vi.fn(async ({ data }) => { s.balance.balanceMinor += data.balanceMinor.increment; return { count: 1 }; }) },
    voucherBalanceUse: { update: vi.fn(async ({ data }) => Object.assign(s.use, data)) },
    voucherRedemption: { update: vi.fn(async ({ data }) => Object.assign(s.discount!, data)) },
    voucherBalanceEntry: { create: vi.fn(async ({ data }) => { s.entries.push({ id: "restore", ...data }); }) },
    cancellationRequest: {
      findUnique: vi.fn(async () => s.request ? { ...s.request, booking: loadedBooking(s) } : null),
      create: vi.fn(async ({ data }) => { s.request = { id: "request", refundAttempt: 0, stripeRefundId: null, refundStartedAt: null, refundLockedUntil: null, refundError: null, ...data }; return s.request; }),
      update: vi.fn(async ({ data }) => Object.assign(s.request!, data)),
      updateMany: vi.fn(async ({ data }) => { Object.assign(s.request!, data); return { count: 1 }; }),
    },
    stripeWebhookEvent: { findUnique: vi.fn(async ({ where }) => s.webhookIds.includes(where.id) ? { id: where.id } : null), create: vi.fn(async ({ data }) => { s.webhookIds.push(data.id); }) },
  };
}
const refund = (status = "succeeded") => ({ id: "refund", status, amount: 1000, currency: "eur", payment_intent: "intent", metadata: { cancellationRequestId: "request", attempt: "0" } }) as unknown as Stripe.Refund;
const charge = (amount = 1000) => ({ id: "charge", amount: 1000, amount_refunded: amount, currency: "eur", payment_intent: "intent" }) as Stripe.Charge;
beforeEach(() => {
  vi.resetAllMocks(); state = fixture();
  db.$transaction.mockImplementation(async work => {
    const staged = structuredClone(state); const result = await work(transaction(staged)); state = staged; return result;
  });
  db.cancellationRequest.findUniqueOrThrow.mockImplementation(async () => ({ ...state.request, booking: loadedBooking(state) }));
  db.cancellationRequest.update.mockImplementation(async ({ data }) => { Object.assign(state.request!, data); return { ...state.request, booking: loadedBooking(state) }; });
  db.cancellationRequest.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.refundStatus?.in && !where.refundStatus.in.includes(state.request!.refundStatus)) return { count: 0 };
    if (where.refundStatus === "PENDING" && state.request!.refundStatus !== "PENDING") return { count: 0 };
    Object.assign(state.request!, data); return { count: 1 };
  });
  stripe.refunds.list.mockImplementation(async function* () {});
  stripe.refunds.create.mockResolvedValue(refund()); stripe.refunds.retrieve.mockResolvedValue(refund());
});
it("returns stored value at approval, refunds only Stripe remainder, and replays both paths safely", async () => {
  const expiry = state.balance.expiresAt;
  await requestCancellation("booking", "", "free");
  expect(state.balance.balanceMinor).toBe(2500); expect(state.balance.reservedMinor).toBe(100);
  expect(state.balance.expiresAt).toEqual(expiry); expect(state.use.status).toBe("REVERSED");
  expect(state.request!.refundStatus).toBe("PENDING"); expect(state.payment!.status).toBe("PAID");
  expect(state.entries[1]).toMatchObject({ type: "RESTORE", reversalOfId: "spend", operationKey: "voucher:restore:full:use", cancellationRequestId: "request" });
  await requestCancellation("booking", "", "free"); await decideCancellation("request", "APPROVED");
  await processCancellationRefund("request"); await applyCancellationRefund(refund(), "account");
  expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }), { stripeAccount: "account", idempotencyKey: "cancellation-request-0" });
  expect(state.request!.refundStatus).toBe("SUCCEEDED"); expect(state.entries).toHaveLength(2); expect(state.balance.balanceMinor).toBe(2500);
});
it.each([false, true])("reverses a discount and returns all usage limits (zero payment: %s)", async zero => {
  state.discount = { id: "discount", status: "COMMITTED", campaignId: "campaign", discountAmountMinor: 2000, currency: "EUR", reversedAt: null, limitReturnedAt: null };
  state.price.discountAmountMinor = 2000; state.price.voucherAmountMinor = 0;
  if (zero) { state.payment = null; state.price.payableAmountMinor = 0; state.price.originalAmountMinor = 2000; }
  await requestCancellation("booking", "", "free");
  expect(state.discount.status).toBe("REVERSED"); expect(state.discount.limitReturnedAt).toBeInstanceOf(Date);
  expect(state.entries).toHaveLength(1); expect(state.request!.refundStatus).toBe(zero ? "NONE" : "PENDING");
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("cancels a zero-payment stored-value booking without Stripe and without reviving expired balance", async () => {
  state.payment = null; state.price.payableAmountMinor = 0; state.price.originalAmountMinor = 2000; state.balance.status = "EXPIRED";
  await requestCancellation("booking", "", "free");
  expect(state.booking.status).toBe("CANCELLED"); expect(state.balance.status).toBe("EXPIRED");
  expect(state.balance.expiresAt).toEqual(new Date("2020-01-01")); expect(state.balance.balanceMinor).toBe(2500);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("keeps a pending remote refund resumable without repeating local restoration", async () => {
  await requestCancellation("booking", "", "free");
  stripe.refunds.create.mockResolvedValue(refund("pending"));
  await processCancellationRefund("request");
  expect(state.request!.refundStatus).toBe("PENDING"); expect(state.payment!.status).toBe("PAID");
  await processCancellationRefund("request");
  expect(state.request!.refundStatus).toBe("SUCCEEDED"); expect(stripe.refunds.create).toHaveBeenCalledOnce(); expect(state.entries).toHaveLength(2);
});
it("recovers a lost Stripe response under the same attempt without restoring twice", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await requestCancellation("booking", "", "free");
  stripe.refunds.create.mockRejectedValueOnce(new Error("network unavailable"));
  await processCancellationRefund("request");
  expect(state.request!.refundStatus).toBe("PENDING"); expect(state.request!.refundAttempt).toBe(0);
  stripe.refunds.list.mockImplementation(async function* () { yield refund(); });
  await processCancellationRefund("request");
  expect(state.request!.refundStatus).toBe("SUCCEEDED"); expect(state.entries).toHaveLength(2);
  expect(stripe.refunds.create).toHaveBeenCalledOnce(); log.mockRestore();
});
it("keeps local restoration after a definitive Stripe failure", async () => {
  await requestCancellation("booking", "", "free");
  await applyCancellationRefund(refund("failed"), "account");
  expect(state.request!.refundStatus).toBe("FAILED"); expect(state.payment!.status).toBe("PAID");
  expect(state.use.status).toBe("REVERSED"); expect(state.entries).toHaveLength(2);
});
it("restores external full refunds once across duplicate and different event IDs", async () => {
  await applyRefund(charge(), "account", "payment", "event", ["refund"]);
  await applyRefund(charge(), "account", "payment", "event", ["refund"]);
  await applyRefund(charge(), "account", "payment", "event-2", ["refund"]);
  expect(state.entries).toHaveLength(2); expect(state.entries[1]).toMatchObject({ externalRefundId: "refund" });
  expect(state.balance.balanceMinor).toBe(2500); expect(state.booking.status).toBe("CANCELLED");
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("closes a pending cancellation request on verified external full refund without initiating another", async () => {
  await requestCancellation("booking", "", "request");
  await applyRefund(charge(), "account", "payment", "full", ["refund"]);
  expect(state.request).toMatchObject({ status: "APPROVED", refundStatus: "SUCCEEDED" });
  expect(state.entries).toHaveLength(2); expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("marks external partial refunds without returning value or cancelling tickets", async () => {
  await applyRefund(charge(500), "account", "payment", "partial", ["refund-partial"]);
  expect(state.payment!.status).toBe("PARTIALLY_REFUNDED"); expect(state.use.status).toBe("COMMITTED");
  expect(state.entries).toHaveLength(1); expect(state.ticketStatus).toBe("VALID");
  await expect(requestCancellation("booking", "", "free")).rejects.toThrow();
});
it("marks an approved refund for review after external partial payment without a second voucher credit", async () => {
  await requestCancellation("booking", "", "free");
  await applyRefund(charge(500), "account", "payment", "partial", ["partial-refund"]);
  expect(state.request!.refundStatus).toBe("REVIEW"); expect(state.entries).toHaveLength(2);
  expect(state.balance.balanceMinor).toBe(2500); expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("does not regress a completed refund on a delayed partial event", async () => {
  await applyRefund(charge(), "account", "payment", "full", ["refund"]);
  await applyRefund(charge(500), "account", "payment", "late", ["partial"]);
  expect(state.payment!.status).toBe("REFUNDED"); expect(state.entries).toHaveLength(2);
});
it("rolls back approval and restoration if SPEND evidence is missing", async () => {
  state.entries = [];
  await expect(requestCancellation("booking", "", "free")).rejects.toThrow();
  expect(state.request).toBeNull(); expect(state.booking.status).toBe("CONFIRMED"); expect(state.balance.balanceMinor).toBe(500);
});
it("rolls back journal and balance if the cancellation outbox fails", async () => {
  queue.mockRejectedValue(new Error("outbox unavailable"));
  await expect(requestCancellation("booking", "", "free")).rejects.toThrow();
  expect(state.entries).toHaveLength(1); expect(state.balance.balanceMinor).toBe(500); expect(state.request).toBeNull();
});
it("retries competing reversals against the winning transaction (simulated Serializable)", async () => {
  state.payment!.status = "REFUNDED";
  let version = 0, arrivals = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  db.$transaction.mockImplementation(async work => {
    const readVersion = version, staged = structuredClone(state);
    const result = await work(transaction(staged));
    if (readVersion === 0) { if (++arrivals === 2) release(); await barrier; }
    if (version !== readVersion) throw new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" });
    state = staged; version++; return result;
  });
  await Promise.all([1, 2].map(() => cancellationTransaction(tx => reverseBookingVoucher(tx, "booking", { externalRefundId: "refund" }))));
  expect(state.entries).toHaveLength(2); expect(state.balance.balanceMinor).toBe(2500); expect(db.$transaction).toHaveBeenCalledTimes(3);
});
