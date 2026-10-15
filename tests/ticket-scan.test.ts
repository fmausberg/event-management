import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { inspectTicket, redeemTicket } from "@/app/account/scan/actions";
const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: { user: { findUnique: vi.fn(), findMany: vi.fn() }, ticket: { findUnique: vi.fn(), updateMany: vi.fn() }, authRateLimit: { deleteMany: vi.fn(), upsert: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
const token = "a".repeat(43);
const event = { name: "Yoga", beginsAt: new Date("2026-10-16T15:30Z"), status: "PUBLISHED", trainers: [], staff: [{ id: "staff" }], venue: { name: "Studio", city: "Neuss", staff: [] } };
const ticket = { id: "ticket", number: 7, status: "VALID", checkedInAt: null, booking: { status: "CONFIRMED", event } };
beforeEach(() => {
 vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "staff-user" } });
 db.user.findUnique.mockResolvedValue({ id: "staff-user", email: "ada@example.com" });
 db.user.findMany.mockResolvedValue([{ id: "staff-user" }]);
 db.authRateLimit.upsert.mockResolvedValue({ attempts: 1 });
 db.ticket.findUnique.mockResolvedValue(ticket); db.ticket.updateMany.mockResolvedValue({ count: 1 });
 db.$transaction.mockImplementation(async (callback) => callback(db));
});
it("requires authentication and well-formed tokens before any database access", async () => {
 auth.mockResolvedValue(null); expect((await inspectTicket(token)).ticket).toBeUndefined();
 auth.mockResolvedValue({ user: { id: "staff-user" } }); await redeemTicket("bad");
 expect(db.$transaction).not.toHaveBeenCalled(); expect(db.ticket.updateMany).not.toHaveBeenCalled();
});
it("inspects by hash and never checks in automatically", async () => {
 const result = await inspectTicket(token);
 expect(result.ticket).toMatchObject({ number: 7, canRedeem: true, status: "Gültig" });
 expect(db.ticket.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { publicTokenHash: createHash("sha256").update(token).digest("hex") } }));
 expect(db.ticket.updateMany).not.toHaveBeenCalled();
 expect(JSON.stringify(result)).not.toContain(token);
 expect(db.ticket.findUnique.mock.calls[0][0].select.booking.select.event.select.staff.where).toEqual({ userId: "staff-user" });
});
it.each(["event", "venue"])("allows %s staff to redeem and scopes the atomic write", async (type) => {
 if (type === "venue") db.ticket.findUnique.mockResolvedValue({ ...ticket, booking: { ...ticket.booking, event: { ...event, staff: [], venue: { ...event.venue, staff: [{ id: "venue-staff" }] } } } });
 const result = await redeemTicket(token);
 expect(result.ticket).toMatchObject({ status: "Bereits eingelöst", canRedeem: false, checkedInAt: expect.any(String) });
 expect(db.ticket.updateMany).toHaveBeenCalledWith({ where: { id: "ticket", status: "VALID", checkedInAt: null, booking: { status: "CONFIRMED", event: { status: { not: "CANCELLED" }, OR: [{ staff: { some: { userId: "staff-user" } } }, { venue: { staff: { some: { userId: "staff-user" } } } }, { trainers: { some: { trainer: { OR: [{ userId: "staff-user" }] } } } }] } } }, data: { checkedInAt: expect.any(Date), checkedInById: "staff-user" } });
 expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
});
it("returns ticket data but denies unauthorized redemption even via direct action calls", async () => {
 db.ticket.findUnique.mockResolvedValue({ ...ticket, booking: { ...ticket.booking, event: { ...event, staff: [], venue: null } } });
 const result = await redeemTicket(token);
 expect(result.ticket).toMatchObject({ number: 7, canRedeem: false });
 expect(result.message).toContain("nicht einlösen"); expect(db.ticket.updateMany).not.toHaveBeenCalled();
});
it("allows an assigned trainer to inspect and redeem while checking the trainer again on write", async () => {
 db.ticket.findUnique.mockResolvedValue({ ...ticket, booking: { ...ticket.booking, event: { ...event, trainers: [{ id: "assignment" }], staff: [], venue: null } } });
 expect((await inspectTicket(token)).ticket?.canRedeem).toBe(true);
 expect((await redeemTicket(token)).ticket?.status).toBe("Bereits eingelöst");
 const trainerFilter = { OR: [{ userId: "staff-user" }] };
 expect(db.ticket.findUnique.mock.calls[0][0].select.booking.select.event.select.trainers.where).toEqual({ trainer: trainerFilter });
 expect(db.ticket.updateMany.mock.calls[0][0].where.booking.event.OR).toContainEqual({ trainers: { some: { trainer: trainerFilter } } });
});
it("does not allow email matching for ambiguous trainer accounts", async () => {
 db.user.findMany.mockResolvedValue([{ id: "staff-user" }, { id: "other" }]);
 await inspectTicket(token);
 expect(db.ticket.findUnique.mock.calls[0][0].select.booking.select.event.select.trainers.where).toEqual({ trainer: { OR: [{ userId: "staff-user" }] } });
});
it.each([
 { ...ticket, status: "CANCELLED" },
 { ...ticket, checkedInAt: new Date() },
 { ...ticket, booking: { ...ticket.booking, status: "CANCELLED" } },
 { ...ticket, booking: { ...ticket.booking, event: { ...event, status: "CANCELLED" } } },
])("does not redeem cancelled or already used tickets", async (value) => {
 db.ticket.findUnique.mockResolvedValue(value);
 expect((await redeemTicket(token)).ticket?.canRedeem).toBe(false);
 expect(db.ticket.updateMany).not.toHaveBeenCalled();
});
it("cannot redeem a ticket twice", async () => {
 db.ticket.updateMany.mockImplementation(async () => { db.ticket.findUnique.mockResolvedValue({ ...ticket, checkedInAt: new Date() }); return { count: 1 }; });
 await redeemTicket(token); await redeemTicket(token);
 expect(db.ticket.updateMany).toHaveBeenCalledTimes(1);
});
it("reports concurrent changes rather than reporting a successful redemption", async () => {
 db.ticket.updateMany.mockResolvedValue({ count: 0 });
 expect((await redeemTicket(token)).ticket).toBeUndefined();
 db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }));
 expect((await redeemTicket(token)).message).toContain("gleichzeitig");
});
it("handles missing tickets and rate limits", async () => {
 db.ticket.findUnique.mockResolvedValue(null); expect((await inspectTicket(token)).message).toBe("Ticket nicht verfügbar.");
 db.authRateLimit.upsert.mockResolvedValue({ attempts: 121 });
 expect((await redeemTicket(token)).message).toContain("Zu viele");
 expect(db.ticket.updateMany).not.toHaveBeenCalled();
});
