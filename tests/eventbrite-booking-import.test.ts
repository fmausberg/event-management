import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importEventbriteBookings, normalizeEventbriteBookings } from "@/lib/eventbrite/booking-import";
import { requireBookingEvent } from "@/lib/bookings/management";

const { db, fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), db: {
  $transaction: vi.fn(), platformEvent: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  eventbriteConnection: { findUnique: vi.fn() }, booking: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  mailOutbox: { create: vi.fn() }, ticket: { createMany: vi.fn() }, payment: { create: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/bookings/management", () => ({ requireBookingEvent: vi.fn() }));
vi.mock("@/lib/eventbrite/connection", async original => ({ ...await original<typeof import("@/lib/eventbrite/connection")>(), decrypt: () => "private-token" }));
vi.mock("@/lib/companies/notifications", () => ({ queueBookingNotification: vi.fn() }));
import { queueBookingNotification } from "@/lib/companies/notifications";

const order = (id = "500") => ({ id, event_id: "200", status: "placed", created: "2026-11-20T12:00:00Z", name: "Ada Lovelace", email: "ada@example.com" });
const attendee = (id = "600", orderId = "500", cancelled = false) => ({ id, event_id: "200", order_id: orderId, cancelled, refunded: false, status: cancelled ? "Not Attending" : "Attending" });
const page = (key: string, rows: unknown[], continuation: string | null = null) => Response.json({ [key]: rows, pagination: { has_more_items: !!continuation, continuation } });
type StoredBooking = {
  id: string; eventId: string; externalBookingId: string; platform: string; quantity: number; status: string;
  customerName: string | null; customerEmail: string | null; bookedAt: Date; price?: unknown; tickets: unknown[];
};
let stored: StoredBooking[];
let mapping: { id: string; eventId: string; platform: string; externalEventId: string; bookingImportToken: string | null; bookingImportStartedAt: Date | null; lastBookingImportAt: Date | null; lastBookingImportError: string | null };
let remoteOrders: unknown[];
let remoteAttendees: unknown[];

beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock);
  stored = []; remoteOrders = [order()]; remoteAttendees = [attendee()];
  mapping = { id: "mapping", eventId: "event-1", platform: "EVENTBRITE", externalEventId: "200", bookingImportToken: null, bookingImportStartedAt: null, lastBookingImportAt: null, lastBookingImportError: null };
  vi.mocked(requireBookingEvent).mockResolvedValue({ company: { id: "company", slug: "studio", name: "Studio" }, event: { id: "event-1" } } as Awaited<ReturnType<typeof requireBookingEvent>>);
  db.platformEvent.findMany.mockImplementation(async () => [{ ...mapping }]);
  db.platformEvent.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.bookingImportToken && mapping.bookingImportToken !== where.bookingImportToken) return { count: 0 };
    if (where.OR && mapping.bookingImportToken && mapping.bookingImportStartedAt && mapping.bookingImportStartedAt.getTime() > Date.now() - 300_000) return { count: 0 };
    Object.assign(mapping, data); return { count: 1 };
  });
  db.platformEvent.update.mockImplementation(async ({ data }) => { Object.assign(mapping, data); return { ...mapping }; });
  db.eventbriteConnection.findUnique.mockResolvedValue({ organizationId: "10", status: "CONNECTED", encryptedAccessToken: "encrypted", updatedAt: new Date(0) });
  db.booking.findMany.mockImplementation(async () => structuredClone(stored.filter(row => row.eventId === "event-1")));
  db.booking.findUnique.mockImplementation(async ({ where }) => stored.find(row => row.externalBookingId === where.platform_externalBookingId.externalBookingId && row.platform === where.platform_externalBookingId.platform) ?? null);
  db.booking.upsert.mockImplementation(async ({ where, create, update }) => {
    let row = stored.find(row => row.externalBookingId === where.platform_externalBookingId.externalBookingId && row.platform === where.platform_externalBookingId.platform);
    if (row) Object.assign(row, update);
    else { row = { id: `booking-${stored.length + 1}`, tickets: [], ...create }; stored.push(row!); }
    return row;
  });
  db.$transaction.mockImplementation(async work => {
    const before = structuredClone(stored); const priorMapping = structuredClone(mapping);
    try { return await work(db); } catch (error) { stored = before; mapping = priorMapping; throw error; }
  });
  fetchMock.mockImplementation(async (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/v3/events/200/") return Response.json({ id: "200", organization_id: "10" });
    if (parsed.pathname.endsWith("/orders/")) {
      expect(parsed.searchParams.get("status")).toBe("both");
      return page("orders", remoteOrders);
    }
    if (parsed.pathname.endsWith("/attendees/")) return page("attendees", remoteAttendees);
    throw new Error("Unexpected URL");
  });
});
afterEach(() => vi.unstubAllGlobals());

it("imports on demand and repeats without duplicate bookings or customer emails", async () => {
  const first = await importEventbriteBookings("studio", "event-1");
  expect(first).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
  const repeated = await importEventbriteBookings("studio", "event-1");
  expect(repeated).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ externalBookingId: "500", customerName: "Ada Lovelace", customerEmail: "ada@example.com", quantity: 1, status: "CONFIRMED" });
  expect(mapping.lastBookingImportAt).toBeInstanceOf(Date);
  expect(mapping.bookingImportToken).toBeNull();
  expect(queueBookingNotification).not.toHaveBeenCalled();
  expect(db.mailOutbox.create).not.toHaveBeenCalled();
  expect(db.ticket.createMany).not.toHaveBeenCalled();
  expect(db.payment.create).not.toHaveBeenCalled();
});

it("imports partial cancellation and later full cancellation without duplicate orders", async () => {
  remoteAttendees = [attendee("600"), attendee("601"), attendee("602")];
  await importEventbriteBookings("studio", "event-1");
  remoteAttendees = [attendee("600"), attendee("601", "500", true), attendee("602")];
  expect(await importEventbriteBookings("studio", "event-1")).toMatchObject({ updated: 1 });
  expect(stored[0]).toMatchObject({ quantity: 2, status: "CONFIRMED" });
  remoteAttendees = [attendee("600", "500", true), attendee("601", "500", true), attendee("602", "500", true)];
  await importEventbriteBookings("studio", "event-1");
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ quantity: 3, status: "CANCELLED" });
});

it("does not infer cancellation from an order missing in a later snapshot", async () => {
  await importEventbriteBookings("studio", "event-1");
  remoteOrders = []; remoteAttendees = [];
  await importEventbriteBookings("studio", "event-1");
  expect(stored[0].status).toBe("CONFIRMED");
});

it("successfully imports an event with no orders or attendees", async () => {
  remoteOrders = []; remoteAttendees = [];
  expect(await importEventbriteBookings("studio", "event-1")).toMatchObject({ created: 0, updated: 0, unchanged: 0, skipped: 0 });
  expect(mapping.lastBookingImportAt).toBeInstanceOf(Date);
  expect(mapping.lastBookingImportError).toBeNull();
  expect(stored).toHaveLength(0);
});

it.each([
  ["/v3/events/200/", 404, "Event"],
  ["/v3/events/200/orders/", 400, "Bestellungen"],
  ["/v3/events/200/attendees/", 503, "Teilnehmer"],
] as const)("identifies the failing %s request with HTTP %s without exposing provider data", async (path, status, label) => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string) => new URL(url).pathname === path
    ? Response.json({ error_description: "private-token buyer@example.com" }, { status }) : original(url));
  await expect(importEventbriteBookings("studio", "event-1")).rejects.toThrow(`Anfrage: ${label}, HTTP ${status}`);
  expect(mapping.lastBookingImportError).not.toContain("private-token");
  expect(mapping.lastBookingImportError).not.toContain("buyer@example.com");
  expect(stored).toHaveLength(0);
});

it("preserves all previous bookings and success timestamp if any page fails", async () => {
  await importEventbriteBookings("studio", "event-1");
  const before = structuredClone(stored); const lastImport = mapping.lastBookingImportAt;
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith("/200/")) return Response.json({ id: "200", organization_id: "10" });
    if (String(url).includes("attendees/")) return page("attendees", [attendee("600", "500", true)]);
    if (String(url).includes("continuation=")) return new Response(null, { status: 503 });
    return page("orders", [order()], "next");
  });
  await expect(importEventbriteBookings("studio", "event-1")).rejects.toThrow();
  expect(stored).toEqual(before);
  expect(mapping.lastBookingImportAt).toEqual(lastImport);
  expect(mapping.lastBookingImportError).toBeTruthy();
  expect(mapping.bookingImportToken).toBeNull();
});

it("rolls back the whole snapshot when a booking has local financial history", async () => {
  await importEventbriteBookings("studio", "event-1");
  stored[0].price = { payableAmountMinor: 1000 };
  const before = structuredClone(stored); const lastImport = mapping.lastBookingImportAt;
  remoteOrders = [order("501"), { ...order(), name: "Changed" }];
  remoteAttendees = [attendee("601", "501"), attendee()];
  await expect(importEventbriteBookings("studio", "event-1")).rejects.toThrow();
  expect(stored).toEqual(before);
  expect(mapping.lastBookingImportAt).toEqual(lastImport);
});

it("refuses another company or revoked permissions before writing bookings", async () => {
  vi.mocked(requireBookingEvent).mockRejectedValueOnce(new Error("Forbidden"));
  await expect(importEventbriteBookings("foreign", "event-1")).rejects.toThrow();
  expect(db.platformEvent.findMany).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rechecks access after fetching and before committing a snapshot", async () => {
  // The first access succeeds, the post-fetch access fails.
  vi.mocked(requireBookingEvent).mockReset().mockResolvedValueOnce({ company: { id: "company" }, event: { id: "event-1" } } as Awaited<ReturnType<typeof requireBookingEvent>>).mockRejectedValueOnce(new Error("Revoked"));
  await expect(importEventbriteBookings("studio", "event-1")).rejects.toThrow();
  expect(stored).toHaveLength(0);
  expect(db.$transaction).not.toHaveBeenCalled();
});

it("rejects an organization mismatch without reading private orders", async () => {
  fetchMock.mockResolvedValue(Response.json({ id: "200", organization_id: "999" }));
  await expect(importEventbriteBookings("studio", "event-1")).rejects.toThrow("Organisation");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(stored).toHaveLength(0);
});

it("prevents overlapping imports without releasing the other import's claim", async () => {
  mapping.bookingImportToken = "other"; mapping.bookingImportStartedAt = new Date();
  await expect(importEventbriteBookings("studio", "event-1")).rejects.toThrow("bereits");
  expect(mapping.bookingImportToken).toBe("other");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("recovers an abandoned lease on the next explicit button click", async () => {
  mapping.bookingImportToken = "old"; mapping.bookingImportStartedAt = new Date(Date.now() - 360_000);
  await importEventbriteBookings("studio", "event-1");
  expect(stored).toHaveLength(1);
  expect(mapping.bookingImportToken).toBeNull();
});

it("rejects repeated pagination tokens instead of saving a partial list", async () => {
  fetchMock.mockImplementation(async (url: string) => String(url).endsWith("/200/")
    ? Response.json({ id: "200", organization_id: "10" })
    : String(url).includes("attendees/") ? page("attendees", remoteAttendees) : page("orders", remoteOrders, "loop"));
  await expect(importEventbriteBookings("studio", "event-1")).rejects.toThrow();
  expect(stored).toHaveLength(0);
});

it("rejects duplicate attendee IDs and wrong event IDs before counting seats", () => {
  expect(() => normalizeEventbriteBookings("200", [order()], [attendee(), attendee()])).toThrow();
  expect(() => normalizeEventbriteBookings("200", [order()], [{ ...attendee(), event_id: "999" }])).toThrow();
});

it("cancels an explicitly deleted order without inventing missing ticket quantities", async () => {
  await importEventbriteBookings("studio", "event-1");
  remoteOrders = [{ ...order(), status: "deleted" }]; remoteAttendees = [];
  await importEventbriteBookings("studio", "event-1");
  expect(stored[0]).toMatchObject({ quantity: 1, status: "CANCELLED" });
});

it("skips a previously unknown deleted order when its quantity cannot be reconstructed", async () => {
  remoteOrders = [{ ...order(), status: "deleted" }]; remoteAttendees = [];
  expect(await importEventbriteBookings("studio", "event-1")).toMatchObject({ skipped: 1, created: 0 });
  expect(stored).toHaveLength(0);
});

it("skips incomplete checkouts and rejects unknown or unpaid attendee states", () => {
  expect(normalizeEventbriteBookings("200", [{ ...order(), status: "pending" }], []).skipped).toBe(1);
  expect(() => normalizeEventbriteBookings("200", [order()], [{ ...attendee(), status: "Unpaid" }])).toThrow();
  expect(() => normalizeEventbriteBookings("200", [order()], [{ ...attendee(), status: "Unexpected" }])).toThrow();
});
