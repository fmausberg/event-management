import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { deliverTicketMail, deliverPendingTicketMails, enqueueInitialTicketMail } from "@/lib/tickets/outbox";
import { encryptPaymentMail } from "@/lib/payments/mail";
import type { Prisma } from "@prisma/client";
const { db, sendMail } = vi.hoisted(() => ({ db: { ticketMail: { updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() } }, sendMail: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/mail", () => ({ sendMail }));
let job: { id: string; sentAt: Date | null; lockedUntil: Date | null; lockToken: string | null; encryptedMessage: string | null; attempts: number; availableAt: Date; lastError: string | null };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  vi.stubEnv("AUTH_SECRET", "outbox-key"); vi.spyOn(console, "error").mockImplementation(() => {});
  job = { id: "job", sentAt: null, lockedUntil: null, lockToken: null, attempts: 0, availableAt: new Date(), lastError: null,
    encryptedMessage: encryptPaymentMail({ to: "customer@example.com", subject: "Tickets", text: "https://example.com/tickets#fixed-code" }) };
  db.ticketMail.updateMany.mockImplementation(async ({ where, data }) => {
    if (job.sentAt || (where.lockToken && job.lockToken !== where.lockToken)) return { count: 0 };
    if (where.OR && ((job.lockedUntil && job.lockedUntil >= new Date()) || job.availableAt > new Date())) return { count: 0 };
    const attempts = job.attempts;
    Object.assign(job, data);
    if (data.attempts) job.attempts = attempts + 1;
    return { count: 1 };
  });
  db.ticketMail.findFirst.mockImplementation(async () => ({ ...job }));
  db.ticketMail.findMany.mockResolvedValue([{ id: "job" }]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it("queues initial mail with a stable booking key on the supplied transaction", async () => {
  const create = vi.fn();
  await enqueueInitialTicketMail({ ticketMail: { create } } as unknown as Prisma.TransactionClient, "booking", { to: "customer@example.com", subject: "Tickets", text: "secret" }, "payment");
  expect(create).toHaveBeenCalledWith({ data: { bookingId: "booking", paymentId: "payment", requestKey: "initial:booking", encryptedMessage: expect.any(String) } });
  expect(db.ticketMail.create).not.toHaveBeenCalled();
  expect(create.mock.calls[0][0].data.encryptedMessage).not.toContain("secret");
});
it("never resends migrated sent jobs or takes a still-live old worker lease", async () => {
  job.sentAt = new Date(); job.encryptedMessage = null; await deliverTicketMail("job");
  job.sentAt = null; job.lockedUntil = new Date(Date.now() + 60000); await deliverTicketMail("job");
  expect(sendMail).not.toHaveBeenCalled();
});
it("only one concurrent worker sends and erases the payload after success", async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  sendMail.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; started(); }));
  const first = deliverTicketMail("job"); await ready;
  await deliverTicketMail("job"); expect(sendMail).toHaveBeenCalledTimes(1);
  release(); await first;
  expect(job.sentAt).toEqual(new Date()); expect(job.encryptedMessage).toBeNull(); expect(job.lockToken).toBeNull();
  await deliverTicketMail("job"); expect(sendMail).toHaveBeenCalledTimes(1);
});
it("backs off after failure and retries the exact stored payload", async () => {
  sendMail.mockRejectedValueOnce(new Error("SMTP with sensitive response"));
  await expect(deliverTicketMail("job")).rejects.toThrow("Ticket mail delivery failed");
  expect(job.lastError).toBe("DELIVERY_FAILED"); expect(job.encryptedMessage).not.toBeNull();
  await deliverTicketMail("job"); expect(sendMail).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 30001); await deliverTicketMail("job");
  expect(sendMail.mock.calls[0]).toEqual(sendMail.mock.calls[1]); expect(job.attempts).toBe(2);
  expect(console.error).toHaveBeenCalledWith("[tickets:outbox] Delivery failed", { id: "job" });
});
it("fences stale workers so they cannot overwrite a newer lease", async () => {
  sendMail.mockImplementation(async () => { job.lockToken = "new-worker"; });
  await expect(deliverTicketMail("job")).rejects.toThrow();
  expect(job.lockToken).toBe("new-worker"); expect(job.sentAt).toBeNull(); expect(job.encryptedMessage).not.toBeNull();
});
it("recovers expired leases and makes the cron select due unlocked jobs", async () => {
  job.lockedUntil = new Date(Date.now() - 1); job.lockToken = "crashed-worker";
  expect(await deliverPendingTicketMails()).toEqual({ checked: 1, failures: 0 });
  expect(db.ticketMail.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sentAt: null, availableAt: { lte: expect.any(Date) } }), take: 50 }));
  expect(sendMail).toHaveBeenCalledTimes(1);
});
