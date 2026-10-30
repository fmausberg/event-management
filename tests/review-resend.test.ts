import { beforeEach, expect, it, vi } from "vitest";
import { resendReviewInvitation } from "@/lib/reviews/resend";
const { db, access, deliver } = vi.hoisted(() => ({ access: vi.fn(), deliver: vi.fn(), db: {
  $transaction: vi.fn(), companyMembership: { findUnique: vi.fn() }, ticket: { findFirst: vi.fn() },
  eventReview: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  eventReviewResendToken: { findUnique: vi.fn(), create: vi.fn() }, mailOutbox: { findUnique: vi.fn(), upsert: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/tickets/access", () => ({ requireEventTicketAccess: access }));
vi.mock("@/lib/tickets/outbox", () => ({ deliverEncryptedMail: deliver }));
vi.mock("@/lib/payments/mail", () => ({ encryptPaymentMail: () => "encrypted" }));
vi.mock("@/lib/auth/verification", () => ({ accountOrigin: () => "https://example.com" }));
const requestId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  access.mockResolvedValue({ actor: "actor", company: { id: "company" } });
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status: "ACTIVE" });
  db.$transaction.mockImplementation(fn => fn(db));
  db.ticket.findFirst.mockResolvedValue({ id: "ticket", checkedInAt: new Date(1), booking: { id: "booking", customerEmail: " USER@example.com ", event: { name: "Yoga", endsAt: new Date(1), status: "COMPLETED" } } });
  db.eventReview.findUnique.mockResolvedValue({ id: "review", status: "PROVISIONAL", overallRating: 4 });
  db.eventReview.create.mockResolvedValue({ id: "review" });
  db.eventReviewResendToken.findUnique.mockResolvedValue(null);
  db.mailOutbox.findUnique.mockResolvedValue({ id: "mail", sentAt: new Date(2), lockedUntil: null });
  db.mailOutbox.upsert.mockResolvedValue({ id: "mail" }); deliver.mockResolvedValue(true);
});
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("%s can resend a previously sent invitation without erasing feedback", async role => {
  db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
  expect(await resendReviewInvitation("yoga", "event", "ticket", requestId)).toEqual({ queued: true, message: "Bewertungsaufforderung versendet." });
  expect(db.eventReview.update).toHaveBeenCalledWith({ where: { id: "review" }, data: { expiresAt: expect.any(Date) } });
  expect(db.mailOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { reviewId: "review" }, update: expect.objectContaining({ sentAt: null, encryptedMessage: "encrypted" }) }));
  expect(db.eventReviewResendToken.create).toHaveBeenCalledWith({ data: { reviewId: "review", requestId, tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  expect(deliver).toHaveBeenCalledWith("mail", "review");
});
it("creates an invitation when cron has never invited the participant", async () => {
  db.eventReview.findUnique.mockResolvedValue(null);
  await resendReviewInvitation("yoga", "event", "ticket", requestId);
  expect(db.eventReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventId: "event", ticketId: "ticket", bookingId: "booking", recipientEmail: "user@example.com" }) });
});
it.each([null, { role: "COMPANY_ADMIN", status: "SUSPENDED" }])("denies staff-only and suspended members at the server", async membership => {
  db.companyMembership.findUnique.mockResolvedValue(membership);
  await expect(resendReviewInvitation("yoga", "event", "ticket", requestId)).rejects.toThrow();
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("scopes the selected ticket to the authorized company and event", async () => {
  db.ticket.findFirst.mockResolvedValue(null);
  await resendReviewInvitation("yoga", "event", "foreign", requestId);
  expect(db.ticket.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign", booking: { eventId: "event", event: { companyId: "company" } } } }));
  expect(db.mailOutbox.upsert).not.toHaveBeenCalled();
});
it("does not reopen completed feedback or duplicate a retried request", async () => {
  db.eventReview.findUnique.mockResolvedValueOnce({ id: "review", status: "COMPLETED" });
  expect((await resendReviewInvitation("yoga", "event", "ticket", requestId)).queued).toBeFalsy();
  db.eventReviewResendToken.findUnique.mockResolvedValue({ reviewId: "review" });
  expect((await resendReviewInvitation("yoga", "event", "ticket", requestId)).queued).toBe(true);
  expect(db.mailOutbox.upsert).not.toHaveBeenCalled();
});
it("does not overwrite a mail with a live worker lease", async () => {
  db.mailOutbox.findUnique.mockResolvedValue({ lockedUntil: new Date(Date.now() + 60000) });
  expect((await resendReviewInvitation("yoga", "event", "ticket", requestId)).message).toContain("gerade versendet");
  expect(db.mailOutbox.upsert).not.toHaveBeenCalled();
});
it("blocks unredeemed tickets and events that have not ended", async () => {
  db.ticket.findFirst.mockResolvedValueOnce({ checkedInAt: null });
  expect((await resendReviewInvitation("yoga", "event", "ticket", requestId)).queued).toBeFalsy();
  db.ticket.findFirst.mockResolvedValueOnce({ checkedInAt: new Date(), booking: { event: { status: "PUBLISHED", endsAt: new Date(Date.now() + 60000) } } });
  expect((await resendReviewInvitation("yoga", "event", "ticket", requestId)).queued).toBeFalsy();
  expect(db.mailOutbox.upsert).not.toHaveBeenCalled();
});
it("retains the queued job when immediate SMTP delivery fails", async () => {
  deliver.mockRejectedValue(new Error("SMTP"));
  expect((await resendReviewInvitation("yoga", "event", "ticket", requestId)).message).toContain("automatisch");
});
