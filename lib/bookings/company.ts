import "server-only";
import { requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { auth } from "@/auth";
import { bookingPaymentSummary } from "./payment-summary";
import { ticketMailUnavailable, usableTicketWhere } from "@/lib/tickets/mail-policy";

export async function getCompanyBookings(slug: string) {
  const { company } = await requireCompanyAccess(slug);
  const actorId = (await auth())!.user!.id!;
  const db = getPrisma();
  const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: company.id, userId: actorId } }, select: { role: true, status: true } });
  const canResend = membership?.status === "ACTIVE" && ["COMPANY_USER", "COMPANY_ADMIN"].includes(membership.role);
  const bookings = await db.booking.findMany({
    where: { event: { companyId: company.id } },
    orderBy: [{ bookedAt: "desc" }, { id: "asc" }],
    select: {
      id: true, number: true, customerName: true, customerEmail: true, quantity: true, status: true, bookedAt: true,
      platform: true, origin: true, externalBookingId: true,
      payment: { select: { status: true, amount: true, currency: true } },
      price: { select: { originalAmountMinor: true, payableAmountMinor: true, currency: true } },
      user: { select: { name: true, email: true } },
      tickets: { where: usableTicketWhere, select: { id: true } },
      event: { select: { id: true, name: true, endsAt: true, status: true, beginsAt: true, ticketPrice: true, currency: true, venue: { select: { name: true } } } },
    },
  });
  return { company, now: Date.now(), bookings: bookings.map(({ user, tickets, event, ...row }) => ({
    ...row,
    customerName: row.customerName ?? user?.name ?? null,
    customerEmail: row.customerEmail ?? user?.email ?? null,
    bookedAt: row.bookedAt.toISOString(),
    event: { id: event.id, name: event.name, beginsAt: event.beginsAt?.toISOString() ?? null, endsAt: event.endsAt?.toISOString() ?? null, venueName: event.venue?.name ?? null },
    paidAmount: row.payment?.status === "PAID" ? row.payment.amount : row.price?.payableAmountMinor === 0 || row.payment ? 0 : null,
    paymentSummary: bookingPaymentSummary(row, event),
    resendUnavailableReason: canResend ? ticketMailUnavailable({ ...row, tickets, event }) : "Eine aktive Company-Mitgliedschaft ist erforderlich.",
  })) };
}
