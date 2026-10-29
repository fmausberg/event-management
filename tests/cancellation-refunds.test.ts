import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import * as refundReconciliation from "@/lib/payments/refund-reconciliation";
import { applyCancellationRefund, processCancellationRefund, retryCancellationRefund } from "@/lib/cancellations/refunds";

const { db, stripe, auth, queue } = vi.hoisted(() => ({ auth: vi.fn(), queue: vi.fn(), stripe: { refunds: { retrieve: vi.fn(), create: vi.fn(), list: vi.fn() } }, db: {
  $transaction: vi.fn(), cancellationRequest: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  payment: { update: vi.fn() }, booking: { update: vi.fn() }, ticket: { updateMany: vi.fn() },
  user: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/payments/stripe", () => ({ getStripe: () => stripe }));
vi.mock("@/lib/cancellations/mail", () => ({ queueCancellationMail: queue }));
function fixture() {
  return { id: "request", status: "APPROVED", bookingId: "booking", refundStatus: "PENDING", refundAttempt: 0, stripeRefundId: null as string | null, refundStartedAt: null as Date | null, refundLockedUntil: null as Date | null, refundError: null as string | null,
    booking: { id: "booking", userId: "owner", status: "CANCELLED", event: { companyId: "company" }, payment: { id: "payment", paymentIntentId: "pi_1", stripeAccountId: "acct_1", amount: 2500, currency: "EUR", status: "PAID" } } };
}
let current = fixture();
function refund(status = "succeeded", overrides = {}) {
  return { id: "re_1", status, payment_intent: "pi_1", amount: 2500, currency: "eur", metadata: { cancellationRequestId: "request", attempt: "0" }, ...overrides } as unknown as Stripe.Refund;
}
function list(...rows: Stripe.Refund[]) { return (async function* () { for (const row of rows) yield row; })(); }
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T12:00Z")); current = fixture();
  auth.mockResolvedValue({ user: { id: "admin" } }); db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.$transaction.mockImplementation((fn) => fn(db));
  db.cancellationRequest.findUnique.mockImplementation(async () => structuredClone(current));
  db.cancellationRequest.findUniqueOrThrow.mockImplementation(async () => structuredClone(current));
  db.cancellationRequest.update.mockImplementation(async ({ data }) => {
    const attempt = data.refundAttempt?.increment;
    Object.assign(current, { ...data, ...(attempt ? { refundAttempt: current.refundAttempt + attempt } : {}) });
    return structuredClone(current);
  });
  db.cancellationRequest.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.refundStatus && (typeof where.refundStatus === "string" ? current.refundStatus !== where.refundStatus : where.refundStatus.in ? !where.refundStatus.in.includes(current.refundStatus) : current.refundStatus === where.refundStatus.not)) return { count: 0 };
    if (where.OR && current.refundLockedUntil && current.refundLockedUntil > new Date()) return { count: 0 };
    Object.assign(current, data); return { count: 1 };
  });
  stripe.refunds.list.mockImplementation(() => list());
  stripe.refunds.create.mockResolvedValue(refund()); stripe.refunds.retrieve.mockResolvedValue(refund());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("creates one full connected-account refund with a stable idempotency key", async () => {
  await processCancellationRefund("request");
  expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_1", amount: 2500, metadata: { cancellationRequestId: "request", attempt: "0" } }, { stripeAccount: "acct_1", idempotencyKey: "cancellation-request-0" });
  expect(current.refundStatus).toBe("SUCCEEDED");
  expect(db.payment.update).toHaveBeenCalledWith({ where: { id: "payment" }, data: { status: "REFUNDED" } });
  await processCancellationRefund("request");
  expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
});
it("keeps payment PAID and tickets cancelled while Stripe is pending", async () => {
  stripe.refunds.create.mockResolvedValue(refund("pending"));
  await processCancellationRefund("request");
  expect(current.refundStatus).toBe("PENDING"); expect(current.stripeRefundId).toBe("re_1");
  expect(db.payment.update).not.toHaveBeenCalled(); expect(current.booking.status).toBe("CANCELLED");
  await processCancellationRefund("request");
  expect(stripe.refunds.retrieve).toHaveBeenCalledWith("re_1", {}, { stripeAccount: "acct_1" });
  expect(current.refundStatus).toBe("SUCCEEDED"); expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
});
it("does not mark unknown network outcomes refunded or use a new key", async () => {
  stripe.refunds.create.mockRejectedValue(new Error("network lost"));
  await processCancellationRefund("request"); await processCancellationRefund("request");
  expect(current.refundStatus).toBe("PENDING"); expect(current.refundAttempt).toBe(0);
  expect(db.payment.update).not.toHaveBeenCalled();
  expect(stripe.refunds.create.mock.calls[0][1]).toEqual(stripe.refunds.create.mock.calls[1][1]);
});
it("recovers an existing refund after a lost response without creating another", async () => {
  current.refundStartedAt = new Date("2026-10-20T12:00Z");
  stripe.refunds.list.mockImplementation(() => list(refund("pending")));
  await processCancellationRefund("request");
  expect(current.stripeRefundId).toBe("re_1"); expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("never reuses a pruned Stripe key after an ambiguous request", async () => {
  current.refundStartedAt = new Date("2026-10-20T12:00Z");
  await processCancellationRefund("request");
  expect(current.refundStatus).toBe("REVIEW"); expect(stripe.refunds.create).not.toHaveBeenCalled();
  expect(queue).toHaveBeenCalledWith(db, "request", "failed");
});
it("does not duplicate an external pending or partial refund", async () => {
  stripe.refunds.list.mockImplementation(() => list(refund("pending", { metadata: {} })));
  await processCancellationRefund("request");
  expect(current.refundStatus).toBe("REVIEW"); expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("records definitive failure and supports an authorized new attempt", async () => {
  await applyCancellationRefund(refund("failed"), "acct_1");
  expect(current.refundStatus).toBe("FAILED"); expect(db.payment.update).not.toHaveBeenCalled();
  expect(queue).toHaveBeenCalledWith(db, "request", "failed");
  stripe.refunds.create.mockResolvedValue(refund("succeeded", { id: "re_2", metadata: { cancellationRequestId: "request", attempt: "1" } }));
  await retryCancellationRefund("request");
  expect(current.refundAttempt).toBe(1); expect(current.refundStatus).toBe("SUCCEEDED");
  expect(stripe.refunds.create.mock.calls[0][1].idempotencyKey).toBe("cancellation-request-1");
});
it("rejects an unauthorized retry even for the booking owner", async () => {
  db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue(null);
  await expect(retryCancellationRefund("request")).rejects.toThrow();
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it.each(["COMPANY_ADMIN", "COMPANY_USER"])("allows active %s to resume a refund in their company", async (role) => {
  db.user.findUnique.mockResolvedValue({ role: "USER" });
  db.companyMembership.findUnique.mockResolvedValue({ status: "ACTIVE", role });
  await retryCancellationRefund("request");
  expect(db.companyMembership.findUnique).toHaveBeenCalledWith({ where: { companyId_userId: { companyId: "company", userId: "admin" } } });
  expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
});
it("does not downgrade success on repeated or late events", async () => {
  await applyCancellationRefund(refund(), "acct_1");
  await applyCancellationRefund(refund("pending"), "acct_1");
  await applyCancellationRefund(refund("failed"), "acct_1");
  expect(current.refundStatus).toBe("SUCCEEDED"); expect(db.payment.update).toHaveBeenCalledTimes(1);
});
it("ignores events from an older attempt", async () => {
  current.refundAttempt = 1;
  await applyCancellationRefund(refund("failed"), "acct_1");
  expect(current.refundStatus).toBe("PENDING"); expect(queue).not.toHaveBeenCalled();
});
it.each([{ amount: 1 }, { currency: "usd" }, { payment_intent: "pi_other" }])("rejects mismatched Stripe data %j", async (override) => {
  await expect(applyCancellationRefund(refund("succeeded", override), "acct_1")).rejects.toThrow("mismatch");
  expect(db.payment.update).not.toHaveBeenCalled();
});
it("rejects a different connected account", async () => {
  await expect(applyCancellationRefund(refund(), "acct_other")).rejects.toThrow("mismatch");
});
it("a concurrent worker cannot acquire the refund lease", async () => {
  current.refundLockedUntil = new Date(Date.now() + 60_000);
  await processCancellationRefund("request");
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("reconciles a failed request after a full dashboard refund without a new Stripe write", async () => {
  current.refundStatus = "FAILED"; current.stripeRefundId = "re_failed";
  current.booking.payment.status = "REFUNDED";
  await processCancellationRefund("request");
  expect(current.refundStatus).toBe("SUCCEEDED");
  expect(queue).toHaveBeenCalledWith(db, "request", "refunded");
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("checks external refunds even when the saved internal refund failed and its webhook was lost", async () => {
  current.refundStatus = "FAILED"; current.stripeRefundId = "re_1";
  stripe.refunds.retrieve.mockResolvedValue(refund("failed"));
  stripe.refunds.list.mockImplementation(() => list(refund("failed"), refund("succeeded", { id: "re_external", charge: "ch_external", metadata: {} })));
  const sync = vi.spyOn(refundReconciliation, "reconcileStripeCharge").mockResolvedValue("payment");
  await processCancellationRefund("request");
  expect(sync).toHaveBeenCalledWith("ch_external", "acct_1");
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
