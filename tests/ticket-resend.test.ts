import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { resendMyTicketEmail, resendCompanyBookingEmail } from "@/lib/tickets/resend";
import { createTicketToken } from "@/lib/tickets/public-token";
import { decryptPaymentMail } from "@/lib/payments/mail";
import { usableTicketWhere, ticketMailUnavailable } from "@/lib/tickets/mail-policy";
const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: { booking: { findFirst: vi.fn() }, companyMembership: { findUnique: vi.fn() }, ticketMail: { findUnique: vi.fn(), create: vi.fn() }, authRateLimit: { upsert: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn() }));
const requestId = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
const company = () => resendCompanyBookingEmail("yoga", "event-1", "booking-1", requestId);
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }));
  vi.stubEnv("AUTH_SECRET", "outbox-test-key"); vi.stubEnv("AUTH_URL", "https://events.example.com");
  auth.mockResolvedValue({ user: { id: "actor" } });
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status: "ACTIVE" });
  db.authRateLimit.upsert.mockResolvedValue({ attempts: 1 });
  db.ticketMail.create.mockResolvedValue({ id: "job-1" });
});
afterEach(() => vi.unstubAllEnvs());
function booking() {
  const record = { id: "booking-1", number: 42, status: "CONFIRMED", customerName: "Ada", customerEmail: "booking@example.com", event: { companyId: "company-1", name: "Yoga", beginsAt: null, status: "PUBLISHED" }, tickets: [createTicketToken(), createTicketToken()] };
  db.booking.findFirst.mockResolvedValue(record);
  return record;
}
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("permits active %s scoped to booking, event and company", async (role) => {
  booking(); db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
  expect((await company()).message).toContain("Versand beauftragt");
  expect(db.booking.findFirst.mock.calls[0][0].where).toEqual({ id: "booking-1", eventId: "event-1", event: { company: { slug: "yoga" } } });
  expect(db.companyMembership.findUnique.mock.calls[0][0].where).toEqual({ companyId_userId: { companyId: "company-1", userId: "actor" } });
  expect(db.ticketMail.create.mock.calls[0][0].data).toMatchObject({ requestedById: "actor", bookingId: "booking-1" });
});
it.each([null, { role: "COMPANY_USER", status: "INVITED" }, { role: "COMPANY_ADMIN", status: "SUSPENDED" }, { role: "USER", status: "ACTIVE" }])("denies missing/inactive/unauthorized membership %j", async (member) => {
  booking(); db.companyMembership.findUnique.mockResolvedValue(member);
  expect((await company()).success).toBeUndefined(); expect(db.ticketMail.create).not.toHaveBeenCalled();
});
it("denies foreign bookings/events/companies and guests before queueing", async () => {
  db.booking.findFirst.mockResolvedValue(null);
  for (const args of [["other", "event-1", "booking-1"], ["yoga", "other", "booking-1"], ["yoga", "event-1", "other"]]) {
    expect((await resendCompanyBookingEmail(args[0], args[1], args[2], requestId)).success).toBeUndefined();
  }
  auth.mockResolvedValue(null); expect((await company()).message).toContain("melde dich");
  expect(db.ticketMail.create).not.toHaveBeenCalled();
});
it("scopes owner access to the current user and rejects foreign tickets", async () => {
  booking(); expect((await resendMyTicketEmail("ticket-1", requestId)).success).toBe(true);
  expect(db.booking.findFirst.mock.calls[0][0].where).toEqual({ userId: "actor", tickets: { some: { id: "ticket-1" } } });
  expect(db.companyMembership.findUnique).not.toHaveBeenCalled();
  db.booking.findFirst.mockResolvedValue(null); expect((await resendMyTicketEmail("foreign", nextId)).success).toBeUndefined();
  expect(db.ticketMail.create).toHaveBeenCalledTimes(1);
});
it.each(["CANCELLED", "EXPIRED", "PENDING_PAYMENT"])("rejects booking status %s", async (status) => {
  const record = booking(); record.status = status;
  expect((await company()).message).toBe(ticketMailUnavailable(record)); expect(db.ticketMail.create).not.toHaveBeenCalled();
});
it.each(["event", "email", "tickets"])("rejects unavailable %s using the same reason as the UI", async (kind) => {
  const record = booking();
  if (kind === "event") record.event.status = "CANCELLED";
  if (kind === "email") record.customerEmail = "";
  if (kind === "tickets") record.tickets = [];
  expect((await company()).message).toBe(ticketMailUnavailable(record)); expect(db.ticketMail.create).not.toHaveBeenCalled();
});
it("selects only valid unused tickets, fixes the recipient and preserves codes across intentional resends", async () => {
  const record = booking(); await company(); await resendCompanyBookingEmail("yoga", "event-1", "booking-1", nextId);
  expect(db.booking.findFirst.mock.calls[0][0].select.tickets.where).toEqual(usableTicketWhere);
  const first = decryptPaymentMail(db.ticketMail.create.mock.calls[0][0].data.encryptedMessage);
  expect(first.to).toBe("booking@example.com");
  expect(decryptPaymentMail(db.ticketMail.create.mock.calls[1][0].data.encryptedMessage)).toEqual(first);
  for (const ticket of record.tickets) expect(first.text).toContain(`/tickets#${ticket.token}`);
  expect(first.text).toContain("Anzahl Plätze: 2");
  expect(db.ticketMail.create.mock.calls[0][0].data.requestKey).not.toBe(db.ticketMail.create.mock.calls[1][0].data.requestKey);
});
it("deduplicates identical requests even for sent/locked jobs without rate consumption or resets", async () => {
  booking(); await company(); db.ticketMail.findUnique.mockResolvedValue({ id: "job-1" });
  expect((await company()).success).toBe(true);
  expect(db.ticketMail.create).toHaveBeenCalledTimes(1); expect(db.authRateLimit.upsert).toHaveBeenCalledTimes(2);
});
it.each(["actor", "booking"])("rate limits per %s before queueing", async (scope) => {
  booking(); db.authRateLimit.upsert.mockImplementation(async ({ where }) => ({ attempts: where.key.includes(`:${scope}:`) ? 6 : 1 }));
  expect((await company()).message).toContain("Zu viele"); expect(db.ticketMail.create).not.toHaveBeenCalled();
});
it("retries transaction conflicts with the same request identity", async () => {
  booking(); db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }));
  expect((await company()).success).toBe(true);
  expect(db.ticketMail.create.mock.calls[0][0].data.requestKey).toBe(`resend:actor:booking-1:${requestId}`);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
});
it("reuses the winning job after a concurrent identical request hits the unique constraint", async () => {
  booking();
  db.ticketMail.create.mockImplementationOnce(async () => {
    db.ticketMail.findUnique.mockResolvedValue({ id: "winning-job" });
    throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
  });
  expect((await company()).success).toBe(true);
  expect(db.ticketMail.create).toHaveBeenCalledTimes(1);
  expect(db.ticketMail.findUnique).toHaveBeenLastCalledWith({ where: { requestKey: `resend:actor:booking-1:${requestId}` }, select: { id: true } });
});
it("does not queue unusable ciphertext or accept missing request identity", async () => {
  const record = booking(); record.tickets[0].encryptedPublicToken = "bad";
  expect((await company()).success).toBeUndefined(); expect(db.ticketMail.create).not.toHaveBeenCalled();
  expect((await resendMyTicketEmail("ticket-1", "bad")).message).toContain("Ungültige");
});
