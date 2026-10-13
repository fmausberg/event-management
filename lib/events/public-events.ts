import "server-only";
import { getPrisma } from "@/lib/db/prisma";
export async function getPublicEvents() {
 const events = await getPrisma().event.findMany({
  where: { status: "PUBLISHED" }, orderBy: [{ beginsAt: "asc" }, { id: "asc" }],
  select: { id: true, name: true, shortdescription: true, beginsAt: true, ticketPrice: true, currency: true,
   company: { select: { name: true, slug: true } }, venue: { select: { name: true, city: true } }, eventSeries: { select: { imageUrl: true } },
  },
 });
 return events.map((event) => ({ ...event, beginsAt: event.beginsAt.toISOString(), ticketPrice: event.ticketPrice.toFixed(2) }));
}
