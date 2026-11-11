import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/payments/reconcile/route";

const mocks = vi.hoisted(() => ({
  db: { payment: { findMany: vi.fn(), update: vi.fn() }, booking: { findMany: vi.fn(), update: vi.fn() } },
  cancel: vi.fn(), enqueue: vi.fn(), deliver: vi.fn(), refunds: vi.fn(), cancellations: vi.fn(),
  cancellationMails: vi.fn(), tickets: vi.fn(), company: vi.fn(), reviews: vi.fn(), reviewMails: vi.fn(),
  checkout: vi.fn(), fulfill: vi.fn(), release: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/lib/trainers/reminders", () => ({ cancelAutomaticTrainerReminders: mocks.cancel, enqueueDueTrainerReminders: mocks.enqueue, deliverPendingTrainerReminders: mocks.deliver }));
vi.mock("@/lib/payments/refund-reconciliation", () => ({ reconcileVoucherRefunds: mocks.refunds }));
vi.mock("@/lib/cancellations/refunds", () => ({ reconcileCancellationRefunds: mocks.cancellations }));
vi.mock("@/lib/cancellations/mail", () => ({ deliverCancellationMails: mocks.cancellationMails }));
vi.mock("@/lib/payments/checkout", () => ({ ensureCheckout: mocks.checkout }));
vi.mock("@/lib/payments/fulfillment", () => ({ applyCheckoutSession: mocks.fulfill }));
vi.mock("@/lib/tickets/outbox", () => ({ deliverPendingTicketMails: mocks.tickets, deliverPendingCompanyNotifications: mocks.company }));
vi.mock("@/lib/reviews/invitations", () => ({ enqueueDueReviews: mocks.reviews, deliverPendingReviews: mocks.reviewMails }));
vi.mock("@/lib/vouchers/service", () => ({ releaseExpiredVoucherReservation: mocks.release }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PAYMENTS_CRON_SECRET", "test-secret");
  mocks.db.payment.findMany.mockResolvedValue([{ id: "payment", stripeAccountId: "account" }]);
  mocks.db.booking.findMany.mockResolvedValue([]);
  mocks.checkout.mockResolvedValue("session");
  for (const fn of [mocks.refunds, mocks.tickets, mocks.company, mocks.reviews, mocks.reviewMails, mocks.enqueue, mocks.deliver]) {
    fn.mockResolvedValue({ checked: 1, queued: 1, delivered: 1, failures: 0 });
  }
  mocks.cancellations.mockResolvedValue(1);
  mocks.cancellationMails.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllEnvs());
const request = () => new Request("http://localhost/api/payments/reconcile", { method: "POST", headers: { authorization: "Bearer test-secret" } });

it.each([undefined, "", "false", "1", "TRUE"])("disables trainer automation for %s while preserving every other task", async (value) => {
  vi.stubEnv("AUTO_TRAINER_REMINDERS_ENABLED", value);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect((await response.json()).trainerReminders).toEqual({ checked: 0, queued: 0, delivered: 0 });
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.deliver).not.toHaveBeenCalled();
  for (const fn of [mocks.checkout, mocks.fulfill, mocks.refunds, mocks.tickets, mocks.company, mocks.reviews, mocks.reviewMails, mocks.cancellations, mocks.cancellationMails]) expect(fn).toHaveBeenCalledOnce();
});

it("requires explicit activation for enqueueing and delivery", async () => {
  vi.stubEnv("AUTO_TRAINER_REMINDERS_ENABLED", "true");
  expect((await POST(request())).status).toBe(200);
  expect(mocks.enqueue).toHaveBeenCalledOnce();
  expect(mocks.deliver).toHaveBeenCalledOnce();
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it("reports retirement failures and still processes cancellations", async () => {
  vi.stubEnv("AUTO_TRAINER_REMINDERS_ENABLED", "false");
  mocks.cancel.mockRejectedValue(new Error("database unavailable"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await POST(request())).status).toBe(503);
  expect(mocks.deliver).not.toHaveBeenCalled();
  expect(mocks.cancellationMails).toHaveBeenCalledOnce();
});

it("does not retire or send jobs for unauthorized requests", async () => {
  expect((await POST(new Request("http://localhost/api/payments/reconcile", { method: "POST" }))).status).toBe(401);
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.deliver).not.toHaveBeenCalled();
});
