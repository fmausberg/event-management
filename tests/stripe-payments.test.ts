import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Stripe from "stripe";
import type { Payment } from "@prisma/client";
import { applyCheckoutSession, applyRefund } from "@/lib/payments/fulfillment";
import { ensureCheckout } from "@/lib/payments/checkout";
import { encryptPaymentMail, decryptPaymentMail, deliverPaymentMail } from "@/lib/payments/mail";
import { euroAmount } from "@/lib/payments/stripe";
import { POST } from "@/app/api/webhooks/stripe/route";

const { db, stripe, sendMail } = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), payment: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, booking: { update: vi.fn() },
    ticket: { createMany: vi.fn(), updateMany: vi.fn() },
    stripeWebhookEvent: { findUnique: vi.fn(), create: vi.fn() },
    paymentMail: { create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
  stripe: { checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } }, webhooks: { constructEvent: vi.fn() } },
  sendMail: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/mail", () => ({ sendMail }));
vi.mock("@/lib/payments/stripe", async (original) => ({ ...await original<typeof import("@/lib/payments/stripe")>(), getStripe: () => stripe }));

function payment() {
  return { id: "payment-1", bookingId: "booking-1", stripeAccountId: "acct_company", checkoutSessionId: "cs_1", paymentIntentId: null, publicToken: "public-token", amount: 2500, currency: "EUR", status: "PENDING", createdAt: new Date(), updatedAt: new Date(), checkoutRequest: { mode: "payment" },
    booking: { id: "booking-1", number: 42, quantity: 2, customerName: "Ada", customerEmail: "ada@example.com", event: { name: "Yoga", beginsAt: new Date("2099-01-01") } },
  };
}
function session(overrides: Record<string, unknown> = {}) {
  return { id: "cs_1", metadata: { paymentId: "payment-1" }, client_reference_id: "booking-1", amount_total: 2500, currency: "eur", mode: "payment", status: "complete", payment_status: "paid", payment_intent: "pi_1", ...overrides } as unknown as Stripe.Checkout.Session;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-encryption-secret");
  vi.stubEnv("AUTH_URL", "https://events.example.com");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.payment.findUnique.mockResolvedValue(payment());
  db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
  db.paymentMail.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => vi.unstubAllEnvs());

it("confirms paid bookings and persists encrypted ticket mail atomically", async () => {
  await applyCheckoutSession(session(), "acct_company", "evt_1");
  expect(db.booking.update).toHaveBeenCalledWith({ where: { id: "booking-1" }, data: { status: "CONFIRMED", reservedUntil: null } });
  const tickets = db.ticket.createMany.mock.calls[0][0].data;
  expect(tickets).toHaveLength(2);
  expect(new Set(tickets.map((t: { publicTokenHash: string }) => t.publicTokenHash)).size).toBe(2);
  const encrypted = db.paymentMail.create.mock.calls[0][0].data.encryptedMessage;
  expect(encrypted).not.toContain("ada@example.com");
  const mail = decryptPaymentMail(encrypted);
  expect(mail.text).toContain("https://events.example.com/tickets#");
  expect(mail.to).toBe("ada@example.com");
  expect(sendMail).not.toHaveBeenCalled();
  expect(db.stripeWebhookEvent.create).toHaveBeenCalledWith({ data: { id: "evt_1" } });
});
it.each([
  { payment_status: "unpaid" }, { status: "open", payment_status: "unpaid" },
])("does not issue tickets before confirmed payment: %j", async (overrides) => {
  await applyCheckoutSession(session(overrides), "acct_company", "evt_1");
  expect(db.ticket.createMany).not.toHaveBeenCalled();
  expect(db.booking.update).not.toHaveBeenCalled();
});
it.each([{ amount_total: 1 }, { currency: "usd" }, { client_reference_id: "foreign" }, { id: "cs_foreign" }, { mode: "subscription" }])("rejects mismatched checkout data: %j", async (overrides) => {
  await expect(applyCheckoutSession(session(overrides), "acct_company", "evt_1")).rejects.toThrow("mismatch");
  expect(db.payment.update).not.toHaveBeenCalled();
});
it("rejects payment from another company even with matching metadata", async () => {
  await expect(applyCheckoutSession(session(), "acct_foreign", "evt_1")).rejects.toThrow("mismatch");
});
it("handles both duplicate event IDs and different events for an already paid booking", async () => {
  db.stripeWebhookEvent.findUnique.mockResolvedValue({ id: "evt_1" });
  await applyCheckoutSession(session(), "acct_company", "evt_1");
  expect(db.ticket.createMany).not.toHaveBeenCalled();
  db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
  db.payment.findUnique.mockResolvedValue({ ...payment(), status: "PAID" });
  await applyCheckoutSession(session(), "acct_company", "evt_2");
  expect(db.ticket.createMany).not.toHaveBeenCalled();
});
it("only frees reservations after Stripe confirms expiry", async () => {
  await applyCheckoutSession(session({ status: "open", payment_status: "unpaid" }), "acct_company");
  expect(db.booking.update).not.toHaveBeenCalled();
  await applyCheckoutSession(session({ status: "expired", payment_status: "unpaid", payment_intent: null }), "acct_company");
  expect(db.booking.update).toHaveBeenCalledWith({ where: { id: "booking-1" }, data: { status: "EXPIRED", reservedUntil: null } });
  expect(db.ticket.createMany).not.toHaveBeenCalled();
});
it("does not undo paid bookings when expiry events arrive late", async () => {
  db.payment.findUnique.mockResolvedValue({ ...payment(), status: "PAID" });
  await applyCheckoutSession(session({ status: "expired", payment_status: "unpaid" }), "acct_company");
  expect(db.booking.update).not.toHaveBeenCalled();
});
it("retries the same checkout with frozen parameters and connected-account idempotency", async () => {
  const p = { ...payment(), checkoutSessionId: null } as Payment;
  stripe.checkout.sessions.create.mockResolvedValue(session());
  db.payment.update.mockRejectedValueOnce(new Error("connection lost after Stripe committed"));
  await expect(ensureCheckout(p)).rejects.toThrow();
  await ensureCheckout(p);
  expect(stripe.checkout.sessions.create.mock.calls[0]).toEqual(stripe.checkout.sessions.create.mock.calls[1]);
  expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(p.checkoutRequest, { stripeAccount: "acct_company", idempotencyKey: "ticket-checkout-payment-1" });
});
it("does not create a new checkout after the idempotency retention window", async () => {
  await expect(ensureCheckout({ ...payment(), checkoutSessionId: null, createdAt: new Date(0) } as Payment)).rejects.toThrow("manual reconciliation");
  expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
it("migrates a definitively rejected legacy request with a stable versioned retry key", async () => {
  const p = { ...payment(), checkoutSessionId: null, checkoutRequest: { mode: "payment", payment_method_types: ["card"], expires_at: 12345 } } as Payment;
  stripe.checkout.sessions.create.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ param: "payment_method_types", message: "The payment_method_types parameter is no longer supported" })).mockResolvedValueOnce(session());
  const updated = { ...p, checkoutRequest: { mode: "payment", allowed_payment_method_types: ["card"], expires_at: 12345, metadata: { checkoutRequestVersion: "card-filter-v2" } } };
  db.payment.update.mockResolvedValueOnce(updated);
  await ensureCheckout(p);
  expect(stripe.checkout.sessions.create.mock.calls[1]).toEqual([updated.checkoutRequest, { stripeAccount: "acct_company", idempotencyKey: "ticket-checkout-payment-1-card-filter-v2" }]);
  expect(db.payment.update.mock.calls[0][0].data.checkoutRequest).toEqual(updated.checkoutRequest);
  expect(db.booking.update).not.toHaveBeenCalled();
});
it("does not rewrite a legacy request on an ambiguous network failure", async () => {
  const p = { ...payment(), checkoutSessionId: null, checkoutRequest: { mode: "payment", payment_method_types: ["card"] } } as Payment;
  stripe.checkout.sessions.create.mockRejectedValue(new Error("network failure"));
  await expect(ensureCheckout(p)).rejects.toThrow("network failure");
  expect(db.payment.update).not.toHaveBeenCalled();
});
it("releases a never-created checkout only on a definitive expired-parameter rejection", async () => {
  const p = { ...payment(), checkoutSessionId: null, checkoutRequest: { expires_at: Math.floor(Date.now() / 1000) - 60 } } as Payment;
  stripe.checkout.sessions.create.mockRejectedValueOnce(new Error("connection lost"));
  await expect(ensureCheckout(p)).rejects.toThrow();
  expect(db.booking.update).not.toHaveBeenCalled();
  stripe.checkout.sessions.create.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ message: "expired", param: "expires_at" }));
  db.payment.updateMany.mockResolvedValue({ count: 1 });
  await expect(ensureCheckout(p)).rejects.toThrow();
  expect(db.booking.update).toHaveBeenCalledWith({ where: { id: "booking-1" }, data: { status: "EXPIRED", reservedUntil: null } });
});
it("retrieves connected-account checkout state before handling a valid webhook", async () => {
  stripe.webhooks.constructEvent.mockReturnValue({ id: "evt_1", account: "acct_company", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  stripe.checkout.sessions.retrieve.mockResolvedValue(session());
  const response = await POST(new Request("https://events.example.com", { method: "POST", body: "{}" }));
  expect(response.status).toBe(200);
  expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_1", {}, { stripeAccount: "acct_company" });
  expect(db.ticket.createMany).toHaveBeenCalledTimes(1);
});
it("full refunds cancel tickets; partial refunds preserve them", async () => {
  db.payment.findUnique.mockResolvedValue({ ...payment(), status: "PAID", paymentIntentId: "pi_1" });
  const charge = { amount: 2500, amount_refunded: 1000, currency: "eur", payment_intent: "pi_1" } as Stripe.Charge;
  await applyRefund(charge, "acct_company", "payment-1", "evt_partial");
  expect(db.ticket.updateMany).not.toHaveBeenCalled();
  await applyRefund({ ...charge, amount_refunded: 2500 }, "acct_company", "payment-1", "evt_full");
  expect(db.ticket.updateMany).toHaveBeenCalledWith({ where: { bookingId: "booking-1" }, data: { status: "CANCELLED" } });
});
it("retries refunds delivered before checkout fulfillment", async () => {
  const charge = { amount: 2500, amount_refunded: 2500, currency: "eur", payment_intent: "pi_1" } as Stripe.Charge;
  await expect(applyRefund(charge, "acct_company", "payment-1", "evt_refund")).rejects.toThrow("pending");
  expect(db.stripeWebhookEvent.create).not.toHaveBeenCalled();
});
it("retries failed SMTP delivery using the same encrypted message", async () => {
  const encryptedMessage = encryptPaymentMail({ to: "ada@example.com", subject: "Tickets", text: "ticket-secret" });
  db.paymentMail.findUniqueOrThrow.mockResolvedValue({ encryptedMessage });
  db.paymentMail.updateMany.mockResolvedValue({ count: 1 });
  sendMail.mockRejectedValueOnce(new Error("SMTP unavailable")).mockResolvedValueOnce({});
  await expect(deliverPaymentMail("payment-1")).rejects.toThrow("SMTP");
  expect(db.paymentMail.update).not.toHaveBeenCalled();
  await deliverPaymentMail("payment-1");
  expect(sendMail.mock.calls[0]).toEqual(sendMail.mock.calls[1]);
  expect(db.paymentMail.update).toHaveBeenCalledWith({ where: { paymentId: "payment-1" }, data: { sentAt: expect.any(Date), encryptedMessage: null, lockedUntil: null } });
});
it("rejects tampered encrypted mail", () => {
  const value = encryptPaymentMail({ to: "a@example.com", subject: "Tickets", text: "secret" });
  expect(() => decryptPaymentMail(value.slice(0, -5) + "AAAAA")).toThrow();
});
it("verifies the raw webhook signature before any database access", async () => {
  stripe.webhooks.constructEvent.mockImplementation(() => { throw new Error("bad signature"); });
  const response = await POST(new Request("https://events.example.com/api/webhooks/stripe", { method: "POST", body: "raw body", headers: { "stripe-signature": "invalid" } }));
  expect(response.status).toBe(400);
  expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith("raw body", "invalid", "whsec_test");
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("ignores platform-account events", async () => {
  stripe.webhooks.constructEvent.mockReturnValue({ id: "evt_platform", type: "checkout.session.completed", data: { object: session() } });
  expect((await POST(new Request("https://events.example.com", { method: "POST", body: "{}" }))).status).toBe(200);
  expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
});
it("converts money exactly and rejects unsupported or out-of-range amounts", () => {
  expect(euroAmount("12.50", "EUR", 3)).toBe(3750);
  expect(euroAmount("0.29", "EUR", 3)).toBe(87);
  for (const [price, currency, quantity] of [["0.01", "EUR", 1], ["1.00", "JPY", 1], ["999999.99", "EUR", 2], ["1.005", "EUR", 1]] as const) {
    expect(() => euroAmount(price, currency, quantity)).toThrow();
  }
});
