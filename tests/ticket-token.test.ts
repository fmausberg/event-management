import { createHash } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createTicketToken } from "@/lib/tickets/public-token";

vi.mock("server-only", () => ({}));
beforeEach(() => {
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }));
});
afterEach(() => vi.unstubAllEnvs());

it("creates a URL-safe token with 32 random bytes and its SHA-256 hash", () => {
 const { token, publicTokenHash } = createTicketToken();
 expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
 expect(Buffer.from(token, "base64url")).toHaveLength(32);
 expect(publicTokenHash).toMatch(/^[a-f0-9]{64}$/);
 expect(publicTokenHash).toBe(createHash("sha256").update(token).digest("hex"));
 expect(publicTokenHash).not.toBe(token);
});

it("generates independent tokens for each ticket", () => {
 const tickets = Array.from({ length: 100 }, () => createTicketToken());
 expect(new Set(tickets.map(({ token }) => token)).size).toBe(100);
 expect(new Set(tickets.map(({ publicTokenHash }) => publicTokenHash)).size).toBe(100);
});
