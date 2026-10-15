import "server-only";
import { getPrisma } from "@/lib/db/prisma";
export async function getBookableEvent(slug: string, id: string) {
 const db = getPrisma();
 const event = await db.event.findFirst({ where: { id, status: "PUBLISHED", company: { slug } }, select: {
 id: true, name: true, shortdescription: true, description: true, beginsAt: true, endsAt: true, maxSeats: true, ticketPrice: true, currency: true, trainerName: true, trainers: { orderBy: { trainer: { lastName: "asc" } }, select: { trainer: { select: { firstName: true } } } },
 company: { select: { name: true, slug: true } }, eventSeries: { select: { imageUrl: true } },
 venue: { select: { name: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true } },
 } });
 if (!event) return null;
 const count = await db.booking.aggregate({ where: { eventId: id, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } }, _sum: { quantity: true } });
 const names = event.trainers?.map(({ trainer }) => trainer.firstName) ?? [];
 const trainerName = names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names[0] ?? event.trainerName;
 return { ...event, trainerName, ticketPrice: event.ticketPrice.toFixed(2), available: Math.max(0, event.maxSeats - (count._sum.quantity ?? 0)) };
}
