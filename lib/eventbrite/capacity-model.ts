import type { Prisma } from "@prisma/client";

// SQL NOT(platform = EVENTBRITE) would omit NULL, which represents local bookings.
export const nonEventbriteReservations = (eventId: string) => ({
  eventId, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
  OR: [{ platform: null }, { platform: { not: "EVENTBRITE" } }],
}) satisfies Prisma.BookingWhereInput;

export function eventbriteCapacityTarget(maxSeats: number, reservedOutsideEventbrite: number) {
  if (!Number.isSafeInteger(maxSeats) || maxSeats < 0 || !Number.isSafeInteger(reservedOutsideEventbrite) || reservedOutsideEventbrite < 0) throw new Error("Ungültige Kontingentberechnung.");
  return Math.max(0, maxSeats - reservedOutsideEventbrite);
}
