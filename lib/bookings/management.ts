import "server-only";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { auth } from "@/auth";
import { ticketMailUnavailable, usableTicketWhere } from "@/lib/tickets/mail-policy";
export async function requireBookingEvent(slug: string, eventId: string) {
 const { company } = await requireCompanyAccess(slug);
 if (typeof eventId !== "string" || !eventId || eventId.length > 191) throw new MemberAccessError("NOT_FOUND");
 const event = await getPrisma().event.findFirst({ where: { id: eventId, companyId: company.id }, select: { id: true, name: true, maxSeats: true, beginsAt: true, status: true } });
 if (!event) throw new MemberAccessError("NOT_FOUND");
 return { company, event };
}
export async function getEventBookings(slug: string, eventId: string) {
 const context = await requireBookingEvent(slug, eventId);
 const actorId = (await auth())!.user!.id!;
 const membership = await getPrisma().companyMembership.findUnique({ where: { companyId_userId: { companyId: context.company.id, userId: actorId } }, select: { role: true, status: true } });
 const canResend = membership?.status === "ACTIVE" && ["COMPANY_USER", "COMPANY_ADMIN"].includes(membership.role);
 const bookings = await getPrisma().booking.findMany({ where: { eventId: context.event.id }, orderBy: [{ bookedAt: "desc" }, { id: "asc" }], select: { id: true, number: true, customerName: true, customerEmail: true, quantity: true, status: true, bookedAt: true, payment: { select: { status: true } }, platform: true, externalBookingId: true, user: { select: { name: true, email: true } }, tickets: { where: usableTicketWhere, select: { id: true } } } });
 return { ...context, event: { ...context.event, beginsAt: context.event.beginsAt?.toISOString() ?? "" }, bookings: bookings.map(({ user, tickets, ...b }) => ({ ...b,
   resendUnavailableReason: canResend ? ticketMailUnavailable({ ...b, tickets, event: context.event }) : "Eine aktive Company-Mitgliedschaft ist erforderlich.",
   customerName: b.customerName ?? user?.name ?? null, customerEmail: b.customerEmail ?? user?.email ?? null, bookedAt: b.bookedAt.toISOString() })) };
}
