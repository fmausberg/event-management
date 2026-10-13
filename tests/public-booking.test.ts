import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { bookPublicEvent } from "@/app/(public)/events/[companySlug]/[eventId]/actions";
import Page from "@/app/(public)/events/[companySlug]/[eventId]/page";
import { createBookingToken, readBookingToken } from "@/lib/bookings/public-token";
const { auth, db, rate } = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), db: { event: { findFirst: vi.fn() }, booking: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeAuthAttempt: rate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
const event = { id: "event-1", name: "Yoga", shortdescription: "Yoga session", description: "Bring a mat.", trainerName: "Ada", status: "PUBLISHED", beginsAt: new Date("2099-10-16T08:00:00Z"), endsAt: new Date("2099-10-16T09:00:00Z"), maxSeats: 10, ticketPrice: { toFixed: () => "12.50" }, currency: "EUR", company: { slug: "yoga", name: "Studio" }, venue: null, eventSeries: null };
function form(token = createBookingToken("event-1", "12.50", "EUR"), overrides: Record<string, string> = {}) {
 const data = new FormData(); Object.entries({ token, name: " Ada ", email: " ADA@example.com ", quantity: "2", ...overrides }).forEach(([k, v]) => data.set(k, v)); return data;
}
beforeEach(() => {
 vi.resetAllMocks(); auth.mockResolvedValue(null); vi.stubEnv("AUTH_SECRET", "test-only-booking-secret");
 rate.mockResolvedValue(true); db.event.findFirst.mockResolvedValue(event); db.booking.findUnique.mockResolvedValue(null);
 db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 3 } }); db.booking.create.mockResolvedValue({ number: 42 });
 db.$transaction.mockImplementation(async (callback) => callback(db));
});
afterEach(() => vi.unstubAllEnvs());
it("creates a guest booking with normalized contact details, trusted status and event", async () => {
 const token = createBookingToken("event-1", "12.50", "EUR");
 expect(await bookPublicEvent("yoga", "event-1", {}, form(token, { userId: "foreign", status: "CANCELLED", ticketPrice: "0" }))).toMatchObject({ success: true, number: 42 });
 expect(db.booking.create).toHaveBeenCalledWith({ data: { id: readBookingToken(token)!.id, eventId: "event-1", userId: null, customerName: "Ada", customerEmail: "ada@example.com", quantity: 2, status: "CONFIRMED", platform: null, externalBookingId: null }, select: { number: true } });
 expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
 expect(db.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event-1", company: { slug: "yoga" } } }));
});
it("associates public bookings with the authenticated user", async () => {
 auth.mockResolvedValue({ user: { id: "user-1" } });
 const token = createBookingToken("event-1", "12.50", "EUR");
 await bookPublicEvent("yoga", "event-1", {}, form(token));
 expect(db.booking.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1" }), select: { number: true } });
});
it("reuses an existing booking for repeated submission without inserting again", async () => {
 db.booking.findUnique.mockResolvedValue({ eventId: "event-1", number: 42 });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).number).toBe(42);
 expect(db.booking.create).not.toHaveBeenCalled();
});
it.each(["DRAFT", "CANCELLED", "COMPLETED"])("rejects status %s", async (status) => {
 db.event.findFirst.mockResolvedValue({ ...event, status });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).success).toBeUndefined(); expect(db.booking.create).not.toHaveBeenCalled();
});
it("rejects past or missing events", async () => {
 db.event.findFirst.mockResolvedValue({ ...event, beginsAt: new Date(0) });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).success).toBeUndefined();
 db.event.findFirst.mockResolvedValue(null);
 expect((await bookPublicEvent("other", "event-1", {}, form())).success).toBeUndefined();
});
it("rejects overbooking and changed prices", async () => {
 db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 9 } });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).message).toContain("genügend");
 expect((await bookPublicEvent("yoga", "event-1", {}, form(createBookingToken("event-1", "1.00", "EUR")))).message).toContain("Preis");
 expect(db.booking.create).not.toHaveBeenCalled();
});
it("requires authentic unexpired tokens for the correct event", async () => {
 const token = createBookingToken("event-1", "12.50", "EUR");
 expect(readBookingToken(token + "x")).toBeNull();
 expect((await bookPublicEvent("yoga", "other", {}, form(token))).success).toBeUndefined();
 const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7200000);
 expect(readBookingToken(token)).toBeNull(); now.mockRestore();
 expect(db.$transaction).not.toHaveBeenCalled();
});
it.each([{ name: " " }, { email: "invalid" }, { quantity: "0" }, { quantity: "1.5" }, { quantity: "-2" }])("rejects invalid input %j", async (input) => {
 const data = form(); Object.entries(input).forEach(([key, value]) => data.set(key, value));
 expect((await bookPublicEvent("yoga", "event-1", {}, data)).success).toBeUndefined(); expect(db.$transaction).not.toHaveBeenCalled();
});
it("handles throttling and concurrency conflicts", async () => {
 rate.mockResolvedValue(false);
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).message).toContain("15 Minuten");
 rate.mockResolvedValue(true);
 db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }));
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).message).toContain("gleichzeitig");
});
it("renders event details, booking form and sold-out state without exposing customer data", async () => {
 const props = { params: Promise.resolve({ companySlug: "yoga", eventId: "event-1" }) };
 const html = renderToStaticMarkup(await Page(props));
 expect(html).toContain("Yoga"); expect(html).toContain("Jetzt buchen"); expect(html).toContain("7 Plätze verfügbar"); expect(html).toContain("nicht eingerichtet");
 expect(db.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event-1", status: "PUBLISHED", company: { slug: "yoga" } } }));
 db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });
 expect(renderToStaticMarkup(await Page(props))).toContain("Ausgebucht");
 db.event.findFirst.mockResolvedValue(null);
 await expect(Page(props)).rejects.toThrow("NOT_FOUND");
});
