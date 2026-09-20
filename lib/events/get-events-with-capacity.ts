import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { calculateEventCapacity } from "./calculate-event-capacity";

export async function getEventsWithCapacity() {
  return getPrisma().$transaction(async (tx) => {
    const events = await tx.event.findMany({
      orderBy: [{ beginsAt: "asc" }, { number: "asc" }],
    });
    if (!events.length) return [];

    // Aggregate in PostgreSQL, without loading every booking or an N+1 query.
    const totals = await tx.booking.groupBy({
      by: ["eventId"],
      where: { eventId: { in: events.map((event) => event.id) }, status: "CONFIRMED" },
      _sum: { quantity: true },
    });
    const seatsByEvent = new Map(totals.map((total) => [total.eventId, total._sum.quantity ?? 0]));
    return events.map((event) => ({
      ...event,
      ...calculateEventCapacity(event.maxSeats, seatsByEvent.get(event.id) ?? 0),
    }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
