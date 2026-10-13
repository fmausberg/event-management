import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { calculateEventCapacity } from "./calculate-event-capacity";
export async function getPublicEvents() {
 const events = await getPrisma().event.findMany({
  where: { status: "PUBLISHED" }, orderBy: [{ beginsAt: "asc" }, { id: "asc" }],
  select: { id: true, name: true, shortdescription: true, beginsAt: true, ticketPrice: true, currency: true, maxSeats: true,
   company: { select: { name: true, slug: true } }, venue: { select: { name: true, city: true } }, eventSeries: { select: { imageUrl: true } },
  },
 });
 if (!events.length) return [];
 const totals = await getPrisma().booking.groupBy({
  by: ["eventId"],
  where: { eventId: { in: events.map((event) => event.id) }, status: "CONFIRMED" },
  _sum: { quantity: true },
 });
 const seatsByEvent = new Map(totals.map((total) => [total.eventId, total._sum.quantity ?? 0]));
 return events.map((event) => ({ ...event, remainingSeats: calculateEventCapacity(event.maxSeats, seatsByEvent.get(event.id) ?? 0).remainingSeats, beginsAt: event.beginsAt.toISOString(), ticketPrice: event.ticketPrice.toFixed(2) }));
}
