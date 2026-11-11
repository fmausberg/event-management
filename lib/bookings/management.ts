import "server-only";
import { bookingPaymentSummary } from "./payment-summary";
import { calculateEventRevenue } from "./revenue";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { auth } from "@/auth";
import { ticketMailUnavailable, usableTicketWhere } from "@/lib/tickets/mail-policy";
export async function requireBookingEvent(slug: string, eventId: string) {
 const { company } = await requireCompanyAccess(slug);
 if (typeof eventId !== "string" || !eventId || eventId.length > 191) throw new MemberAccessError("NOT_FOUND");
 const event = await getPrisma().event.findFirst({ where: { id: eventId, companyId: company.id }, select: { id: true, name: true, maxSeats: true, beginsAt: true, status: true, ticketPrice: true, currency: true, venue: { select: { countryCode: true } } } });
 if (!event) throw new MemberAccessError("NOT_FOUND");
 return { company, event };
}
export async function getEventBookings(slug: string, eventId: string) {
 const context = await requireBookingEvent(slug, eventId);
 const { canManageMembers } = await requireCompanyAccess(slug);
 const actorId = (await auth())!.user!.id!;
 const membership = await getPrisma().companyMembership.findUnique({ where: { companyId_userId: { companyId: context.company.id, userId: actorId } }, select: { role: true, status: true } });
 const canResend = membership?.status === "ACTIVE" && ["COMPANY_USER", "COMPANY_ADMIN"].includes(membership.role);
 const bookings = await getPrisma().booking.findMany({ where: { eventId: context.event.id }, orderBy: [{ bookedAt: "desc" }, { id: "asc" }], select: { id: true, number: true, customerName: true, customerEmail: true, quantity: true, status: true, bookedAt: true, payment: { select: { status: true, amount: true, currency: true } }, price: { select: { originalAmountMinor: true, currency: true, payableAmountMinor: true, taxMinor: canManageMembers, taxRate: canManageMembers, taxGrossMinor: canManageMembers, taxNetMinor: canManageMembers, taxCountryCode: canManageMembers, taxSource: canManageMembers, taxCalculationVersion: canManageMembers, voucherAmountMinor: canManageMembers } }, platform: true, origin: true, externalBookingId: true, user: { select: { name: true, email: true } }, tickets: { where: usableTicketWhere, select: { id: true } } } });
 const fullRevenue = calculateEventRevenue(bookings, context.event.venue?.countryCode, context.event);
 const { vat: _vat, vatRate: _rate, net: _net, taxGross: _gross, unknownTaxCount: _unknown, taxRates: _rates, ...publicRevenue } = fullRevenue;
 return { ...context, canSeeTaxes: canManageMembers, revenue: canManageMembers ? fullRevenue : publicRevenue, event: { ...context.event, ticketPrice: context.event.ticketPrice?.toString() ?? null, beginsAt: context.event.beginsAt?.toISOString() ?? "" }, bookings: bookings.map(({ user, tickets, ...b }) => ({ ...b, price: b.price ? canManageMembers ? { ...b.price, taxRate: b.price.taxRate?.toString() ?? null } : { originalAmountMinor: b.price.originalAmountMinor, payableAmountMinor: b.price.payableAmountMinor, currency: b.price.currency } : null, paymentSummary: bookingPaymentSummary(b, context.event),
   resendUnavailableReason: canResend ? ticketMailUnavailable({ ...b, tickets, event: context.event }) : "Eine aktive Company-Mitgliedschaft ist erforderlich.",
   customerName: b.customerName ?? user?.name ?? null, customerEmail: b.customerEmail ?? user?.email ?? null, bookedAt: b.bookedAt.toISOString() })) };
}
