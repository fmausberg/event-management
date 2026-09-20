import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Booking, BookingStatus } from "@prisma/client";
import { getEventCapacity } from "@/lib/events/get-event-capacity";
import { getEventsWithCapacity } from "@/lib/events/get-events-with-capacity";
import { upsertExternalBooking, type UpsertExternalBookingInput } from "@/lib/bookings/upsert-external-booking";
import { syncEventCapacity } from "@/lib/sync/sync-event-capacity";
import * as registry from "@/lib/integrations/registry";
import { POST } from "@/app/api/webhooks/eventbrite/route";

// Database doubles: these tests never connect to PostgreSQL or an external API.
const { db, state } = vi.hoisted(() => ({
  state: { bookings: [] as Booking[] },
  db: {
    $transaction: vi.fn(),
    event: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
    booking: { aggregate: vi.fn(), groupBy: vi.fn(), upsert: vi.fn() },
    platformEvent: { findMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));

const input: UpsertExternalBookingInput = {
  eventId: "event-1",
  platform: "EVENTBRITE",
  externalBookingId: "booking-1",
  quantity: 1,
  status: "CONFIRMED",
  bookedAt: new Date("2026-09-20T12:00:00Z"),
};

beforeEach(() => {
  state.bookings = [];
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => {
    const snapshot = structuredClone(state.bookings);
    try { return await callback(db); }
    catch (error) { state.bookings = snapshot; throw error; }
  });
  db.event.findUniqueOrThrow.mockResolvedValue({ maxSeats: 30 });
  db.event.findMany.mockResolvedValue([]);
  db.booking.aggregate.mockImplementation(async ({ where }: { where: { eventId: string; status: BookingStatus } }) => ({
    _sum: {
      quantity: state.bookings.filter((booking) => booking.eventId === where.eventId && booking.status === where.status)
        .reduce((sum, booking) => sum + booking.quantity, 0) || null,
    },
  }));
  db.booking.upsert.mockImplementation(async (args: {
    where: { platform_externalBookingId: Pick<UpsertExternalBookingInput, "platform" | "externalBookingId"> };
    create: UpsertExternalBookingInput;
    update: Pick<UpsertExternalBookingInput, "quantity" | "status" | "bookedAt">;
  }) => {
    const key = args.where.platform_externalBookingId;
    const existing = state.bookings.find((booking) => booking.platform === key.platform && booking.externalBookingId === key.externalBookingId);
    if (existing) { Object.assign(existing, args.update); return existing; }
    const booking = { ...args.create, id: String(state.bookings.length + 1), createdAt: new Date(), updatedAt: new Date() };
    state.bookings.push(booking);
    return booking;
  });
  db.platformEvent.findMany.mockResolvedValue([]);
  db.platformEvent.update.mockResolvedValue({});
});

describe("central capacity and booking imports", () => {
  it("starts with full capacity and changes 30 to 29 after one booking", async () => {
    expect(await getEventCapacity(input.eventId)).toEqual({ maxSeats: 30, confirmedSeats: 0, remainingSeats: 30 });
    await upsertExternalBooking(input);
    expect(await getEventCapacity(input.eventId)).toEqual({ maxSeats: 30, confirmedSeats: 1, remainingSeats: 29 });
  });

  it("repeated imports update one booking, including cancellation and reinstatement", async () => {
    const first = await upsertExternalBooking(input);
    const repeated = await upsertExternalBooking(input);
    expect(repeated.id).toBe(first.id);
    expect(state.bookings).toHaveLength(1);
    await upsertExternalBooking({ ...input, quantity: 3 });
    expect((await getEventCapacity(input.eventId)).remainingSeats).toBe(27);
    await upsertExternalBooking({ ...input, quantity: 3, status: "CANCELLED" });
    expect((await getEventCapacity(input.eventId)).remainingSeats).toBe(30);
    await upsertExternalBooking({ ...input, quantity: 2 });
    expect((await getEventCapacity(input.eventId)).remainingSeats).toBe(28);
    expect(state.bookings).toHaveLength(1);
  });

  it("isolates events and platforms while allowing the same ID on another platform", async () => {
    await upsertExternalBooking(input);
    await upsertExternalBooking({ ...input, platform: "RAUSGEGANGEN", quantity: 2 });
    await upsertExternalBooking({ ...input, eventId: "event-2", externalBookingId: "other", quantity: 10 });
    expect((await getEventCapacity(input.eventId)).confirmedSeats).toBe(3);
    expect(state.bookings).toHaveLength(3);
  });

  it("does not reassign or modify a booking belonging to another event", async () => {
    await upsertExternalBooking(input);
    await expect(upsertExternalBooking({ ...input, eventId: "event-2", quantity: 10 }))
      .rejects.toThrow("another event");
    expect(state.bookings[0]).toMatchObject({ eventId: "event-1", quantity: 1 });
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])("rejects invalid quantity %s before database access", async (quantity) => {
    await expect(upsertExternalBooking({ ...input, quantity })).rejects.toThrow("positive PostgreSQL integer");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid dates and empty IDs", async () => {
    await expect(upsertExternalBooking({ ...input, bookedAt: new Date("invalid") })).rejects.toThrow("valid Date");
    await expect(upsertExternalBooking({ ...input, externalBookingId: " " })).rejects.toThrow("must not be empty");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("preserves overbooking totals but clamps availability to zero", async () => {
    await upsertExternalBooking({ ...input, quantity: 31 });
    expect(await getEventCapacity(input.eventId)).toEqual({ maxSeats: 30, confirmedSeats: 31, remainingSeats: 0 });
  });

  it("does not pretend a missing event has zero capacity", async () => {
    db.event.findUniqueOrThrow.mockRejectedValueOnce(new Error("Event not found"));
    await expect(getEventCapacity("missing")).rejects.toThrow("Event not found");
    expect(db.booking.aggregate).not.toHaveBeenCalled();
  });

  it("returns an empty event list without a bookings query", async () => {
    expect(await getEventsWithCapacity()).toEqual([]);
    expect(db.booking.groupBy).not.toHaveBeenCalled();
  });

  it("merges grouped confirmed totals and includes events without bookings", async () => {
    db.event.findMany.mockResolvedValueOnce([{ id: "a", maxSeats: 30 }, { id: "b", maxSeats: 10 }]);
    db.booking.groupBy.mockResolvedValueOnce([{ eventId: "a", _sum: { quantity: 3 } }]);
    expect(await getEventsWithCapacity()).toEqual([
      { id: "a", maxSeats: 30, confirmedSeats: 3, remainingSeats: 27 },
      { id: "b", maxSeats: 10, confirmedSeats: 0, remainingSeats: 10 },
    ]);
    expect(db.booking.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { eventId: { in: ["a", "b"] }, status: "CONFIRMED" },
    }));
  });
});

describe("platform synchronization", () => {
  const mappings = [
    { id: "mapping-1", platform: "EVENTBRITE", externalEventId: "external-1" },
    { id: "mapping-2", platform: "RAUSGEGANGEN", externalEventId: "external-2" },
  ];

  it("continues after one provider fails, stores success and excludes inactive mappings", async () => {
    await upsertExternalBooking(input);
    db.platformEvent.findMany.mockResolvedValueOnce(mappings);
    const updateAvailability = vi.fn().mockRejectedValueOnce(new Error("secret-token-in-provider-error")).mockResolvedValueOnce(undefined);
    vi.spyOn(registry, "getPlatformAdapter").mockImplementation((platform) => ({ platform, updateAvailability, getBookings: vi.fn() }));
    const result = await syncEventCapacity(input.eventId);
    expect(result.results.map((item) => item.success)).toEqual([false, true]);
    expect(updateAvailability).toHaveBeenNthCalledWith(1, "external-1", 29);
    expect(updateAvailability).toHaveBeenNthCalledWith(2, "external-2", 29);
    expect(db.platformEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: input.eventId, syncStatus: "ACTIVE" } }));
    expect(db.platformEvent.update).toHaveBeenCalledWith({ where: { id: "mapping-2" }, data: { lastSyncedAt: expect.any(Date), lastError: null } });
    expect(db.platformEvent.update).toHaveBeenCalledWith({ where: { id: "mapping-1" }, data: { lastError: "Availability synchronization failed." } });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("continues even when persisting a provider error fails", async () => {
    db.platformEvent.findMany.mockResolvedValueOnce(mappings);
    db.platformEvent.update.mockRejectedValueOnce(new Error("DB unavailable"));
    const result = await syncEventCapacity(input.eventId);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ success: false, errorPersistenceFailed: true });
    expect(result.results[1]).toMatchObject({ success: false, error: "RAUSGEGANGEN: Not implemented" });
  });

  it("records an unregistered platform without stopping the run", async () => {
    db.platformEvent.findMany.mockResolvedValueOnce([{ ...mappings[0], platform: "EVENTIM" }, mappings[1]]);
    const result = await syncEventCapacity(input.eventId);
    expect(result.results[0].error).toBe("EVENTIM: No adapter registered");
    expect(result.results).toHaveLength(2);
  });

  it("does nothing externally when there are no active mappings", async () => {
    const lookup = vi.spyOn(registry, "getPlatformAdapter");
    expect((await syncEventCapacity(input.eventId)).results).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("integration placeholders", () => {
  it.each(["EVENTBRITE", "RAUSGEGANGEN"] as const)("%s rejects both operations without network access", async (platform) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = registry.getPlatformAdapter(platform);
    await expect(adapter.getBookings("external")).rejects.toThrow("Not implemented");
    await expect(adapter.updateAvailability("external", 29)).rejects.toThrow("Not implemented");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 501 from the webhook without database access", async () => {
    const response = POST();
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "Not implemented" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
