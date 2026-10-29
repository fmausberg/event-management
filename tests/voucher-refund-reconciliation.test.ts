import { beforeEach, expect, it, vi } from "vitest";
import { reconcileVoucherRefunds } from "@/lib/payments/refund-reconciliation";
const { db, stripe, applyRefund } = vi.hoisted(() => ({
  db: { payment: { findMany: vi.fn(), update: vi.fn() } }, applyRefund: vi.fn(),
  stripe: { paymentIntents: { retrieve: vi.fn() }, charges: { retrieve: vi.fn() }, refunds: { list: vi.fn(), create: vi.fn() } },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/payments/stripe", () => ({ getStripe: () => stripe }));
vi.mock("@/lib/payments/fulfillment", () => ({ applyRefund }));
beforeEach(() => {
  vi.resetAllMocks();
  db.payment.findMany.mockResolvedValue([{ id: "payment", stripeAccountId: "account", paymentIntentId: "intent" }]);
  stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: "charge", metadata: { paymentId: "payment" } });
  stripe.charges.retrieve.mockResolvedValue({ id: "charge", amount: 2000, payment_intent: "intent" });
  stripe.refunds.list.mockImplementation(async function* () { yield { id: "refund", status: "succeeded", amount: 2000 }; yield { id: "pending", status: "pending", amount: 100 }; });
});
it("recovers a lost full-refund webhook with current Stripe data and references", async () => {
  expect(await reconcileVoucherRefunds()).toEqual({ checked: 1, failures: 0 });
  expect(applyRefund).toHaveBeenCalledWith(expect.objectContaining({ amount_refunded: 2000 }), "account", "payment", undefined, ["refund"]);
  expect(db.payment.update).toHaveBeenCalledWith({ where: { id: "payment" }, data: { updatedAt: expect.any(Date) } });
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it("retains unresolved state and rotates failed batches without initiating refunds", async () => {
  stripe.paymentIntents.retrieve.mockRejectedValue(new Error("unavailable"));
  expect(await reconcileVoucherRefunds()).toEqual({ checked: 1, failures: 1 });
  expect(applyRefund).not.toHaveBeenCalled(); expect(stripe.refunds.create).not.toHaveBeenCalled();
  expect(db.payment.update).toHaveBeenCalledOnce();
});
