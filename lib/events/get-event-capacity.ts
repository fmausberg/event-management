import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { calculateEventCapacity } from "./calculate-event-capacity";

export async function getEventCapacity(eventId: string) {
  return getPrisma().$transaction(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { maxSeats: true },
    });
    const bookings = await tx.booking.aggregate({
      where: { eventId, status: "CONFIRMED" },
      _sum: { quantity: true },
    });
    return calculateEventCapacity(event.maxSeats, bookings._sum.quantity ?? 0);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
