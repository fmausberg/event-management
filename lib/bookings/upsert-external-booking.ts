import { BookingStatus, Platform } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";

export interface UpsertExternalBookingInput {
  eventId: string;
  platform: Platform;
  externalBookingId: string;
  quantity: number;
  status: BookingStatus;
  bookedAt: Date;
}

export async function upsertExternalBooking(input: UpsertExternalBookingInput) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 2_147_483_647) {
    throw new Error("quantity must be a positive PostgreSQL integer.");
  }
  if (!input.eventId.trim() || !input.externalBookingId.trim()) {
    throw new Error("eventId and externalBookingId must not be empty.");
  }
  if (!Object.values(Platform).includes(input.platform) || !Object.values(BookingStatus).includes(input.status)) {
    throw new Error("Unsupported platform or booking status.");
  }
  if (!(input.bookedAt instanceof Date) || !Number.isFinite(input.bookedAt.getTime())) {
    throw new Error("bookedAt must be a valid Date.");
  }

  const { eventId, platform, externalBookingId, quantity, status, bookedAt } = input;
  return getPrisma().$transaction(async (tx) => {
    // One unique key drives both insert and update, including cancellation/reinstatement.
    const booking = await tx.booking.upsert({
      where: { platform_externalBookingId: { platform, externalBookingId } },
      create: { eventId, platform, externalBookingId, quantity, status, bookedAt },
      update: { quantity, status, bookedAt },
    });
    if (booking.eventId !== eventId) {
      // Throw inside the transaction so even the update above is rolled back.
      throw new Error("External booking already belongs to another event.");
    }
    return booking;
  });
}
