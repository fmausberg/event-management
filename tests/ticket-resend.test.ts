import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resendMyTicketEmail } from "@/lib/tickets/resend";
import { createTicketToken } from "@/lib/tickets/public-token";
import { decryptPaymentMail, encryptPaymentMail } from "@/lib/payments/mail";
const { auth, findFirst, sendMail, rate } = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn(), sendMail: vi.fn(), rate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ ticket: { findFirst } }) }));
vi.mock("@/lib/mail", () => ({ sendMail }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeAuthAttempt: rate }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }));
  vi.stubEnv("AUTH_SECRET", "outbox-test-key"); vi.stubEnv("AUTH_URL", "https://events.example.com");
  auth.mockResolvedValue({ user: { id: "owner" } }); rate.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());
function booking() {
  const tickets = [createTicketToken(), createTicketToken()];
  const record = { booking: { number: 42, status: "CONFIRMED", customerName: "Ada", customerEmail: "booking@example.com", quantity: 2, event: { name: "Yoga", beginsAt: null, status: "PUBLISHED" }, tickets } };
  findFirst.mockResolvedValue(record);
  return record;
}
it("resends the stored codes repeatedly without writes or new tokens", async () => {
  const record = booking();
  await resendMyTicketEmail("ticket-1"); await resendMyTicketEmail("ticket-1");
  expect(sendMail.mock.calls[0]).toEqual(sendMail.mock.calls[1]);
  expect(sendMail.mock.calls[0][0].to).toBe("booking@example.com");
  for (const ticket of record.booking.tickets) expect(sendMail.mock.calls[0][0].text).toContain(`/tickets#${ticket.token}`);
  expect(findFirst.mock.calls[0][0].where).toEqual({ id: "ticket-1", booking: { userId: "owner" } });
  // The unchanged outbox transport preserves the exact same links on retries.
  expect(decryptPaymentMail(encryptPaymentMail(sendMail.mock.calls[0][0]))).toEqual(sendMail.mock.calls[0][0]);
});
it("denies unauthenticated, foreign and rate-limited requests", async () => {
  auth.mockResolvedValue(null); await resendMyTicketEmail("ticket-1"); expect(findFirst).not.toHaveBeenCalled();
  auth.mockResolvedValue({ user: { id: "owner" } }); findFirst.mockResolvedValue(null);
  expect((await resendMyTicketEmail("foreign")).message).toBe("Tickets nicht verfügbar.");
  rate.mockResolvedValue(false); await resendMyTicketEmail("ticket-1");
  expect(findFirst).toHaveBeenCalledTimes(1); expect(sendMail).not.toHaveBeenCalled();
});
it("refuses corrupted ciphertext and allows retry after SMTP failure using unchanged codes", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const record = booking();
  sendMail.mockRejectedValueOnce(new Error("SMTP"));
  expect((await resendMyTicketEmail("ticket-1")).success).toBeUndefined();
  expect((await resendMyTicketEmail("ticket-1")).success).toBe(true);
  expect(sendMail.mock.calls[0]).toEqual(sendMail.mock.calls[1]);
  record.booking.tickets[0].encryptedPublicToken = "broken";
  expect((await resendMyTicketEmail("ticket-1")).success).toBeUndefined();
  expect(sendMail).toHaveBeenCalledTimes(2);
});
