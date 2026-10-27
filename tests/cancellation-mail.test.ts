import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queueCancellationMail, deliverCancellationMails } from "@/lib/cancellations/mail";
import { decryptPaymentMail, encryptPaymentMail } from "@/lib/payments/mail";
import type { Prisma } from "@prisma/client";

const { db, sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(), db: {
  cancellationRequest: { findUniqueOrThrow: vi.fn() }, companyMembership: { findMany: vi.fn() },
  cancellationMail: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/mail", () => ({ sendMail }));
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-secret");
  db.cancellationRequest.findUniqueOrThrow.mockResolvedValue({ refundAttempt: 0, internalNote: "never expose this", booking: { number: 42, user: { email: "owner@example.com" }, customerEmail: "guest@example.com", event: { name: "Yoga", companyId: "company", company: { name: "Company" } } } });
  db.companyMembership.findMany.mockResolvedValue([{ user: { email: "admin@example.com" } }]);
  db.cancellationMail.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("notifies active company admins and encrypts the outbox", async () => {
  await queueCancellationMail(db as unknown as Prisma.TransactionClient, "request", "requested");
  expect(db.companyMembership.findMany).toHaveBeenCalledWith({ where: { companyId: "company", role: "COMPANY_ADMIN", status: "ACTIVE" }, include: { user: true } });
  const queued = db.cancellationMail.upsert.mock.calls[0][0];
  expect(queued.create.encryptedMessage).not.toContain("admin@example.com");
  expect(decryptPaymentMail(queued.create.encryptedMessage).to).toBe("admin@example.com");
});
it("does not leak internal decision notes to the customer and deduplicates notices", async () => {
  await queueCancellationMail(db as unknown as Prisma.TransactionClient, "request", "rejected");
  await queueCancellationMail(db as unknown as Prisma.TransactionClient, "request", "rejected");
  const first = db.cancellationMail.upsert.mock.calls[0][0];
  expect(first.where.id).toBe(db.cancellationMail.upsert.mock.calls[1][0].where.id);
  const message = decryptPaymentMail(first.create.encryptedMessage);
  expect(message.to).toBe("owner@example.com"); expect(message.text).not.toContain("never expose");
  expect(message.text).toContain("abgelehnt"); expect(first.update).toEqual({});
});
it("retains a failed delivery for retry, then erases its encrypted content after success", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const encryptedMessage = encryptPaymentMail({ to: "owner@example.com", subject: "Erstattung", text: "Gespeichert" });
  db.cancellationMail.findMany.mockResolvedValue([{ id: "mail", encryptedMessage }]);
  sendMail.mockRejectedValueOnce(new Error("SMTP failed")).mockResolvedValueOnce({});
  expect(await deliverCancellationMails()).toBe(1); expect(db.cancellationMail.update).not.toHaveBeenCalled();
  expect(await deliverCancellationMails()).toBe(0);
  expect(db.cancellationMail.update).toHaveBeenCalledWith({ where: { id: "mail" }, data: { sentAt: expect.any(Date), encryptedMessage: null, lockedUntil: null } });
});
it("only the worker holding the lease sends mail", async () => {
  db.cancellationMail.findMany.mockResolvedValue([{ id: "mail" }]);
  db.cancellationMail.updateMany.mockResolvedValue({ count: 0 });
  await deliverCancellationMails(); expect(sendMail).not.toHaveBeenCalled();
});
