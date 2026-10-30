import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enqueueDueReviews, deliverPendingReviews } from "@/lib/reviews/invitations";
import { deliverEncryptedMail } from "@/lib/tickets/outbox";
import { decryptPaymentMail, encryptPaymentMail } from "@/lib/payments/mail";
import { hashReviewToken } from "@/lib/reviews/token";
const { db, sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(), db: {
  $queryRaw: vi.fn(), $transaction: vi.fn(), booking: { findUnique: vi.fn() },
  eventReview: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  mailOutbox: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/mail", () => ({ sendMail }));
vi.mock("@/lib/auth/verification", () => ({ accountOrigin: () => "https://example.com" }));
let job: { id: string; lockToken: string | null; lockedUntil: Date | null; sentAt: Date | null; cancelledAt: Date | null; attempts: number; availableAt: Date; encryptedMessage: string | null };
let review: { expiresAt: Date; submittedAt: Date | null; event: { endsAt: Date | null; status: string }; ticket: { checkedInAt: Date | null } };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
  vi.stubEnv("AUTH_SECRET", "review-outbox-test"); vi.spyOn(console, "error").mockImplementation(() => {});
  db.$transaction.mockImplementation(fn => fn(db));
  db.$queryRaw.mockResolvedValueOnce([{ id: "booking" }]).mockResolvedValue([]);
  db.booking.findUnique.mockResolvedValue({ id: "booking", eventId: "event", customerEmail: " Person@Example.com ", user: null,
    event: { endsAt: new Date(1), status: "COMPLETED", name: "Yoga" }, tickets: [{ id: "ticket" }] });
  db.eventReview.findUnique.mockResolvedValue(null); db.eventReview.create.mockResolvedValue({ id: "review" });
  job = { id: "mail", lockToken: null, lockedUntil: null, sentAt: null, cancelledAt: null, attempts: 0, availableAt: new Date(),
    encryptedMessage: encryptPaymentMail({ to: "person@example.com", subject: "Bewertung", text: "secret-link" }) };
  review = { expiresAt: new Date(Date.now() + 60000), submittedAt: null, event: { endsAt: new Date(1), status: "COMPLETED" }, ticket: { checkedInAt: new Date(1) } };
  db.eventReview.findFirst.mockImplementation(async () => review);
  db.mailOutbox.findFirst.mockImplementation(async () => ({ ...job }));
  db.mailOutbox.findMany.mockResolvedValue([{ id: "mail" }]);
  db.mailOutbox.updateMany.mockImplementation(async ({ where, data }) => {
    if (job.sentAt || job.cancelledAt || (where.lockToken && where.lockToken !== job.lockToken)) return { count: 0 };
    if (where.OR && (job.availableAt > new Date() || (job.lockedUntil && job.lockedUntil >= new Date()))) return { count: 0 };
    const attempts = job.attempts;
    Object.assign(job, data);
    if (data.attempts) job.attempts = attempts + 1;
    return { count: 1 };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it("atomically queues one normalized recipient, stores only hash and encrypted payload", async () => {
  expect(await enqueueDueReviews()).toEqual({ checked: 1, queued: 1, failures: 0 });
  const data = db.eventReview.create.mock.calls[0][0].data;
  expect(data.recipientEmail).toBe("person@example.com");
  expect(data.ticketId).toBe("ticket"); expect(data.expiresAt.getTime() - Date.now()).toBe(30 * 24 * 60 * 60_000);
  const outbox = db.mailOutbox.create.mock.calls[0][0].data;
  expect(outbox.requestKey).toBe("event-review:review");
  const message = decryptPaymentMail(outbox.encryptedMessage);
  const secret = new URLSearchParams(new URL(message.text.match(/https:\/\/\S+/)![0]).hash.slice(1)).get("token")!;
  expect(data.tokenHash).toBe(hashReviewToken(secret)); expect(JSON.stringify(data)).not.toContain(secret);
  expect(outbox.encryptedMessage).not.toContain(secret);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
});
it("does not duplicate an existing event/recipient invitation on another booking", async () => {
  db.eventReview.findUnique.mockResolvedValue({ id: "review" });
  expect((await enqueueDueReviews()).queued).toBe(0);
  expect(db.eventReview.findUnique).toHaveBeenCalledWith({ where: { eventId_recipientEmail: { eventId: "event", recipientEmail: "person@example.com" } } });
  expect(db.mailOutbox.create).not.toHaveBeenCalled();
});
it("does not enqueue future events or tickets without check-in", async () => {
  db.booking.findUnique.mockResolvedValue({ tickets: [], event: { endsAt: new Date(0) } });
  await enqueueDueReviews(); expect(db.eventReview.create).not.toHaveBeenCalled();
  db.$queryRaw.mockResolvedValueOnce([{ id: "booking" }]).mockResolvedValue([]);
  db.booking.findUnique.mockResolvedValue({ tickets: [{ id: "ticket" }], event: { endsAt: new Date(Date.now() + 1), status: "PUBLISHED" } });
  await enqueueDueReviews(); expect(db.eventReview.create).not.toHaveBeenCalled();
});
it("skips invalid legacy addresses and continues to later candidates", async () => {
  db.$queryRaw.mockReset().mockResolvedValueOnce([{ id: "bad" }]).mockResolvedValueOnce([{ id: "good" }]).mockResolvedValue([]);
  db.booking.findUnique.mockResolvedValueOnce({ tickets: [{ id: "ticket" }], event: { endsAt: new Date(1), status: "COMPLETED" }, customerEmail: "invalid" });
  expect((await enqueueDueReviews()).queued).toBe(1);
  expect(db.$queryRaw).toHaveBeenCalledTimes(3);
});
it("only one concurrent worker sends; successful delivery clears payload and timestamps invitation", async () => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  sendMail.mockImplementation(() => new Promise<void>(resolve => { release = resolve; started(); }));
  const first = deliverEncryptedMail("mail", "review"); await ready;
  await deliverEncryptedMail("mail", "review"); expect(sendMail).toHaveBeenCalledTimes(1);
  release(); await first;
  expect(job.encryptedMessage).toBeNull(); expect(job.sentAt).toBeInstanceOf(Date);
  expect(db.eventReview.updateMany).toHaveBeenCalledWith({ where: { mail: { is: { id: "mail" } } }, data: { sentAt: expect.any(Date) } });
});
it("failed SMTP retries with the same secret and a backoff", async () => {
  const payload = job.encryptedMessage;
  sendMail.mockRejectedValueOnce(new Error("SMTP"));
  expect((await deliverPendingReviews()).failures).toBe(1);
  expect(job.encryptedMessage).toBe(payload); expect(job.availableAt.getTime()).toBe(Date.now() + 30000);
  await deliverPendingReviews(); expect(sendMail).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30001);
  expect((await deliverPendingReviews()).delivered).toBe(1);
});
it("does not send before a rescheduled event ends", async () => {
  review.event.endsAt = new Date(Date.now() + 60000);
  expect((await deliverPendingReviews()).failures).toBe(1); expect(sendMail).not.toHaveBeenCalled();
});
it("erases and cancels expired invitations without sending", async () => {
  review.expiresAt = new Date(0);
  await deliverPendingReviews(); expect(sendMail).not.toHaveBeenCalled();
  expect(job.cancelledAt).toBeInstanceOf(Date); expect(job.encryptedMessage).toBeNull();
});
