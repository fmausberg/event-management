import "server-only";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
export async function requireBookingEvent(slug: string, eventId: string) {
 const { company } = await requireCompanyAccess(slug);
 if (typeof eventId !== "string" || !eventId || eventId.length > 191) throw new MemberAccessError("NOT_FOUND");
 const event = await getPrisma().event.findFirst({ where: { id: eventId, companyId: company.id }, select: { id: true, name: true, maxSeats: true, beginsAt: true } });
 if (!event) throw new MemberAccessError("NOT_FOUND");
 return { company, event };
}
export async function getEventBookings(slug: string, eventId: string) {
 const context = await requireBookingEvent(slug, eventId);
 const bookings = await getPrisma().booking.findMany({ where: { eventId: context.event.id }, orderBy: [{ bookedAt: "desc" }, { id: "asc" }], select: { id: true, number: true, customerName: true, customerEmail: true, quantity: true, status: true, bookedAt: true, payment: { select: { status: true } }, platform: true, externalBookingId: true, user: { select: { name: true, email: true } } } });
 return { ...context, event: { ...context.event, beginsAt: context.event.beginsAt.toISOString() }, bookings: bookings.map(({ user, ...b }) => ({ ...b, customerName: b.customerName ?? user?.name ?? null, customerEmail: b.customerEmail ?? user?.email ?? null, bookedAt: b.bookedAt.toISOString() })) };
}
