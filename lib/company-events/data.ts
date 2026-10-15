import "server-only";
import { getCompanySeries } from "@/lib/event-series/data";
import { getPrisma } from "@/lib/db/prisma";
export async function getCompanyEvents(slug: string) {
 const options = await getCompanySeries(slug, false);
 const rows = await getPrisma().event.findMany({ where: { companyId: options.company.id }, orderBy: [{ beginsAt: "desc" }, { id: "asc" }], select: {
 id: true, number: true, name: true, shortdescription: true, description: true, trainerName: true, trainers: { select: { trainerId: true } }, eventSeriesId: true, venueId: true, beginsAt: true, endsAt: true, maxSeats: true, ticketPrice: true, currency: true, status: true, _count: { select: { bookings: true, platformEvents: true } },
 } });
 return { ...options, events: rows.map((r) => ({ ...r, shortdescription: r.shortdescription ?? "", description: r.description ?? "", trainerName: r.trainerName ?? "", trainerIds: r.trainers.map((t) => t.trainerId), eventSeriesId: r.eventSeriesId ?? "", venueId: r.venueId ?? "", ticketPrice: r.ticketPrice.toFixed(2), beginsAt: r.beginsAt.toISOString(), endsAt: r.endsAt.toISOString() })) };
}
