import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { POST } from "@/app/api/public-ticket/route";
import { ticketLink } from "@/lib/tickets/public-link";
const { findUnique, upsert, deleteMany } = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ ticket: { findUnique }, authRateLimit: { upsert, deleteMany } }) }));
const token = "a".repeat(43);
const event = { name: "Yoga", beginsAt: new Date("2026-10-16T15:30Z"), status: "PUBLISHED", venue: { name: "Studio", city: "Neuss" } };
const ticket = { number: 7, status: "VALID", checkedInAt: null, booking: { status: "CONFIRMED", event } };
function request(value = token) { return new Request("https://events.example.com/api/public-ticket", { method: "POST", body: value }); }
beforeEach(() => { vi.resetAllMocks(); upsert.mockResolvedValue({ attempts: 1 }); findUnique.mockResolvedValue(ticket); });

it("looks up only the hash and returns minimal uncached ticket details without writes", async () => {
 const response = await POST(request());
 expect(await response.json()).toEqual({ number: 7, status: "Gültig", eventName: "Yoga", beginsAt: event.beginsAt.toISOString(), venue: "Studio, Neuss" });
 expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { publicTokenHash: createHash("sha256").update(token).digest("hex") } }));
 expect(response.headers.get("cache-control")).toContain("no-store");
 expect(response.headers.get("referrer-policy")).toBe("no-referrer");
 expect(response.headers.get("x-robots-tag")).toContain("noindex");
});
it.each(["7", "", "a".repeat(257)])("rejects malformed/oversized tokens without a ticket lookup", async (value) => {
 expect((await POST(request(value))).status).toBe(404);
 expect(findUnique).not.toHaveBeenCalled();
});
it("uses the same generic message for unknown and malformed tokens", async () => {
 findUnique.mockResolvedValue(null);
 expect(await (await POST(request())).json()).toEqual(await (await POST(request("bad"))).json());
});
it("enforces the shared rate limit before looking up tickets", async () => {
 upsert.mockResolvedValue({ attempts: 301 });
 expect((await POST(request())).status).toBe(429);
 expect(findUnique).not.toHaveBeenCalled();
});
it("fails closed when rate limiting is unavailable", async () => {
 upsert.mockRejectedValue(new Error("db"));
 expect((await POST(request())).status).toBe(503);
 expect(findUnique).not.toHaveBeenCalled();
});
it.each([
 [{ ...ticket, status: "CANCELLED" }, "Storniert"],
 [{ ...ticket, booking: { ...ticket.booking, status: "CANCELLED" } }, "Storniert"],
 [{ ...ticket, booking: { ...ticket.booking, event: { ...event, status: "CANCELLED" } } }, "Storniert"],
 [{ ...ticket, checkedInAt: new Date() }, "Bereits eingelöst"],
])("reflects cancellation and check-in status", async (value, status) => {
 findUnique.mockResolvedValue(value);
 expect((await (await POST(request())).json()).status).toBe(status);
});
it("puts tokens only in URL fragments and rejects insecure production links", () => {
 vi.stubEnv("AUTH_URL", "https://events.example.com");
 const url = new URL(ticketLink(token));
 expect(url.pathname).toBe("/tickets"); expect(url.search).toBe(""); expect(url.hash).toBe(`#${token}`);
 vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_URL", "http://localhost:3000");
 expect(() => ticketLink(token)).toThrow("HTTPS");
 vi.unstubAllEnvs();
});
