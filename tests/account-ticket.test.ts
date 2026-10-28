import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAccountTicketToken, readAccountTicketToken } from "@/lib/tickets/account-token";
import { getMyTicket } from "@/lib/tickets/account";

const { auth, findFirst } = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ ticket: { findFirst } }) }));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only-secret"); });
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
  expect(JSON.stringify(findFirst.mock.calls[0])).not.toContain("publicTokenHash");
});
it("signs account QR credentials and expires them at exactly 24 hours", () => {
  const { token, expires } = createAccountTicketToken("ticket-1", 1000);
  expect(readAccountTicketToken(token, expires - 1)).toBe("ticket-1");
  expect(readAccountTicketToken(token, expires)).toBeNull();
});
it("rejects tampering, other purposes, oversize tokens and a rotated secret", () => {
  const { token } = createAccountTicketToken("ticket-1");
  const parts = token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ id: "ticket-2", expires: Date.now() + 10000 })).toString("base64url");
  expect(readAccountTicketToken(parts.join("."))).toBeNull();
  expect(readAccountTicketToken(token.replace("account.", "booking."))).toBeNull();
  expect(readAccountTicketToken("a".repeat(513))).toBeNull();
  expect(readAccountTicketToken(token + ".extra")).toBeNull();
  vi.stubEnv("AUTH_SECRET", "rotated");
  expect(readAccountTicketToken(token)).toBeNull();
});
