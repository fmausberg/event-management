import "server-only";
import { getCompanySeries } from "@/lib/event-series/data";
import { getPrisma } from "@/lib/db/prisma";
import { calculateEventCapacity } from "@/lib/events/calculate-event-capacity";
export async function getCompanyEvents(slug: string) {
 const options = await getCompanySeries(slug, false);
 const rows = await getPrisma().event.findMany({ where: { companyId: options.company.id }, orderBy: [{ beginsAt: "desc" }, { id: "asc" }], select: {
 id: true, number: true, name: true, shortdescription: true, description: true, trainerName: true, imageUrl: true, trainers: { select: { trainerId: true } }, eventSeriesId: true, venueId: true, beginsAt: true, endsAt: true, maxSeats: true, ticketPrice: true, currency: true, status: true, _count: { select: { bookings: true, platformEvents: true } },
 } });
 const totals = rows.length ? await getPrisma().booking.groupBy({
  by: ["eventId"],
  where: { eventId: { in: rows.map((row) => row.id) }, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
  _sum: { quantity: true },
 }) : [];
 const reserved = new Map(totals.map((total) => [total.eventId, total._sum.quantity ?? 0]));
 return { ...options, events: rows.map((r) => ({ ...r, remainingSeats: r.maxSeats === null ? null : calculateEventCapacity(r.maxSeats, reserved.get(r.id) ?? 0).remainingSeats, shortdescription: r.shortdescription ?? "", description: r.description ?? "", trainerName: r.trainerName ?? "", trainerIds: r.trainers.map((t) => t.trainerId), eventSeriesId: r.eventSeriesId ?? "", venueId: r.venueId ?? "", ticketPrice: r.ticketPrice?.toFixed(2) ?? "", beginsAt: r.beginsAt?.toISOString() ?? "", endsAt: r.endsAt?.toISOString() ?? "" })) };
}
