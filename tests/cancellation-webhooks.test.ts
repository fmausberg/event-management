import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";

const { stripe, applyRefund, applyCancellationRefund, processCancellationRefund, findFirst } = vi.hoisted(() => ({
  applyRefund: vi.fn(), applyCancellationRefund: vi.fn(), processCancellationRefund: vi.fn(), findFirst: vi.fn(),
  stripe: { webhooks: { constructEvent: vi.fn() }, refunds: { retrieve: vi.fn(), list: vi.fn() }, charges: { retrieve: vi.fn() }, paymentIntents: { retrieve: vi.fn() } },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/stripe", () => ({ getStripe: () => stripe }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ cancellationRequest: { findFirst } }) }));
vi.mock("@/lib/payments/fulfillment", () => ({ applyRefund, applyCheckoutSession: vi.fn() }));
vi.mock("@/lib/payments/mail", () => ({ deliverPaymentMail: vi.fn() }));
vi.mock("@/lib/cancellations/refunds", () => ({ applyCancellationRefund, processCancellationRefund }));
vi.mock("@/lib/cancellations/mail", () => ({ deliverCancellationMails: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("STRIPE_WEBHOOK_SECRET", "secret");
  stripe.charges.retrieve.mockResolvedValue({ id: "ch_1", amount: 2500, amount_refunded: 2500, payment_intent: "pi_1", currency: "eur" });
  stripe.paymentIntents.retrieve.mockResolvedValue({ metadata: { paymentId: "payment" } });
  findFirst.mockResolvedValue({ id: "request" });
});
it("never counts pending or failed refunds as settled, even in charge.refunded", async () => {
  stripe.webhooks.constructEvent.mockReturnValue({ id: "evt_1", type: "charge.refunded", account: "acct_1", data: { object: { id: "ch_1" } } });
  stripe.refunds.list.mockImplementation(async function* () { yield { amount: 1000, status: "succeeded" }; yield { amount: 1000, status: "pending" }; yield { amount: 500, status: "failed" }; });
  const result = await POST(new Request("https://example.com", { method: "POST", body: "{}" }));
  expect(result.status).toBe(200);
  expect(applyRefund).toHaveBeenCalledWith(expect.objectContaining({ amount_refunded: 1000 }), "acct_1", "payment", "evt_1");
  expect(processCancellationRefund).toHaveBeenCalledWith("request");
});
it.each(["refund.created", "refund.updated", "refund.failed"])("retrieves current connected-account state for %s", async (type) => {
  stripe.webhooks.constructEvent.mockReturnValue({ id: "evt_1", type, account: "acct_1", data: { object: { id: "re_1", status: "pending" } } });
  stripe.refunds.retrieve.mockResolvedValue({ id: "re_1", status: "succeeded", charge: null });
  expect((await POST(new Request("https://example.com", { method: "POST", body: "{}" }))).status).toBe(200);
  expect(stripe.refunds.retrieve).toHaveBeenCalledWith("re_1", {}, { stripeAccount: "acct_1" });
  expect(applyCancellationRefund).toHaveBeenCalledWith({ id: "re_1", status: "succeeded", charge: null }, "acct_1");
});
