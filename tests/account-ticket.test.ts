import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTicketToken } from "@/lib/tickets/public-token";
import { getMyTicket } from "@/lib/tickets/account";

const { auth, findFirst } = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ ticket: { findFirst } }) }));
beforeEach(() => {
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }));
 vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only-secret"); });
afterEach(() => vi.unstubAllEnvs());

it("requires login before accessing tickets", async () => {
  auth.mockResolvedValue(null);
  await expect(getMyTicket("ticket-1")).rejects.toMatchObject({ reason: "UNAUTHENTICATED" });
  expect(findFirst).not.toHaveBeenCalled();
});
it("only fetches the signed-in owner's ticket, without exposing stored tokens", async () => {
  auth.mockResolvedValue({ user: { id: "owner" } });
  findFirst.mockResolvedValue(null);
  expect(await getMyTicket("someone-elses-ticket")).toBeNull();
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "someone-elses-ticket", booking: { userId: "owner" } } }));
  expect(findFirst.mock.calls[0][0].where.booking.userId).toBe("owner");
});
it("returns the same stored code on repeated owner views without database writes", async () => {
 const record = createTicketToken();
 auth.mockResolvedValue({ user: { id: "owner" } });
 findFirst.mockResolvedValue({ id: "ticket-1", number: 7, status: "VALID", checkedInAt: null, ...record, booking: { customerEmail: "owner@example.com", tickets: [{ id: "ticket-1" }], number: 42, status: "CONFIRMED", event: { name: "Yoga", beginsAt: null, status: "PUBLISHED", venue: null } } });
 const first = await getMyTicket("ticket-1");
 const second = await getMyTicket("ticket-1");
 expect(first!.code).toBe(record.token);
 expect(second).toEqual(first);
 expect(first).not.toHaveProperty("encryptedPublicToken");
 expect(first).not.toHaveProperty("publicTokenHash");
});
